import * as fs from "fs";
import * as path from "path";
import { BinaryReader, BinaryWriter, Endianness } from "../core/binary";
import { readUPKPackage, readUPKFromBuffer, UPKPackage, FObjectExport,
         resolveName, resolveClassName, getExportPath } from "../core/packages/UPKPackage";
import { PackageProfile, FByteBulkDataProfile, FTexture2DMipMapProfile } from "../core/packages/PackageProfile";
import { readAllTextures, Texture2DData, readTexture2D } from "../core/texture/Texture2D";
import { readProperties, UProperty, getIntProperty, getNameProperty,
         getByteProperty, getPropertiesSize } from "../core/texture/UProperty";
import { FByteBulkData, BulkDataStorageType, readFByteBulkData } from "../core/texture/FByteBulkData";
import { FTextureEntry, getTextureEntrySize, getTextureTfcFullName } from "../core/mapping/FTextureEntry";
import { FMipEntry } from "../core/mapping/FMipEntry";
import { CompressionFlag, BulkDataFlags } from "../core/types";
import { decompress, compress } from "../core/compression";
import { UPK_SIGNATURE_LE } from "../core/packages/Signature";

/**
 * Result of updating textures in a single package.
 */
export interface PackageUpdateResult {
  /** Path to the package file */
  packagePath: string;
  /** Number of textures updated */
  texturesUpdated: number;
  /** Names of textures that were updated */
  updatedTextureNames: string[];
  /** Size of the original file */
  originalSize: number;
  /** Size of the patched file */
  patchedSize: number;
}

/**
 * Progress callback for the orchestrator.
 */
export type ProgressCallback = (info: {
  phase: string;
  current: number;
  total: number;
  detail?: string;
}) => void;

/**
 * Match a texture entry from the mapping file to textures in a package.
 *
 * The C# code matches by textureId, which is "ObjectName" (case-insensitive).
 * The texture entry's textureId may include package/group path or just the
 * object name. We match by comparing the last part (object name).
 */
function matchTextureEntry(
  textures: Texture2DData[],
  entry: FTextureEntry,
): Texture2DData | undefined {
  // textureId format: "Package\Group\Name", "Package.Group.Name", or just "Name"
  const parts = entry.textureId.split(/[.\\/]/);
  const entryObjectName = parts[parts.length - 1].toLowerCase();

  return textures.find(tex => {
    // Match by object name (case-insensitive)
    if (tex.objectName.toLowerCase() === entryObjectName) return true;
    // Also try full path match
    if (tex.objectPath.toLowerCase() === entry.textureId.toLowerCase()) return true;
    return false;
  });
}

/**
 * Compute the serialized size of one FByteBulkData descriptor (header only, no data).
 */
function bulkDataHeaderSize(profile: FByteBulkDataProfile): number {
  let size = 0;
  if (profile.hasFlags) size += 4;          // bulkDataFlags
  if (profile.hasSizeOffsetOnDisk) {
    size += 4;                              // elementCount
    size += profile.hasDiskDataSize64 ? 8 : 4;   // diskSize
    size += profile.hasDiskDataOffset64 ? 8 : 4;  // diskOffset
  } else {
    size += 4 + 4; // legacy: offsetPlusCount + elementCount
  }
  if (profile.hasBulkDataKey) size += 4;
  return size;
}

/**
 * Compute the serialized size of one FTexture2DMipMap entry.
 */
function mipMapEntrySize(profile: PackageProfile): number {
  let size = 0;
  const mp = profile.mipMap;
  // Object header not included here (BioShock only, complex)
  if (mp.hasUnknownInt64) size += 8;
  if (mp.hasIndex) size += 4;
  // FByteBulkData header (no inline data for external/TFC storage)
  size += bulkDataHeaderSize(profile.byteBulkData);
  if (mp.hasX360GammaData) size += bulkDataHeaderSize(profile.byteBulkData);
  // sizeX + sizeY
  size += 8;
  if (mp.hasByteArray) size += 2;
  return size;
}

/**
 * Write a single FByteBulkData header for a TFC-stored mip.
 */
function writeTFCBulkDataHeader(
  writer: BinaryWriter,
  profile: FByteBulkDataProfile,
  mipEntry: FMipEntry,
): void {
  // Build flags: StoreInSeparateFile + compression
  let flags = BulkDataFlags.StoreInSeparateFile;
  if (mipEntry.compression === CompressionFlag.LZO) {
    flags |= BulkDataFlags.CompressedLzo;
  } else if (mipEntry.compression === CompressionFlag.ZLIB) {
    flags |= BulkDataFlags.CompressedZlib;
  }

  if (profile.hasFlags) {
    writer.writeUInt32(flags);
  }

  if (profile.hasSizeOffsetOnDisk) {
    writer.writeInt32(mipEntry.elementCount);
    if (profile.hasDiskDataSize64) {
      writer.writeInt64(BigInt(mipEntry.sizeOnDisk));
    } else {
      writer.writeInt32(mipEntry.sizeOnDisk);
    }
    if (profile.hasDiskDataOffset64) {
      writer.writeInt64(BigInt(mipEntry.offsetOnDisk));
    } else {
      writer.writeInt32(mipEntry.offsetOnDisk);
    }
  } else {
    // Legacy format
    writer.writeInt32(mipEntry.offsetOnDisk + mipEntry.elementCount);
    writer.writeInt32(mipEntry.elementCount);
  }

  if (profile.hasBulkDataKey) {
    writer.writeInt32(0);
  }
}

/**
 * Write a single FByteBulkData header for a local (inlined) mip.
 * The actual pixel data follows immediately after.
 */
function writeLocalBulkDataHeader(
  writer: BinaryWriter,
  profile: FByteBulkDataProfile,
  dataSize: number,
  dataOffset: number,
): void {
  // Local storage — no StoreInSeparateFile flag
  const flags = 0;

  if (profile.hasFlags) {
    writer.writeUInt32(flags);
  }

  if (profile.hasSizeOffsetOnDisk) {
    writer.writeInt32(dataSize);
    if (profile.hasDiskDataSize64) {
      writer.writeInt64(BigInt(dataSize));
    } else {
      writer.writeInt32(dataSize);
    }
    if (profile.hasDiskDataOffset64) {
      writer.writeInt64(BigInt(dataOffset));
    } else {
      writer.writeInt32(dataOffset);
    }
  } else {
    writer.writeInt32(dataOffset + dataSize);
    writer.writeInt32(dataSize);
  }

  if (profile.hasBulkDataKey) {
    writer.writeInt32(0);
  }
}

/**
 * Write the mipmap section of a Texture2D, replacing all mips with new data
 * from the mapping entry.
 *
 * Returns the serialized mipmap section as a Buffer.
 */
function buildNewMipmapSection(
  profile: PackageProfile,
  textureEntry: FTextureEntry,
  localMipData: Buffer[] | null,
): Buffer {
  const totalMips = textureEntry.tfcMipCount + textureEntry.localMipCount;
  // Estimate size: mipCount(4) + totalMips * mipEntrySize
  const entrySize = mipMapEntrySize(profile);
  const estimatedSize = 4 + totalMips * (entrySize + 1024); // generous padding
  const writer = new BinaryWriter(estimatedSize, Endianness.Little);

  // Mip count
  writer.writeInt32(totalMips);

  // TFC mips (external storage — no inline data)
  for (const mip of textureEntry.tfcMips) {
    if (profile.mipMap.hasUnknownInt64) writer.writeInt64(0n);
    if (profile.mipMap.hasIndex) writer.writeInt32(0);

    writeTFCBulkDataHeader(writer, profile.byteBulkData, mip);

    if (profile.mipMap.hasX360GammaData) {
      // Write empty gamma data
      writeLocalBulkDataHeader(writer, profile.byteBulkData, 0, 0);
    }

    writer.writeUInt32(mip.sizeX);
    writer.writeUInt32(mip.sizeY);

    if (profile.mipMap.hasByteArray) {
      writer.writeUInt16(0);
    }
  }

  // Local mips (inline data)
  for (let i = 0; i < textureEntry.localMips.length; i++) {
    const mip = textureEntry.localMips[i];
    if (profile.mipMap.hasUnknownInt64) writer.writeInt64(0n);
    if (profile.mipMap.hasIndex) writer.writeInt32(0);

    if (localMipData && localMipData[i]) {
      // Write the data inline
      const data = localMipData[i];
      // The offset for local data points to current position in the output buffer
      // This will be corrected when we know the final offset in the package
      writeLocalBulkDataHeader(writer, profile.byteBulkData, data.length, 0);
      writer.writeBytes(data);
    } else {
      // No data — write empty bulk data
      writeLocalBulkDataHeader(writer, profile.byteBulkData, 0, 0);
    }

    if (profile.mipMap.hasX360GammaData) {
      writeLocalBulkDataHeader(writer, profile.byteBulkData, 0, 0);
    }

    writer.writeUInt32(mip.sizeX);
    writer.writeUInt32(mip.sizeY);

    if (profile.mipMap.hasByteArray) {
      writer.writeUInt16(0);
    }
  }

  return writer.toBuffer();
}

/**
 * Read the "header" portion of a Texture2D (everything between properties and mipmaps).
 * Returns the raw bytes of: sourceArt + header fields + sizeX/sizeY/format (if not in properties).
 */
function readTexture2DHeader(
  reader: BinaryReader,
  profile: PackageProfile,
  propertiesEndOffset: number,
): { headerBytes: Buffer; mipmapStartOffset: number } {
  reader.seek(propertiesEndOffset);
  const tp = profile.texture2D;
  const startPos = reader.position;

  // Source art
  if (tp.hasSourceArt) {
    skipFByteBulkData(reader, profile.byteBulkData);
  }
  if (tp.hasSourceArt2) {
    skipFByteBulkData(reader, profile.byteBulkData);
  }
  if (tp.hasSourceFilePath) {
    reader.readFString();
  }
  if (tp.unknownBytesAfterSourceArt > 0) {
    reader.skip(tp.unknownBytesAfterSourceArt);
  }
  if (tp.hasUnknownIntArrayBeforeMipmaps) {
    const count = reader.readInt32();
    reader.skip(count * 4);
  }

  // SizeX, SizeY, Format (if not in properties — we read but don't include here,
  // they'll be patched separately)
  if (!tp.hasSizeAndFormatAsProperties) {
    reader.skip(12); // sizeX(4) + sizeY(4) + format(4)
  }

  const endPos = reader.position;
  const headerSize = endPos - startPos;

  reader.seek(startPos);
  const headerBytes = reader.readBytes(headerSize);

  return { headerBytes, mipmapStartOffset: endPos };
}

/**
 * Skip an FByteBulkData entry in a reader (used to skip source art).
 */
function skipFByteBulkData(reader: BinaryReader, profile: FByteBulkDataProfile): void {
  let bulkDataFlags = 0;
  if (profile.hasFlags) {
    bulkDataFlags = reader.readUInt32();
  }

  let diskSize: number;
  if (profile.hasSizeOffsetOnDisk) {
    reader.skip(4); // elementCount
    diskSize = profile.hasDiskDataSize64 ? Number(reader.readInt64()) : reader.readInt32();
    reader.skip(profile.hasDiskDataOffset64 ? 8 : 4); // diskOffset
  } else {
    reader.skip(4); // offsetPlusCount
    diskSize = reader.readInt32();
  }

  if (profile.hasBulkDataKey) {
    reader.skip(4);
  }

  // Skip local inline data
  const isExternal = (bulkDataFlags & BulkDataFlags.StoreInSeparateFile) !== 0;
  const isUnused = (bulkDataFlags & BulkDataFlags.Unused) !== 0;
  if (!isExternal && !isUnused && diskSize > 0) {
    reader.skip(diskSize);
  }
}

/**
 * Read the "extra data" after mipmaps (TFC GUID, cached mips, etc.).
 */
function readTexture2DExtraData(
  reader: BinaryReader,
  profile: PackageProfile,
  serialEndOffset: number,
): Buffer {
  const startPos = reader.position;
  const remaining = serialEndOffset - startPos;
  if (remaining <= 0) return Buffer.alloc(0);
  return reader.readBytes(remaining);
}

/**
 * Find a name in the package's name table (case-insensitive).
 * Returns the 0-based index, or -1 if not found.
 */
function findNameIndex(pkg: UPKPackage, name: string): number {
  const lower = name.toLowerCase();
  for (let i = 0; i < pkg.names.length; i++) {
    if (pkg.names[i].name.toLowerCase() === lower) return i;
  }
  return -1;
}

/**
 * Patch the properties of a Texture2D to update size and TFC name references.
 *
 * Patches IntProperty values in-place (SizeX, SizeY, OriginalSizeX,
 * OriginalSizeY, FirstResourceMemMip) and NameProperty for
 * TextureFileCacheName (same 8-byte size — just nameIndex + suffix).
 *
 * @returns The modified property bytes, same size as original (in-place patches only).
 */
function patchPropertyBytes(
  propertyBytes: Buffer,
  profile: PackageProfile,
  pkg: UPKPackage,
  textureEntry: FTextureEntry,
): Buffer {
  const { sizeX, sizeY } = getTextureEntrySize(textureEntry);
  const totalMips = textureEntry.tfcMipCount + textureEntry.localMipCount;
  const patched = Buffer.from(propertyBytes);

  // Resolve the TFC name index for NameProperty patching
  let tfcNameIndex = -1;
  let tfcSuffix = 0;
  if (textureEntry.tfcMipCount > 0 && textureEntry.tfcName) {
    tfcNameIndex = findNameIndex(pkg, textureEntry.tfcName);
    // Suffix encoding: tfcIndex + 1 (0 = no suffix, 1 = "_0", 2 = "_1", etc.)
    tfcSuffix = textureEntry.tfcIndex >= 0 ? textureEntry.tfcIndex + 1 : 0;
  }

  // Parse properties to find field offsets
  const reader = new BinaryReader(patched, Endianness.Little);
  let offset = 0;

  while (offset < patched.length) {
    reader.seek(offset);
    const nameIndex = reader.readInt32();
    const nameSuffix = reader.readInt32();
    const name = resolveName(pkg, nameIndex);

    if (name === "None") break;

    const typeIndex = reader.readInt32();
    const typeSuffix = reader.readInt32();
    const typeName = resolveName(pkg, typeIndex);
    const dataSize = reader.readInt32();
    const arrayIndex = reader.readInt32();

    // Skip struct/enum extra header bytes
    if (typeName === "StructProperty") {
      reader.skip(8);
    }
    if (typeName === "ByteProperty" && profile.object.isBytePropertyUsedForEnum) {
      reader.skip(8);
    }

    const dataOffset = reader.position;

    // Patch IntProperty values
    if (typeName === "IntProperty" && dataSize === 4) {
      if (name === "SizeX") {
        patched.writeInt32LE(sizeX, dataOffset);
      } else if (name === "SizeY") {
        patched.writeInt32LE(sizeY, dataOffset);
      } else if (name === "OriginalSizeX") {
        patched.writeInt32LE(sizeX, dataOffset);
      } else if (name === "OriginalSizeY") {
        patched.writeInt32LE(sizeY, dataOffset);
      } else if (name === "FirstResourceMemMip") {
        patched.writeInt32LE(0, dataOffset);
      }
    }

    // Patch NameProperty: TextureFileCacheName
    if (typeName === "NameProperty" && name === "TextureFileCacheName" && dataSize === 8) {
      if (tfcNameIndex >= 0) {
        patched.writeInt32LE(tfcNameIndex, dataOffset);
        patched.writeInt32LE(tfcSuffix, dataOffset + 4);
      }
      // If tfcNameIndex < 0, the TFC name doesn't exist in the name table.
      // Name table expansion would be needed — skip for now.
    }

    // Advance past data
    if (typeName === "BoolProperty" && profile.object.isBoolPropertyStoredAsByte) {
      offset = dataOffset + (dataSize > 0 ? dataSize : 1);
    } else {
      offset = dataOffset + dataSize;
    }
  }

  return patched;
}

/**
 * Build the complete serialized data for a patched Texture2D object.
 *
 * Strategy: reconstruct the serialized bytes from:
 *   [netIndex] [properties] [header] [mipmaps] [extraData]
 *
 * Properties are patched in-place (same size).
 * Mipmaps are rebuilt from the mapping entry.
 * Everything else is preserved as-is.
 */
function buildPatchedTexture(
  dataReader: BinaryReader,
  pkg: UPKPackage,
  texture: Texture2DData,
  textureEntry: FTextureEntry,
  localMipData: Buffer[] | null,
): Buffer {
  const profile = pkg.profile;
  const exportEntry = pkg.exports[texture.exportIndex - 1];
  const serialStart = exportEntry.serialOffset;
  const serialEnd = serialStart + exportEntry.serialSize;

  // 1. Read the netIndex (if present)
  dataReader.seek(serialStart);
  let netIndexBytes: Buffer = Buffer.alloc(0);
  if (profile.object.hasNetIndex) {
    netIndexBytes = Buffer.from(dataReader.readBytes(4));
  }

  // 2. Read and patch properties
  const propsStart = dataReader.position;
  readProperties(dataReader, pkg); // advance reader past properties
  const propsEnd = dataReader.position;
  const propsSize = propsEnd - propsStart;

  dataReader.seek(propsStart);
  const propertyBytes = dataReader.readBytes(propsSize);
  const patchedProperties = patchPropertyBytes(propertyBytes, profile, pkg, textureEntry);

  // 3. Read header (source art, etc.) and sizeX/sizeY/format block
  const { headerBytes, mipmapStartOffset } = readTexture2DHeader(dataReader, profile, propsEnd);

  // If SizeX/SizeY/Format are NOT in properties, they're the last 12 bytes of headerBytes
  // and need patching
  let patchedHeader = Buffer.from(headerBytes);
  if (!profile.texture2D.hasSizeAndFormatAsProperties) {
    const { sizeX, sizeY } = getTextureEntrySize(textureEntry);
    const offset = patchedHeader.length - 12;
    patchedHeader.writeInt32LE(sizeX, offset);
    patchedHeader.writeInt32LE(sizeY, offset + 4);
    // format stays the same (offset + 8)
  }

  // 4. Skip old mipmaps to find extra data
  dataReader.seek(mipmapStartOffset);
  const oldMipCount = dataReader.readInt32();
  for (let i = 0; i < oldMipCount; i++) {
    skipMipMapEntry(dataReader, profile);
  }
  const extraDataStart = dataReader.position;

  // 5. Read extra data (GUID, cached mips, etc.)
  const extraData = readTexture2DExtraData(dataReader, profile, serialEnd);

  // 6. Build new mipmap section
  const newMipmapSection = buildNewMipmapSection(profile, textureEntry, localMipData);

  // 7. Assemble the complete patched object data
  const totalSize = netIndexBytes.length + patchedProperties.length +
    patchedHeader.length + newMipmapSection.length + extraData.length;

  const result = Buffer.alloc(totalSize);
  let pos = 0;

  netIndexBytes.copy(result, pos); pos += netIndexBytes.length;
  patchedProperties.copy(result, pos); pos += patchedProperties.length;
  patchedHeader.copy(result, pos); pos += patchedHeader.length;
  newMipmapSection.copy(result, pos); pos += newMipmapSection.length;
  extraData.copy(result, pos);

  return result;
}

/**
 * Skip a single FTexture2DMipMap entry in the reader.
 */
function skipMipMapEntry(reader: BinaryReader, profile: PackageProfile): void {
  const mp = profile.mipMap;

  if (mp.hasObjectHeader) {
    // BioShock-specific object header
    const version = reader.readInt32();
    if (version === 1) {
      skipFByteBulkData(reader, profile.byteBulkData);
    }
  }

  if (mp.hasUnknownInt64) reader.skip(8);
  if (mp.hasIndex) reader.skip(4);

  skipFByteBulkData(reader, profile.byteBulkData);

  if (mp.hasX360GammaData) {
    skipFByteBulkData(reader, profile.byteBulkData);
  }

  reader.skip(8); // sizeX + sizeY

  if (mp.hasByteArray) reader.skip(2);
}

/**
 * Load local mip pixel data from a mod's TFC file.
 *
 * Local mips are read from: {modTfcDir}/{localTfcName}_{localTfcIndex}.tfc
 * Each mip's data is read at its offsetOnDisk for sizeOnDisk bytes,
 * then decompressed if needed (chunk-based format).
 *
 * @returns Array of pixel data buffers (one per local mip), or null if no local mips
 */
function loadLocalMipData(
  entry: FTextureEntry,
  modTfcDir: string,
  tfcExtension: string = ".tfc",
): Buffer[] | null {
  if (entry.localMipCount === 0 || entry.localMips.length === 0) return null;

  // Resolve the local TFC file path
  const tfcFileName = entry.localTfcIndex >= 0
    ? `${entry.localTfcName}_${entry.localTfcIndex}${tfcExtension}`
    : `${entry.localTfcName}${tfcExtension}`;
  const tfcPath = path.join(modTfcDir, tfcFileName);

  if (!fs.existsSync(tfcPath)) {
    throw new Error(`Local TFC file not found: ${tfcPath}`);
  }

  const fd = fs.openSync(tfcPath, "r");
  try {
    const buffers: Buffer[] = [];

    for (const mip of entry.localMips) {
      if (mip.sizeOnDisk <= 0) {
        buffers.push(Buffer.alloc(0));
        continue;
      }

      // Read raw bytes from TFC at the specified offset
      const rawData = Buffer.alloc(mip.sizeOnDisk);
      fs.readSync(fd, rawData, 0, mip.sizeOnDisk, mip.offsetOnDisk);

      if (mip.compression === CompressionFlag.None) {
        // Uncompressed — raw pixel data
        buffers.push(rawData);
      } else {
        // Compressed — use chunk decompression (same format as UPK chunks)
        const reader = new BinaryReader(rawData, Endianness.Little);
        const decompressed = decompressChunkDataFromReader(reader, mip.compression, mip.sizeOnDisk);
        buffers.push(decompressed);
      }
    }

    return buffers;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Decompress chunk-based compressed data from a BinaryReader.
 * Same format as UPK/TFC chunks: Signature(4) + MaxBlockSize(4) +
 * SumBlock(8) + N×BlockDescriptor(8) + N×CompressedData
 */
function decompressChunkDataFromReader(
  reader: BinaryReader,
  compressionFlag: CompressionFlag,
  totalSize: number,
): Buffer {
  const sig = reader.readUInt32();
  if (sig !== UPK_SIGNATURE_LE) {
    throw new Error(
      `Invalid chunk signature: 0x${sig.toString(16).toUpperCase()}, ` +
      `expected 0x${UPK_SIGNATURE_LE.toString(16).toUpperCase()}`
    );
  }

  const maxBlockSize = reader.readUInt32();
  const sumCompressedSize = reader.readUInt32();
  const sumUncompressedSize = reader.readUInt32();

  const blockCount = Math.ceil(sumUncompressedSize / maxBlockSize);
  const blocks: Array<{ compressedSize: number; uncompressedSize: number }> = [];

  for (let i = 0; i < blockCount; i++) {
    blocks.push({
      compressedSize: reader.readUInt32(),
      uncompressedSize: reader.readUInt32(),
    });
  }

  const output = Buffer.alloc(sumUncompressedSize);
  let outputOffset = 0;

  for (const block of blocks) {
    const compressedData = reader.readBytes(block.compressedSize);
    const decompressed = decompress(compressedData, compressionFlag, block.uncompressedSize);
    decompressed.copy(output, outputOffset);
    outputOffset += block.uncompressedSize;
  }

  return output;
}

/**
 * Apply texture updates to a single package file.
 *
 * @param packagePath Path to the UPK package file
 * @param textureEntries Texture entries from the mapping file
 * @param outputPath Output path (defaults to packagePath — overwrites)
 * @param modTfcDir Directory containing the mod's TFC files (needed for local mips)
 * @returns Update result, or null if no textures matched
 */
export function updatePackageTextures(
  packagePath: string,
  textureEntries: FTextureEntry[],
  outputPath?: string,
  modTfcDir?: string,
): PackageUpdateResult | null {
  // Read the package
  const pkg = readUPKPackage(packagePath);
  const dataReader = pkg.dataReader;

  // Find all Texture2D exports
  const textures = readAllTextures(dataReader, pkg);
  if (textures.length === 0) return null;

  // Match texture entries to package textures
  const matches: { texture: Texture2DData; entry: FTextureEntry }[] = [];
  for (const entry of textureEntries) {
    const tex = matchTextureEntry(textures, entry);
    if (tex) {
      matches.push({ texture: tex, entry });
    }
  }

  if (matches.length === 0) return null;

  // Build the patched data for the decompressed package buffer
  // We work on the decompressed buffer, modifying object data in-place or with shifting
  const originalBuffer = dataReader.getBuffer();
  const patchedData = new Map<number, Buffer>(); // exportIndex → patched serialized data

  for (const { texture, entry } of matches) {
    // Load local mip data from mod TFC files if available
    let localMipData: Buffer[] | null = null;
    if (entry.localMipCount > 0 && modTfcDir) {
      localMipData = loadLocalMipData(entry, modTfcDir);
    }
    const patched = buildPatchedTexture(dataReader, pkg, texture, entry, localMipData);
    patchedData.set(texture.exportIndex, patched);
  }

  // Compute the size deltas and build the output buffer
  // Sort by serial offset to process in order
  const sortedPatches = [...patchedData.entries()]
    .map(([exportIndex, data]) => {
      const exp = pkg.exports[exportIndex - 1];
      return { exportIndex, data, originalOffset: exp.serialOffset, originalSize: exp.serialSize };
    })
    .sort((a, b) => a.originalOffset - b.originalOffset);

  // Calculate total size change
  let totalDelta = 0;
  for (const patch of sortedPatches) {
    totalDelta += patch.data.length - patch.originalSize;
  }

  // Build new buffer with shifted data
  const newBufferSize = originalBuffer.length + totalDelta;
  const newBuffer = Buffer.alloc(newBufferSize);
  let srcPos = 0;
  let dstPos = 0;
  let accumulatedDelta = 0;

  // Copy data in chunks, replacing patched objects
  for (const patch of sortedPatches) {
    // Copy unchanged data before this object
    const preBytes = patch.originalOffset - srcPos;
    if (preBytes > 0) {
      originalBuffer.copy(newBuffer, dstPos, srcPos, srcPos + preBytes);
      dstPos += preBytes;
      srcPos += preBytes;
    }

    // Write patched data
    patch.data.copy(newBuffer, dstPos);
    dstPos += patch.data.length;
    srcPos += patch.originalSize;

    // Track the delta for offset updates
    accumulatedDelta += patch.data.length - patch.originalSize;
  }

  // Copy remaining data after all patches
  if (srcPos < originalBuffer.length) {
    originalBuffer.copy(newBuffer, dstPos, srcPos);
  }

  // Update export table entries (serial offset and size)
  // The export table is at a known offset in the buffer — we need to update it
  updateExportTable(newBuffer, pkg, sortedPatches);

  // Recompress if the original package was compressed
  const outputBuffer = recompressPackage(newBuffer, pkg);

  const outPath = outputPath ?? packagePath;
  fs.writeFileSync(outPath, outputBuffer);

  return {
    packagePath: outPath,
    texturesUpdated: matches.length,
    updatedTextureNames: matches.map(m => m.texture.objectName),
    originalSize: originalBuffer.length,
    patchedSize: outputBuffer.length,
  };
}

/**
 * Update the export table entries in the new buffer to reflect changed offsets and sizes.
 *
 * Uses the recorded serialSizeFilePos/serialOffsetFilePos from parsing to know
 * exactly where each export's fields are in the buffer. These positions are in
 * the header area which is NOT shifted by object data changes (the header comes
 * before all object serial data).
 */
function updateExportTable(
  buffer: Buffer,
  pkg: UPKPackage,
  patches: { exportIndex: number; data: Buffer; originalOffset: number; originalSize: number }[],
): void {
  const profile = pkg.profile;

  // Build cumulative shift table: for a given original offset, how much has the
  // output shifted at that point?
  const shiftPoints: { afterOffset: number; cumulativeDelta: number }[] = [];
  let cumDelta = 0;
  for (const patch of patches) {
    cumDelta += patch.data.length - patch.originalSize;
    shiftPoints.push({
      afterOffset: patch.originalOffset + patch.originalSize,
      cumulativeDelta: cumDelta,
    });
  }

  // For each export, compute its new serial offset and size
  for (let i = 0; i < pkg.exports.length; i++) {
    const exp = pkg.exports[i];

    // Compute shift: sum of deltas from all patches whose objects end BEFORE
    // this export's original serial offset
    let shift = 0;
    for (const sp of shiftPoints) {
      if (exp.serialOffset >= sp.afterOffset) {
        shift = sp.cumulativeDelta;
      }
    }

    // Check if this export was patched (its size changed)
    const patch = patches.find(p => p.exportIndex === i + 1);
    const newSize = patch ? patch.data.length : exp.serialSize;
    const newOffset = exp.serialOffset + shift;

    // Write to the buffer at the recorded file positions
    // These positions are in the export table (header area) which doesn't shift
    if (profile.objectExport.hasSerialDataOffset64) {
      buffer.writeBigInt64LE(BigInt(newOffset), exp.serialOffsetFilePos);
      buffer.writeBigInt64LE(BigInt(newSize), exp.serialSizeFilePos);
    } else {
      buffer.writeInt32LE(newOffset, exp.serialOffsetFilePos);
      buffer.writeInt32LE(newSize, exp.serialSizeFilePos);
    }
  }
}

/**
 * Find the byte offset of the compression flag field in the package header.
 * Parses through the summary fields to locate the exact position.
 */
function findCompressionFlagOffset(buffer: Buffer, pkg: UPKPackage): number {
  const reader = new BinaryReader(
    Buffer.from(buffer.subarray(0, Math.min(2048, buffer.length))),
    Endianness.Little,
  );

  // Skip past: signature(4) + fileVersion(2) + licenseeVersion(2)
  reader.skip(4 + 2 + 2);
  const profile = pkg.profile;

  if (profile.summary.unknownBytesAfterLicenseeVersion > 0) {
    reader.skip(profile.summary.unknownBytesAfterLicenseeVersion);
  }
  if (profile.summary.hasHeaderSize) reader.skip(4);
  if (profile.summary.hasPackageGroup) reader.readFString();
  reader.skip(4); // packageFlags

  // Name/Import/Export arrays (count + offset for each)
  reader.skip(4 * 2); // name count + offset
  reader.skip(4 * 2); // export count + offset
  reader.skip(4 * 2); // import count + offset

  if (profile.summary.hasDependsOffset) reader.skip(4);
  if (profile.summary.hasSerializedOffset) {
    reader.skip(profile.summary.hasSerializedOffset64 ? 8 : 4);
  }
  if (profile.summary.unknownBytesAfterSerializedOffset > 0) {
    reader.skip(profile.summary.unknownBytesAfterSerializedOffset);
  }
  if (profile.summary.hasUnknownInt32BeforeGuid) reader.skip(4);
  if (profile.summary.hasGuid) reader.skip(16);

  if (profile.summary.hasGenerations) {
    const genCount = reader.readInt32();
    for (let i = 0; i < genCount; i++) {
      reader.skip(4); // exportCount
      reader.skip(4); // nameCount
      if (profile.summary.hasGenerationsGuid) reader.skip(16);
      if (pkg.fileVersion >= 322) reader.skip(4); // netObjectCount
    }
  }

  if (profile.summary.unknownBytesAfterGenerations > 0) {
    reader.skip(profile.summary.unknownBytesAfterGenerations);
  }
  if (profile.summary.hasEngineVersion) reader.skip(4);
  if (profile.summary.hasCookerVersion) reader.skip(4);

  return reader.position;
}

/**
 * Compress a chunk of uncompressed data into UE3 chunk format.
 *
 * Output format:
 *   Signature (4) + MaxBlockSize (4) + SumCompressed (4) + SumUncompressed (4)
 *   + N × { compressedSize (4), uncompressedSize (4) }
 *   + compressed block data
 */
function compressChunk(
  data: Buffer,
  compressionFlag: CompressionFlag,
  maxBlockSize: number = 131072,
): Buffer {
  const blockCount = Math.ceil(data.length / maxBlockSize);

  // Compress each block
  const compressedBlocks: { compressed: Buffer; uncompressedSize: number }[] = [];
  for (let i = 0; i < blockCount; i++) {
    const start = i * maxBlockSize;
    const end = Math.min(start + maxBlockSize, data.length);
    const block = data.subarray(start, end);
    const compressed = compress(block, compressionFlag);
    compressedBlocks.push({ compressed, uncompressedSize: end - start });
  }

  const sumCompressed = compressedBlocks.reduce((s, b) => s + b.compressed.length, 0);

  // Header: signature(4) + maxBlockSize(4) + sumCompressed(4) + sumUncompressed(4)
  // + blockDescriptors(blockCount × 8)
  const chunkHeaderSize = 16 + blockCount * 8;
  const totalSize = chunkHeaderSize + sumCompressed;
  const buf = Buffer.alloc(totalSize);
  let pos = 0;

  buf.writeUInt32LE(UPK_SIGNATURE_LE, pos); pos += 4;
  buf.writeUInt32LE(maxBlockSize, pos); pos += 4;
  buf.writeUInt32LE(sumCompressed, pos); pos += 4;
  buf.writeUInt32LE(data.length, pos); pos += 4;

  for (const block of compressedBlocks) {
    buf.writeUInt32LE(block.compressed.length, pos); pos += 4;
    buf.writeUInt32LE(block.uncompressedSize, pos); pos += 4;
  }

  for (const block of compressedBlocks) {
    block.compressed.copy(buf, pos);
    pos += block.compressed.length;
  }

  return buf;
}

/**
 * Recompress a modified decompressed UPK buffer back into the original
 * chunk-based compression format.
 *
 * The decompressed buffer layout:
 *   [Header: 0..headerEnd] — raw file header (copied as-is from compressed file)
 *   [Data: headerEnd..end] — decompressed chunk data (tables + serial data)
 *
 * We split the data region across the same number of chunks as the original,
 * compress each chunk, and update the chunk table in the header.
 */
function recompressPackage(buffer: Buffer, pkg: UPKPackage): Buffer {
  const summary = pkg.summary;

  if (summary.compressionFlag === CompressionFlag.None
    || summary.compressionChunks.length === 0) {
    return buffer;
  }

  const compressionFlag = summary.compressionFlag;
  const chunkCount = summary.compressionChunks.length;
  const headerEnd = summary.compressionChunks[0].uncompressedOffset;

  const compressionFlagOffset = findCompressionFlagOffset(buffer, pkg);

  // Data region: everything after the header
  const dataRegion = buffer.subarray(headerEnd);

  // Split data evenly across the same number of chunks as the original
  const chunkUncompressedSize = Math.ceil(dataRegion.length / chunkCount);

  // Compress each chunk
  const compressedChunks: Buffer[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkUncompressedSize;
    const end = Math.min(start + chunkUncompressedSize, dataRegion.length);
    const chunkData = dataRegion.subarray(start, end);
    compressedChunks.push(compressChunk(chunkData, compressionFlag));
  }

  // The chunk table may extend past headerEnd (the decompressed buffer's header
  // doesn't need the full chunk table). Ensure compressed data starts after both.
  const chunkTableEnd = compressionFlagOffset + 8 + chunkCount * 16;
  const compressedDataStart = Math.max(headerEnd, chunkTableEnd);

  // Build output: header + compressed chunks
  const totalCompressedSize = compressedChunks.reduce((s, c) => s + c.length, 0);
  const outputSize = compressedDataStart + totalCompressedSize;
  const output = Buffer.alloc(outputSize);

  // Copy header (compression flag is already the original value)
  buffer.copy(output, 0, 0, headerEnd);

  // Update chunk table entries in the header
  // Layout: compressionFlag(4) + chunkCount(4) + N × {uncompOff(4), uncompSize(4), compOff(4), compSize(4)}
  const chunkTableOffset = compressionFlagOffset + 8;
  let compressedOffset = compressedDataStart;

  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkUncompressedSize;
    const uncompressedSize = Math.min(chunkUncompressedSize, dataRegion.length - start);
    const uncompressedOffset = headerEnd + start;

    const entryOffset = chunkTableOffset + i * 16;
    output.writeInt32LE(uncompressedOffset, entryOffset);
    output.writeInt32LE(uncompressedSize, entryOffset + 4);
    output.writeInt32LE(compressedOffset, entryOffset + 8);
    output.writeInt32LE(compressedChunks[i].length, entryOffset + 12);

    // Write compressed chunk data
    compressedChunks[i].copy(output, compressedOffset);
    compressedOffset += compressedChunks[i].length;
  }

  return output;
}

/**
 * Scan game directories for UPK package files.
 */
export function findPackageFiles(
  dirs: string[],
  extensions: string[] = [".upk", ".u", ".xxx"],
): string[] {
  const files: string[] = [];
  const extSet = new Set(extensions.map(e => e.toLowerCase()));

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && extSet.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  for (const dir of dirs) {
    walk(dir);
  }

  return files;
}

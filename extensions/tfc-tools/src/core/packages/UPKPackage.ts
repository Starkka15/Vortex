import * as fs from "fs";
import { BinaryReader, Endianness, FGuid } from "../binary";
import { decompress } from "../compression";
import { ChunkManager } from "../compression/ChunkManager";
import { CompressionFlag } from "../types";
import { PackageId, getPackageId } from "./PackageId";
import { PackageProfile, createPackageProfile } from "./PackageProfile";
import { readSignature, readVersions, UPK_SIGNATURE_LE } from "./Signature";
import { readFCompactIndex } from "../bulkcontent/FCompactIndex";

// ============================================================
//  Data types
// ============================================================

export interface TableArray {
  count: number;
  offset: number;
}

export interface FGenerationInfo {
  exportCount: number;
  nameCount: number;
  netObjectCount?: number;
}

export interface PackageSummary {
  headerSize?: number;
  packageGroup?: string;
  packageFlags: number;
  nameArray: TableArray;
  exportArray: TableArray;
  importArray: TableArray;
  dependsOffset?: number;
  guid?: FGuid;
  generations: FGenerationInfo[];
  engineVersion?: number;
  cookerVersion?: number;
  compressionFlag: CompressionFlag;
  compressionChunks: CompressedChunk[];
}

export interface CompressedChunk {
  uncompressedOffset: number;
  uncompressedSize: number;
  compressedOffset: number;
  compressedSize: number;
}

export interface FNameEntry {
  name: string;
  flags: number;
  flags2: number;
}

export interface FObjectImport {
  packageName: number; // index into name table
  typeName: number;    // index into name table
  ownerRef: number;    // object reference (0=none, >0 export, <0 import)
  objectName: number;  // index into name table
}

export interface FObjectExport {
  classIndex: number;        // object reference
  parentClassIndex: number;  // object reference
  packageIndex: number;      // object reference
  objectName: number;        // index into name table
  archetypeRef: number;
  objectFlags: number;       // 32-bit flags (lower half)
  objectFlagsHi: number;     // upper 32-bit flags (if 64-bit)
  serialOffset: number;      // offset of serialized object data
  serialSize: number;        // size of serialized object data
  exportFlags: number;
  exportFlags2: number;
  guid?: FGuid;
  netObjectCount: number;
  /** Byte position of serialSize field within the (decompressed) file */
  serialSizeFilePos: number;
  /** Byte position of serialOffset field within the (decompressed) file */
  serialOffsetFilePos: number;
}

/**
 * Parsed UPK package — contains all header metadata and table entries.
 */
export interface UPKPackage {
  filePath: string;
  endianness: Endianness;
  fileVersion: number;
  licenseeVersion: number;
  packageId: PackageId;
  profile: PackageProfile;
  summary: PackageSummary;
  names: FNameEntry[];
  imports: FObjectImport[];
  exports: FObjectExport[];
  /** The decompressed data reader (or original reader if uncompressed) */
  dataReader: BinaryReader;
}

// ============================================================
//  Reading
// ============================================================

/**
 * Read a UPK package from a file.
 */
export function readUPKPackage(filePath: string, gameId?: string): UPKPackage {
  const buffer = fs.readFileSync(filePath);
  const reader = new BinaryReader(buffer, Endianness.Little);
  return readUPKFromReader(reader, filePath, gameId);
}

/**
 * Read a UPK package from a buffer.
 */
export function readUPKFromBuffer(buffer: Buffer, filePath: string = "<buffer>", gameId?: string): UPKPackage {
  const reader = new BinaryReader(buffer, Endianness.Little);
  return readUPKFromReader(reader, filePath, gameId);
}

/**
 * Known maxBlockSize values used in FullyCompressed UPK packages.
 * When the uint32 at offset 4 (right after the UPK signature) matches one of
 * these, the file is a FullyCompressed wrapper — decompress first, then parse
 * the contained standard UPK. Used by BioShock Infinite .xxx files, among others.
 */
const FULLY_COMPRESSED_BLOCK_SIZES = new Set([
  0, 65536, 131072, 524288, 2097152, 64512, 1012137984,
]);

function readUPKFromReader(reader: BinaryReader, filePath: string, gameId?: string): UPKPackage {
  // 1. Read signature and detect endianness
  const endianness = readSignature(reader);

  // 1.5. Check for FullyCompressedStorage (e.g., BioShock Infinite .xxx files)
  // The uint32 at offset 4 is the maxBlockSize in a FullyCompressed wrapper,
  // which never collides with valid (fileVersion | licenseeVersion << 16) pairs.
  const peekPos = reader.position;
  const peekValue = reader.readUInt32();
  reader.seek(peekPos);

  if (FULLY_COMPRESSED_BLOCK_SIZES.has(peekValue)) {
    const decompressedReader = decompressFullyCompressed(reader);
    return readUPKFromReader(decompressedReader, filePath, gameId);
  }

  // 2. Read version numbers
  const { fileVersion, licenseeVersion } = readVersions(reader);

  // 3. Determine game profile
  const packageId = getPackageId(fileVersion, licenseeVersion, gameId);
  const profile = createPackageProfile(packageId, fileVersion);

  // 4. Read package summary (header)
  const summary = readPackageSummary(reader, profile);

  // 5. If compressed, decompress the chunks and create a new reader
  let dataReader = reader;
  if (summary.compressionFlag !== CompressionFlag.None && summary.compressionChunks.length > 0) {
    dataReader = decompressPackage(reader, summary);
  }

  // 6. Read tables from the (possibly decompressed) data
  const names = readNameTable(dataReader, summary.nameArray, profile);
  const imports = readImportTable(dataReader, summary.importArray, profile);
  const exports = readExportTable(dataReader, summary.exportArray, profile);

  return {
    filePath,
    endianness,
    fileVersion,
    licenseeVersion,
    packageId,
    profile,
    summary,
    names,
    imports,
    exports,
    dataReader,
  };
}

// ============================================================
//  Summary reading
// ============================================================

function readPackageSummary(reader: BinaryReader, profile: PackageProfile): PackageSummary {
  const sp = profile.summary;

  // --- Header section ---
  // Skip unknown bytes after licensee version
  if (sp.unknownBytesAfterLicenseeVersion > 0) {
    reader.skip(sp.unknownBytesAfterLicenseeVersion);
  }

  // Header size
  let headerSize: number | undefined;
  if (sp.hasHeaderSize) {
    headerSize = reader.readInt32();
  }

  // Package group (FString)
  let packageGroup: string | undefined;
  if (sp.hasPackageGroup) {
    packageGroup = reader.readFString();
  }

  // Package flags
  const packageFlags = reader.readUInt32();

  // --- Arrays section (name/export/import counts and offsets) ---
  const nameArray = readTableArray(reader);
  const exportArray = readTableArray(reader);
  const importArray = readTableArray(reader);

  // --- Depends offset ---
  let dependsOffset: number | undefined;
  if (sp.hasDependsOffset) {
    dependsOffset = reader.readInt32();
  }

  // --- Serialized offset ---
  if (sp.hasSerializedOffset) {
    if (sp.hasSerializedOffset64) {
      reader.skip(8); // int64
    } else {
      reader.skip(4); // int32
    }
  }

  // Unknown bytes after serialized offset
  if (sp.unknownBytesAfterSerializedOffset > 0) {
    reader.skip(sp.unknownBytesAfterSerializedOffset);
  }

  // Unknown int32 before GUID
  if (sp.hasUnknownInt32BeforeGuid) {
    reader.skip(4);
  }

  // GUID
  let guid: FGuid | undefined;
  if (sp.hasGuid) {
    guid = reader.readFGuid();
  }

  // Generations
  const generations: FGenerationInfo[] = [];
  if (sp.hasGenerations) {
    const genCount = reader.readInt32();
    for (let i = 0; i < genCount; i++) {
      const exportCount = reader.readInt32();
      const nameCount = reader.readInt32();
      let netObjectCount: number | undefined;
      // Generations include netObjectCount for fileVersion >= 322
      if (profile.fileVersion >= 322) {
        netObjectCount = reader.readInt32();
      }
      generations.push({ exportCount, nameCount, netObjectCount });
      if (sp.hasGenerationsGuid) {
        reader.skip(16); // FGuid per generation
      }
    }
  }

  // Unknown bytes after generations
  if (sp.unknownBytesAfterGenerations > 0) {
    reader.skip(sp.unknownBytesAfterGenerations);
  }

  // Engine version
  let engineVersion: number | undefined;
  if (sp.hasEngineVersion) {
    engineVersion = reader.readInt32();
  }

  // Cooker version
  let cookerVersion: number | undefined;
  if (sp.hasCookerVersion) {
    cookerVersion = reader.readInt32();
  }

  // Compression flags and chunks
  let compressionFlag = CompressionFlag.None;
  const compressionChunks: CompressedChunk[] = [];

  if (sp.hasCompressionFlagsAndChunks) {
    const flagsInt = reader.readInt32();
    compressionFlag = flagsInt as CompressionFlag;

    // Read chunk definitions
    const chunkCount = reader.readInt32();
    for (let i = 0; i < chunkCount; i++) {
      compressionChunks.push({
        uncompressedOffset: reader.readInt32(),
        uncompressedSize: reader.readInt32(),
        compressedOffset: reader.readInt32(),
        compressedSize: reader.readInt32(),
      });
    }
  } else if (sp.zlibCompressionPackageFlag !== 0
    && (packageFlags & sp.zlibCompressionPackageFlag) !== 0) {
    // BioShock 1/2: compression indicated via package flags
    compressionFlag = CompressionFlag.ZLIB;
  }

  return {
    headerSize,
    packageGroup,
    packageFlags,
    nameArray,
    exportArray,
    importArray,
    dependsOffset,
    guid,
    generations,
    engineVersion,
    cookerVersion,
    compressionFlag,
    compressionChunks,
  };
}

function readTableArray(reader: BinaryReader): TableArray {
  const count = reader.readInt32();
  const offset = reader.readInt32();
  return { count, offset };
}

// ============================================================
//  Name table
// ============================================================

function readNameTable(
  reader: BinaryReader,
  array: TableArray,
  profile: PackageProfile,
): FNameEntry[] {
  reader.seek(array.offset);
  const np = profile.nameEntry;
  const entries: FNameEntry[] = [];

  for (let i = 0; i < array.count; i++) {
    const name = np.usesCompactIndex
      ? readFStringCompact(reader)
      : reader.readFString();
    let flags = 0;
    let flags2 = 0;
    if (np.hasFlags) {
      flags = reader.readInt32();
      if (np.has64BitFlags) {
        flags2 = reader.readInt32();
      }
    }
    entries.push({ name, flags, flags2 });
  }

  return entries;
}

/**
 * Read a UE2-style FString using FCompactIndex for the length.
 * Positive length → Unicode (2 bytes/char), negative → ANSI (1 byte/char).
 * BioShock 1/2 uses this format.
 */
function readFStringCompact(reader: BinaryReader): string {
  const length = readFCompactIndex(reader);
  if (length === 0) return "";

  if (length > 0) {
    // Unicode: length chars × 2 bytes each
    const bytes = reader.readBytes(length * 2);
    // Strip null terminator
    return bytes.subarray(0, (length - 1) * 2).toString("utf16le");
  } else {
    // ANSI: |length| bytes
    const charCount = -length;
    const bytes = reader.readBytes(charCount);
    return bytes.subarray(0, charCount - 1).toString("ascii");
  }
}

// ============================================================
//  Import table
// ============================================================

function readImportTable(
  reader: BinaryReader,
  array: TableArray,
  profile: PackageProfile,
): FObjectImport[] {
  reader.seek(array.offset);
  const entries: FObjectImport[] = [];

  if (profile.isUnreal2) {
    // UE2 format: name indices use FCompactIndex + int32 suffix
    for (let i = 0; i < array.count; i++) {
      const packageName = readFCompactIndex(reader);
      reader.skip(4); // suffix int32
      const typeName = readFCompactIndex(reader);
      reader.skip(4); // suffix int32
      const ownerRef = reader.readInt32(); // always int32
      const objectName = readFCompactIndex(reader);
      reader.skip(4); // suffix int32

      entries.push({ packageName, typeName, ownerRef, objectName });
    }
  } else {
    // UE3 format: all int32
    for (let i = 0; i < array.count; i++) {
      const packageName = reader.readInt32();
      reader.skip(4); // name suffix number
      const typeName = reader.readInt32();
      reader.skip(4); // name suffix number
      const ownerRef = reader.readInt32();
      const objectName = reader.readInt32();
      reader.skip(4); // name suffix number

      if (profile.objectImport.hasUnknownGuidAfterObjectName) {
        reader.skip(16); // FGuid
      }

      entries.push({ packageName, typeName, ownerRef, objectName });
    }
  }

  return entries;
}

// ============================================================
//  Export table
// ============================================================

function readExportTable(
  reader: BinaryReader,
  array: TableArray,
  profile: PackageProfile,
): FObjectExport[] {
  reader.seek(array.offset);

  // UE2 (BioShock) has a completely different export table format
  if (profile.isUnreal2) {
    return readExportTableUE2(reader, array, profile);
  }

  const ep = profile.objectExport;
  const entries: FObjectExport[] = [];

  for (let i = 0; i < array.count; i++) {
    const classIndex = reader.readInt32();

    let parentClassIndex = 0;
    if (!ep.hasMainPackageName) {
      parentClassIndex = reader.readInt32();
    }

    const packageIndex = reader.readInt32();

    if (ep.hasUnknownInt32BeforeObjectName) {
      reader.skip(4);
    }

    const objectName = reader.readInt32();
    reader.skip(4); // name suffix number

    if (ep.hasMainPackageName) {
      parentClassIndex = reader.readInt32();
    }

    let archetypeRef = 0;
    if (ep.hasArchetypeReference) {
      archetypeRef = reader.readInt32();
    }

    if (ep.unknownBytesAfterArchetypeReference > 0) {
      reader.skip(ep.unknownBytesAfterArchetypeReference);
    }

    // Object flags
    let objectFlags = 0;
    let objectFlagsHi = 0;
    if (ep.hasObjectFlags64) {
      objectFlags = reader.readUInt32();
      objectFlagsHi = reader.readUInt32();
    } else {
      objectFlags = reader.readUInt32();
    }

    let guid: FGuid | undefined;
    if (ep.hasGuid && ep.hasGuidAfterFlags) {
      guid = reader.readFGuid();
    }

    if (ep.hasMainPackageName) {
      reader.skip(8); // UNameIndex (int32 + suffix)
    }

    // Serial offset and size
    let serialSize: number;
    let serialOffset: number;
    let serialSizeFilePos: number;
    let serialOffsetFilePos: number;

    if (ep.hasSerialDataOffset64) {
      serialSizeFilePos = reader.position;
      serialSize = Number(reader.readInt64());
      serialOffsetFilePos = reader.position;
      serialOffset = Number(reader.readInt64());
    } else {
      serialSizeFilePos = reader.position;
      serialSize = reader.readInt32();
      serialOffsetFilePos = reader.position;
      serialOffset = reader.readInt32();
    }

    if (ep.unknownBytesAfterSerialOffset > 0) {
      reader.skip(ep.unknownBytesAfterSerialOffset);
    }

    // Component map
    if (ep.hasComponentMap) {
      const componentCount = reader.readInt32();
      reader.skip(componentCount * 8);
    }

    // Export flags
    let exportFlags = 0;
    if (ep.hasExportFlags) {
      exportFlags = reader.readUInt32();
    }

    let exportFlags2 = 0;
    if (ep.hasExportFlags2) {
      if (ep.hasExportFlags2AsByte) {
        exportFlags2 = reader.readByte();
      } else {
        exportFlags2 = reader.readUInt32();
      }
    }

    // Extra data (net objects, GUID)
    // C# logic: if no exportFlags2 field, always has extra data.
    // If exportFlags2 exists, extra data is present when exportFlags2 != 0.
    let netObjectCount = 0;
    const hasExtraData = !ep.hasExportFlags2 || exportFlags2 !== 0;

    if (hasExtraData && !ep.hasMainPackageName) {
      if (ep.hasNetObjectCount) {
        netObjectCount = reader.readInt32();
        // Skip net object indices
        reader.skip(netObjectCount * 4);
      }

      if (ep.hasGuid && !ep.hasGuidAfterFlags) {
        guid = reader.readFGuid();
      }

      if (ep.unknownBytesAfterGuid > 0) {
        reader.skip(ep.unknownBytesAfterGuid);
      }

      if (ep.hasUnknownInt32IfExportFlag8 && (exportFlags & 0x08) !== 0) {
        reader.skip(4);
      }
    }

    entries.push({
      classIndex,
      parentClassIndex,
      packageIndex,
      objectName,
      archetypeRef,
      objectFlags,
      objectFlagsHi,
      serialOffset,
      serialSize,
      exportFlags,
      exportFlags2,
      guid,
      netObjectCount,
      serialSizeFilePos,
      serialOffsetFilePos,
    });
  }

  return entries;
}

/**
 * Read export table in UE2 format (BioShock 1/2).
 *
 * Key differences from UE3:
 * - ClassIndex, ParentClassIndex: FCompactIndex (not int32)
 * - PackageIndex: int32 (NOT compact)
 * - ObjectName: FCompactIndex (name index) + int32 (suffix)
 * - SerialSize, SerialOffset: FCompactIndex (not int32)
 * - No ArchetypeRef (fileVersion < 220)
 * - No ExportFlags, ExportFlags2, ComponentMap, NetObjects, GUID
 */
function readExportTableUE2(
  reader: BinaryReader,
  array: TableArray,
  profile: PackageProfile,
): FObjectExport[] {
  const ep = profile.objectExport;
  const entries: FObjectExport[] = [];

  for (let i = 0; i < array.count; i++) {
    const classIndex = readFCompactIndex(reader);
    const parentClassIndex = readFCompactIndex(reader);
    const packageIndex = reader.readInt32(); // always int32

    if (ep.hasUnknownInt32BeforeObjectName) {
      reader.skip(4);
    }

    const objectName = readFCompactIndex(reader);
    reader.skip(4); // name suffix (int32)

    // Object flags — BioShock uses 64-bit
    let objectFlags = 0;
    let objectFlagsHi = 0;
    if (ep.hasObjectFlags64) {
      objectFlags = reader.readUInt32();
      objectFlagsHi = reader.readUInt32();
    } else {
      objectFlags = reader.readUInt32();
    }

    // Serial size and offset — FCompactIndex in UE2
    // Note: we can't track serialSizeFilePos/serialOffsetFilePos accurately
    // for FCompactIndex since the size varies. For BioShock, we don't do
    // in-place export table patching (uses BulkContent instead), so this is OK.
    const serialSizeFilePos = reader.position;
    const serialSize = readFCompactIndex(reader);
    const serialOffsetFilePos = reader.position;
    const serialOffset = serialSize > 0 ? readFCompactIndex(reader) : 0;

    if (ep.unknownBytesAfterSerialOffset > 0) {
      reader.skip(ep.unknownBytesAfterSerialOffset);
    }

    entries.push({
      classIndex,
      parentClassIndex,
      packageIndex,
      objectName,
      archetypeRef: 0,
      objectFlags,
      objectFlagsHi,
      serialOffset,
      serialSize,
      exportFlags: 0,
      exportFlags2: 0,
      guid: undefined,
      netObjectCount: 0,
      serialSizeFilePos,
      serialOffsetFilePos,
    });
  }

  return entries;
}

// ============================================================
//  Decompression
// ============================================================

/**
 * Decompress a compressed UPK package.
 *
 * UPK compression works at the chunk level. Each chunk in the summary's
 * compressionChunks array points to compressed data in the file. That
 * compressed data starts with a chunk header:
 *   - Signature (4 bytes, 0x9E2A83C1)
 *   - MaxBlockSize (4 bytes, usually 131072 = 128KB)
 *   - Sum block: compressedSize (4 bytes) + uncompressedSize (4 bytes)
 *   - N block descriptors: compressedSize (4) + uncompressedSize (4) each
 *     where N = ceil(sum.uncompressedSize / maxBlockSize)
 *   - Then the actual compressed block data follows sequentially
 *
 * We decompress all blocks, place them at the correct uncompressed offset,
 * and return a new BinaryReader over the full uncompressed buffer.
 * The header (before the first chunk's uncompressedOffset) is copied as-is.
 */
function decompressPackage(reader: BinaryReader, summary: PackageSummary): BinaryReader {
  // Calculate total uncompressed size from chunks
  let totalSize = 0;
  for (const chunk of summary.compressionChunks) {
    const end = chunk.uncompressedOffset + chunk.uncompressedSize;
    if (end > totalSize) totalSize = end;
  }

  const output = Buffer.alloc(totalSize);

  // Copy header data (everything before the first chunk's uncompressed offset)
  const headerEnd = summary.compressionChunks[0].uncompressedOffset;
  reader.getBuffer().copy(output, 0, 0, headerEnd);

  for (const chunk of summary.compressionChunks) {
    // Seek to the compressed data in the file
    reader.seek(chunk.compressedOffset);

    // Read chunk header
    const sig = reader.readUInt32();
    if (sig !== UPK_SIGNATURE_LE) {
      throw new Error(
        `Invalid compressed chunk signature: 0x${sig.toString(16).toUpperCase()}, ` +
        `expected 0x${UPK_SIGNATURE_LE.toString(16).toUpperCase()}`
      );
    }

    const maxBlockSize = reader.readUInt32();

    // Sum block (total compressed + uncompressed for this chunk)
    const sumCompressedSize = reader.readUInt32();
    const sumUncompressedSize = reader.readUInt32();

    // Calculate number of blocks
    const blockCount = Math.ceil(sumUncompressedSize / maxBlockSize);

    // Read per-block size descriptors
    const blocks: Array<{ compressedSize: number; uncompressedSize: number }> = [];
    for (let i = 0; i < blockCount; i++) {
      blocks.push({
        compressedSize: reader.readUInt32(),
        uncompressedSize: reader.readUInt32(),
      });
    }

    // Now read and decompress each block's data
    let outputOffset = chunk.uncompressedOffset;
    for (const block of blocks) {
      const compressedData = reader.readBytes(block.compressedSize);
      const decompressed = decompress(compressedData, summary.compressionFlag, block.uncompressedSize);

      if (decompressed.length !== block.uncompressedSize) {
        throw new Error(
          `Decompression size mismatch: got ${decompressed.length}, expected ${block.uncompressedSize}`
        );
      }

      decompressed.copy(output, outputOffset);
      outputOffset += block.uncompressedSize;
    }
  }

  return new BinaryReader(output, reader.endianness);
}

/**
 * Decompress a FullyCompressed UPK package.
 *
 * FullyCompressed format (used by BioShock Infinite .xxx files, etc.):
 *   - UPK Signature (4 bytes) — already consumed by readSignature()
 *   - MaxBlockSize (4 bytes) — doubles as FullyCompressed detection key
 *   - SumCompressedSize (4 bytes)
 *   - SumUncompressedSize (4 bytes)
 *   - N × { BlockDiskSize(4), BlockUncompressedSize(4) }
 *     where N = ceil(SumUncompressedSize / MaxBlockSize)
 *   - Compressed block data follows immediately
 *
 * The decompressed output is a complete standard UPK file (with its own signature).
 * Always uses LZO compression.
 */
function decompressFullyCompressed(reader: BinaryReader): BinaryReader {
  // Reader is at offset 4 (right after UPK signature)
  const maxBlockSize = reader.readUInt32();
  const sumCompressedSize = reader.readUInt32();
  const sumUncompressedSize = reader.readUInt32();

  if (sumUncompressedSize === 0) {
    return new BinaryReader(Buffer.alloc(0), Endianness.Little);
  }

  const blockCount = maxBlockSize > 0
    ? Math.ceil(sumUncompressedSize / maxBlockSize)
    : 1;

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
    const decompressed = decompress(
      compressedData, CompressionFlag.LZO, block.uncompressedSize,
    );
    decompressed.copy(output, outputOffset);
    outputOffset += block.uncompressedSize;
  }

  return new BinaryReader(output, Endianness.Little);
}

// ============================================================
//  Selective (header-only) reading for block-level patching
// ============================================================

/**
 * Result of selective package parsing.
 * Contains the parsed package (tables + metadata) plus a ChunkManager
 * for lazy, selective decompression of individual chunks.
 */
export interface SelectiveParseResult {
  pkg: UPKPackage;
  chunkMgr: ChunkManager | null;
  headerEnd: number;
  fileBuffer: Buffer;
  compressionFlagOffset: number;
}

/**
 * Read a UPK package selectively — parse header and tables without
 * fully decompressing all chunks.
 *
 * For compressed packages, returns a ChunkManager that can selectively
 * decompress individual chunks on demand. For uncompressed packages,
 * chunkMgr is null and the pkg.dataReader covers the whole file.
 */
export function readUPKPackageSelective(
  filePath: string,
  gameId?: string,
): SelectiveParseResult {
  const fileBuffer = fs.readFileSync(filePath);
  const reader = new BinaryReader(fileBuffer, Endianness.Little);

  // Read signature and detect endianness
  const endianness = readSignature(reader);

  // Check for FullyCompressedStorage
  const peekPos = reader.position;
  const peekValue = reader.readUInt32();
  reader.seek(peekPos);

  if (FULLY_COMPRESSED_BLOCK_SIZES.has(peekValue)) {
    // FullyCompressed — must fully decompress the wrapper, then parse inner UPK
    // Fall back to full decompression for the outer layer
    const pkg = readUPKPackage(filePath, gameId);
    return {
      pkg,
      chunkMgr: null,
      headerEnd: 0,
      fileBuffer,
      compressionFlagOffset: 0,
    };
  }

  // Read versions
  const { fileVersion, licenseeVersion } = readVersions(reader);
  const packageId = getPackageId(fileVersion, licenseeVersion, gameId);
  const profile = createPackageProfile(packageId, fileVersion);

  // Read summary (header) — this is always uncompressed
  const summary = readPackageSummary(reader, profile);

  if (summary.compressionFlag === CompressionFlag.None
    || summary.compressionChunks.length === 0) {
    // Uncompressed package — no selective decompression needed
    const names = readNameTable(reader, summary.nameArray, profile);
    const imports = readImportTable(reader, summary.importArray, profile);
    const exports = readExportTable(reader, summary.exportArray, profile);

    const pkg: UPKPackage = {
      filePath, endianness, fileVersion, licenseeVersion,
      packageId, profile, summary, names, imports, exports,
      dataReader: reader,
    };
    return { pkg, chunkMgr: null, headerEnd: 0, fileBuffer, compressionFlagOffset: 0 };
  }

  // Compressed package — create ChunkManager for selective decompression
  const headerEnd = summary.compressionChunks[0].uncompressedOffset;
  const chunkMgr = new ChunkManager(fileBuffer, summary.compressionChunks, summary.compressionFlag);

  // Find compression flag offset for later use in buildOutput
  const compressionFlagOffset = findCompressionFlagOffsetFromReader(fileBuffer, profile, fileVersion);

  // Compute table sizes using inter-table offsets (tables are contiguous:
  // names → imports → exports → depends/serial data).
  // Sort table offsets to determine boundaries.
  const tableOffsets = [
    { kind: "name" as const, offset: summary.nameArray.offset, count: summary.nameArray.count },
    { kind: "import" as const, offset: summary.importArray.offset, count: summary.importArray.count },
    { kind: "export" as const, offset: summary.exportArray.offset, count: summary.exportArray.count },
  ].sort((a, b) => a.offset - b.offset);

  // Use dependsOffset or headerSize as the upper bound for the last table.
  // The depends table immediately follows the export table in UE3 packages.
  const lastTable = tableOffsets[tableOffsets.length - 1];
  const lastTableEnd = summary.dependsOffset
    ?? summary.headerSize
    ?? (lastTable.offset + lastTable.count * 256 + 4096);

  // Each table's size: either bounded by the next table's offset, or by dependsOffset
  const tableSizes = tableOffsets.map((t, i) => {
    const nextOffset = i < tableOffsets.length - 1
      ? tableOffsets[i + 1].offset
      : lastTableEnd;
    return { ...t, size: nextOffset - t.offset };
  });

  const nameEntry = tableSizes.find(t => t.kind === "name")!;
  const importEntry = tableSizes.find(t => t.kind === "import")!;
  const exportEntry = tableSizes.find(t => t.kind === "export")!;

  const tableReader = chunkMgr.createReaderForTables(
    nameEntry.offset, nameEntry.size,
    importEntry.offset, importEntry.size,
    exportEntry.offset, exportEntry.size,
  );

  // Read tables from the composite reader
  const names = readNameTable(tableReader, summary.nameArray, profile);
  const imports = readImportTable(tableReader, summary.importArray, profile);
  const exports = readExportTable(tableReader, summary.exportArray, profile);

  const pkg: UPKPackage = {
    filePath, endianness, fileVersion, licenseeVersion,
    packageId, profile, summary, names, imports, exports,
    dataReader: tableReader, // limited reader — only covers tables
  };

  return { pkg, chunkMgr, headerEnd, fileBuffer, compressionFlagOffset };
}

/**
 * Find the compression flag offset by parsing the header.
 * Works on the raw file buffer (not decompressed).
 */
function findCompressionFlagOffsetFromReader(
  fileBuffer: Buffer,
  profile: PackageProfile,
  fileVersion: number,
): number {
  const reader = new BinaryReader(
    Buffer.from(fileBuffer.subarray(0, Math.min(4096, fileBuffer.length))),
    Endianness.Little,
  );

  // signature(4) + fileVersion(2) + licenseeVersion(2)
  reader.skip(4 + 2 + 2);

  const sp = profile.summary;
  if (sp.unknownBytesAfterLicenseeVersion > 0) reader.skip(sp.unknownBytesAfterLicenseeVersion);
  if (sp.hasHeaderSize) reader.skip(4);
  if (sp.hasPackageGroup) reader.readFString();
  reader.skip(4); // packageFlags
  reader.skip(4 * 2); // name count + offset
  reader.skip(4 * 2); // export count + offset
  reader.skip(4 * 2); // import count + offset
  if (sp.hasDependsOffset) reader.skip(4);
  if (sp.hasSerializedOffset) reader.skip(sp.hasSerializedOffset64 ? 8 : 4);
  if (sp.unknownBytesAfterSerializedOffset > 0) reader.skip(sp.unknownBytesAfterSerializedOffset);
  if (sp.hasUnknownInt32BeforeGuid) reader.skip(4);
  if (sp.hasGuid) reader.skip(16);
  if (sp.hasGenerations) {
    const genCount = reader.readInt32();
    for (let i = 0; i < genCount; i++) {
      reader.skip(4 + 4);
      if (sp.hasGenerationsGuid) reader.skip(16);
      if (fileVersion >= 322) reader.skip(4);
    }
  }
  if (sp.unknownBytesAfterGenerations > 0) reader.skip(sp.unknownBytesAfterGenerations);
  if (sp.hasEngineVersion) reader.skip(4);
  if (sp.hasCookerVersion) reader.skip(4);

  return reader.position;
}

// ============================================================
//  Utility functions
// ============================================================

/**
 * Resolve an object name from the name table.
 */
export function resolveName(pkg: UPKPackage, nameIndex: number): string {
  if (nameIndex < 0 || nameIndex >= pkg.names.length) {
    return `<invalid:${nameIndex}>`;
  }
  return pkg.names[nameIndex].name;
}

/**
 * Resolve a class name for an export entry.
 * classIndex > 0 → export entry, < 0 → import entry, 0 → Class class
 */
export function resolveClassName(pkg: UPKPackage, classIndex: number): string {
  if (classIndex === 0) return "Class";
  if (classIndex > 0) {
    // Export reference (1-based)
    const exp = pkg.exports[classIndex - 1];
    return exp ? resolveName(pkg, exp.objectName) : `<export:${classIndex}>`;
  }
  // Import reference (negative, 1-based)
  const imp = pkg.imports[-classIndex - 1];
  return imp ? resolveName(pkg, imp.objectName) : `<import:${classIndex}>`;
}

/**
 * Find all export entries of a given class name.
 */
export function findExportsByClass(pkg: UPKPackage, className: string): FObjectExport[] {
  return pkg.exports.filter(exp => resolveClassName(pkg, exp.classIndex) === className);
}

/**
 * Get the full object path for an export entry.
 */
export function getExportPath(pkg: UPKPackage, exportIndex: number): string {
  const parts: string[] = [];
  let idx = exportIndex;

  while (idx > 0) {
    const exp = pkg.exports[idx - 1];
    if (!exp) break;
    parts.unshift(resolveName(pkg, exp.objectName));
    idx = exp.packageIndex;
  }

  if (idx < 0) {
    // Package reference is an import
    const imp = pkg.imports[-idx - 1];
    if (imp) {
      parts.unshift(resolveName(pkg, imp.objectName));
    }
  }

  return parts.join(".");
}

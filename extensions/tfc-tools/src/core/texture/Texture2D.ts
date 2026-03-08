import { BinaryReader, FGuid } from "../binary";
import { PackageProfile } from "../packages/PackageProfile";
import { UPKPackage, FObjectExport, resolveName, resolveClassName, getExportPath } from "../packages/UPKPackage";
import { readProperties, UProperty, getIntProperty, getNameProperty, getByteProperty } from "./UProperty";
import { readFByteBulkData, FByteBulkData } from "./FByteBulkData";

/**
 * A single mipmap level within a Texture2D.
 */
export interface Texture2DMipMap {
  bulkData: FByteBulkData;
  sizeX: number;
  sizeY: number;
}

/**
 * Parsed Texture2D object data from a UPK package.
 */
export interface Texture2DData {
  /** Export entry this was read from */
  exportIndex: number;
  /** Object name */
  objectName: string;
  /** Full object path */
  objectPath: string;
  /** UE3 properties */
  properties: UProperty[];
  /** Texture dimensions (from properties or header) */
  sizeX: number;
  sizeY: number;
  /** Pixel format name (e.g. "PF_DXT1", "PF_DXT5") */
  pixelFormatName: string;
  /** TFC file cache name (if stored externally) */
  textureFileCacheName?: string;
  /** Source art bulk data (if present) */
  sourceArt?: FByteBulkData;
  /** Main mipmap array */
  mipmaps: Texture2DMipMap[];
  /** TFC GUID (if present) */
  tfcGuid?: FGuid;
  /** Byte offset where properties start (within decompressed package) */
  serialOffset: number;
  /** Total serialized size */
  serialSize: number;
}

/**
 * Read a Texture2D object from a UPK package.
 *
 * @param reader BinaryReader positioned at the export's serial data, or the
 *               decompressed package reader (will seek to serialOffset)
 * @param pkg The parsed UPK package (for name table resolution)
 * @param exportEntry The export table entry for this Texture2D
 * @param exportIndex 1-based export index
 */
export function readTexture2D(
  reader: BinaryReader,
  pkg: UPKPackage,
  exportEntry: FObjectExport,
  exportIndex: number,
): Texture2DData {
  const profile = pkg.profile;
  const tp = profile.texture2D;
  const serialOffset = exportEntry.serialOffset;
  const serialSize = exportEntry.serialSize;

  reader.seek(serialOffset);

  // 0. Skip object preamble (netIndex)
  if (profile.object.hasNetIndex) {
    reader.skip(4); // netIndex (int32)
  }

  // 1. Read UE3 properties
  const properties = readProperties(reader, pkg);

  // 2. Read Texture2DHeader (source art, etc.)
  let sourceArt: FByteBulkData | undefined;
  if (tp.hasSourceArt) {
    sourceArt = readFByteBulkData(reader, profile.byteBulkData, false);
  }

  if (tp.hasSourceArt2) {
    // Read and discard second source art
    readFByteBulkData(reader, profile.byteBulkData, false);
  }

  if (tp.hasSourceFilePath) {
    // Skip source file path FString
    reader.readFString();
  }

  if (tp.unknownBytesAfterSourceArt > 0) {
    reader.skip(tp.unknownBytesAfterSourceArt);
  }

  if (tp.hasUnknownIntArrayBeforeMipmaps) {
    const count = reader.readInt32();
    reader.skip(count * 4);
  }

  // 3. Read SizeX, SizeY, PixelFormat (if not stored as properties)
  let sizeX: number;
  let sizeY: number;
  let pixelFormatName: string;

  if (tp.hasSizeAndFormatAsProperties) {
    sizeX = getIntProperty(properties, "SizeX") ?? 0;
    sizeY = getIntProperty(properties, "SizeY") ?? 0;
    // Format can be stored as ByteProperty (enum) or NameProperty
    pixelFormatName = getByteProperty(properties, "Format", pkg)
      ?? getNameProperty(properties, "Format", pkg)
      ?? "Unknown";
  } else {
    sizeX = reader.readInt32();
    sizeY = reader.readInt32();
    const formatInt = reader.readInt32();
    pixelFormatName = pixelFormatIntToName(formatInt);
  }

  // 4. Read mipmap array
  const mipCount = reader.readInt32();
  const mipmaps: Texture2DMipMap[] = [];

  for (let i = 0; i < mipCount; i++) {
    const mip = readTexture2DMipMap(reader, profile);
    mipmaps.push(mip);
  }

  // 5. Read extra data
  // Skip unknown bytes after mipmaps
  if (tp.unknownBytesAfterMipmaps > 0) {
    reader.skip(tp.unknownBytesAfterMipmaps);
  }

  // TFC GUID
  let tfcGuid: FGuid | undefined;
  if (tp.hasTFCguid) {
    tfcGuid = reader.readFGuid();
  }

  // Cached mips (PVRTC, Flash, ETC) — just need to skip them
  if (tp.hasCachedPVRTCMips) {
    skipCachedMipCollection(reader, profile);
  }
  if (tp.hasCachedFlashMips) {
    skipCachedMipCollection(reader, profile);
  }
  if (tp.hasCachedETCMips) {
    skipCachedMipCollection(reader, profile);
  }

  // TextureFileCacheName from properties
  const textureFileCacheName = getNameProperty(properties, "TextureFileCacheName", pkg);

  // Object name and path
  const objectName = resolveName(pkg, exportEntry.objectName);
  const objectPath = getExportPath(pkg, exportIndex);

  return {
    exportIndex,
    objectName,
    objectPath,
    properties,
    sizeX,
    sizeY,
    pixelFormatName,
    textureFileCacheName,
    sourceArt,
    mipmaps,
    tfcGuid,
    serialOffset,
    serialSize,
  };
}

/**
 * Read a single FTexture2DMipMap entry.
 */
function readTexture2DMipMap(reader: BinaryReader, profile: PackageProfile): Texture2DMipMap {
  const mp = profile.mipMap;

  // Object header (BioShock 1/2)
  if (mp.hasObjectHeader) {
    // FObjectHeader: version (int32), size (int32), className name index (int32 + int32)
    reader.skip(16);
    // If version >= 1, also has a skip array (TLazyByteArray)
    // For simplicity, read the version and handle
    // Actually we already skipped it. Let me re-read from reference...
    // The FObjectHeader is: just a 4-byte int32 version field for most games
    // But the exact format varies. For BioShock: skip 4 bytes (version).
    // This needs refinement per the C# FObjectHeader code.
    // For now, rewind and do it properly:
    reader.seek(reader.position - 16);
    // Read minimal object header (version only)
    const version = reader.readInt32();
    if (version === 1) {
      // Skip TMipLazyByteArray (another FByteBulkData essentially)
      readFByteBulkData(reader, profile.byteBulkData, false);
    }
  }

  if (mp.hasUnknownInt64) {
    reader.skip(8);
  }

  if (mp.hasIndex) {
    reader.skip(4); // mip index
  }

  // FByteBulkData — the actual mip data reference
  const bulkData = readFByteBulkData(reader, profile.byteBulkData, false);

  // X360 gamma data
  if (mp.hasX360GammaData) {
    readFByteBulkData(reader, profile.byteBulkData, false);
  }

  // Mip dimensions
  const sizeX = reader.readUInt32();
  const sizeY = reader.readUInt32();

  // UE2 byte array (uBits, vBits)
  if (mp.hasByteArray) {
    reader.skip(2);
  }

  return { bulkData, sizeX, sizeY };
}

/**
 * Skip a cached mipmap collection (PVRTC, Flash, ETC).
 * These are TArray<FTexture2DMipMap> — count + N mipmaps.
 */
function skipCachedMipCollection(reader: BinaryReader, profile: PackageProfile): void {
  const count = reader.readInt32();
  for (let i = 0; i < count; i++) {
    readTexture2DMipMap(reader, profile);
  }
}

/**
 * Read all Texture2D objects from a UPK package.
 *
 * Only matches "Texture2D" (UE3). BioShock's UE2 "Texture" class has a
 * different serialized format and is handled through the BulkContent path.
 */
export function readAllTextures(
  reader: BinaryReader,
  pkg: UPKPackage,
): Texture2DData[] {
  const textures: Texture2DData[] = [];

  for (let i = 0; i < pkg.exports.length; i++) {
    const exp = pkg.exports[i];
    const className = resolveClassName(pkg, exp.classIndex);
    if (className === "Texture2D") {
      try {
        const tex = readTexture2D(reader, pkg, exp, i + 1);
        textures.push(tex);
      } catch (e: any) {
        // Skip textures that fail to parse (corrupted or unsupported)
        const name = resolveName(pkg, exp.objectName);
        console.warn(`Failed to parse Texture2D "${name}": ${e.message}`);
      }
    }
  }

  return textures;
}

// --- Internal helpers ---

const PIXEL_FORMAT_NAMES: Record<number, string> = {
  0: "PF_Unknown",
  1: "PF_A32B32G32R32F",
  2: "PF_A8R8G8B8",
  3: "PF_G8",
  4: "PF_G16",
  5: "PF_DXT1",
  6: "PF_DXT3",
  7: "PF_DXT5",
  8: "PF_UYVY",
  9: "PF_FloatRGB",
  10: "PF_FloatRGBA",
  11: "PF_DepthStencil",
  12: "PF_ShadowDepth",
  13: "PF_FilteredShadowDepth",
  14: "PF_R32F",
  15: "PF_G16R16",
  16: "PF_G16R16F",
  17: "PF_G16R16F_FILTER",
  18: "PF_G32R32F",
  19: "PF_A2B10G10R10",
  20: "PF_A16B16G16R16",
  21: "PF_D24",
  22: "PF_R16F",
  23: "PF_R16F_FILTER",
  24: "PF_BC5",
  25: "PF_V8U8",
  26: "PF_A1",
  27: "PF_FloatR11G11B10",
  28: "PF_A4R4G4B4",
  29: "PF_R5G6B5",
};

function pixelFormatIntToName(value: number): string {
  return PIXEL_FORMAT_NAMES[value] ?? `PF_Unknown_${value}`;
}

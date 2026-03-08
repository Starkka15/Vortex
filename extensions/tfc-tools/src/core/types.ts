/**
 * Compression flags used in UPK packages and TFC data.
 */
export enum CompressionFlag {
  None = 0,
  ZLIB = 1,
  LZO = 2,
  LZX = 4,
  LZ4 = 16,
  Oodle = 32,
  ZStd = 64,
}

/**
 * Target platform — affects endianness and format details.
 */
export enum Platform {
  PC = "PC",
  PS3 = "PS3",
  PS4 = "PS4",
  XBox360 = "XBox360",
  Switch = "Switch",
  WiiU = "WiiU",
}

/**
 * Where mipmap/bulk data is stored.
 */
export enum StorageType {
  /** Data is inline within the package */
  Local = 0,
  /** Data is in an external .tfc file */
  TFC = 1,
  /** Data is in another UPK package */
  ExternalPackage = 2,
}

/**
 * Bulk data flags (from FByteBulkData).
 */
export enum BulkDataFlags {
  None = 0,
  StoreInSeparateFile = 0x01,
  CompressedZlib = 0x02,
  ForceSingleElementSerialization = 0x04,
  CompressedLzo = 0x10,
  Unused = 0x20,
  StoreOnlyPayload = 0x100,
  CompressedLzx = 0x200,
}

/**
 * Package compression mode.
 */
export enum PackageRecompression {
  None = 0,
  Partial = 1,
  All = 2,
}

/**
 * UPK package flags.
 */
export enum PackageFlags {
  None = 0,
  AllowDownload = 0x0001,
  ClientOptional = 0x0002,
  ServerSideOnly = 0x0004,
  Cooked = 0x0008,
  StoreCompressed = 0x02000000,
  StoreFullyCompressed = 0x04000000,
}

/**
 * Common pixel formats for UE3 textures.
 */
export enum PixelFormat {
  Unknown = 0,
  DXT1 = 1,
  DXT3 = 2,
  DXT5 = 3,
  V8U8 = 4,
  A8R8G8B8 = 5,
  G8 = 6,
  BC5 = 7,
  BC7 = 8,
  FloatRGBA = 9,
  A1 = 10,
  CxV8U8 = 11,
  G16 = 12,
}

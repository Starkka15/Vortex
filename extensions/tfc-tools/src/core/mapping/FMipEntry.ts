import { BinaryReader, BinaryWriter } from "../binary";
import { CompressionFlag } from "../types";

/** Version 1 (legacy) — no version header in the mapping file */
export const LEGACY_VERSION = 1;

/**
 * A single mipmap entry in a .TFCMapping file.
 * Describes where one mip level's data lives in a .tfc file.
 */
export interface FMipEntry {
  /** Compression method for this mip's data */
  compression: CompressionFlag;
  /** Byte offset of this mip's data in the .tfc file */
  offsetOnDisk: number;
  /** Compressed size in bytes */
  sizeOnDisk: number;
  /** Uncompressed size in bytes */
  elementCount: number;
  /** Texture width at this mip level */
  sizeX: number;
  /** Texture height at this mip level */
  sizeY: number;
}

/**
 * Read an FMipEntry from a binary stream.
 * @param defaultCompression - used for v1 files where compression isn't stored per-mip
 *   (TFC mips default to LZO, local mips default to None)
 */
export function readFMipEntry(
  reader: BinaryReader,
  version: number,
  defaultCompression: CompressionFlag,
): FMipEntry {
  const compression = version > LEGACY_VERSION
    ? reader.readInt32()
    : defaultCompression;

  const offsetOnDisk = reader.readInt32();

  let sizeOnDisk: number;
  let elementCount: number;

  if (version === LEGACY_VERSION && compression === CompressionFlag.None) {
    // v1 uncompressed: single int32 serves as both elementCount and sizeOnDisk
    elementCount = reader.readInt32();
    sizeOnDisk = elementCount;
  } else {
    sizeOnDisk = reader.readInt32();
    elementCount = reader.readInt32();
  }

  const sizeX = reader.readUInt32();
  const sizeY = reader.readUInt32();

  return { compression, offsetOnDisk, sizeOnDisk, elementCount, sizeX, sizeY };
}

export function writeFMipEntry(
  writer: BinaryWriter,
  entry: FMipEntry,
  version: number,
): void {
  if (version > LEGACY_VERSION) {
    writer.writeInt32(entry.compression);
  }

  writer.writeUInt32(entry.offsetOnDisk);

  if (version === LEGACY_VERSION && entry.compression === CompressionFlag.None) {
    writer.writeInt32(entry.elementCount);
  } else {
    writer.writeInt32(entry.sizeOnDisk);
    writer.writeInt32(entry.elementCount);
  }

  writer.writeUInt32(entry.sizeX);
  writer.writeUInt32(entry.sizeY);
}

import * as fs from "fs";
import { BinaryReader, Endianness } from "../binary";
import { decompress } from "../compression";
import { CompressionFlag } from "../types";
import { UPK_SIGNATURE_LE } from "../packages/Signature";
import { FByteBulkData, BulkDataStorageType } from "./FByteBulkData";

/**
 * Read mipmap pixel data from a TFC file.
 *
 * TFC files are flat data containers — no header, just raw texture data
 * at specific offsets. If the data is compressed, it uses UE3's chunk-based
 * compression format (same as UPK package chunks):
 *   Signature(4) + MaxBlockSize(4) + SumBlock(8) + N×BlockDescriptor(8) + N×CompressedData
 *
 * @param tfcPath Path to the .tfc file
 * @param bulkData The FByteBulkData descriptor from the Texture2D mipmap
 * @returns Uncompressed pixel data buffer
 */
export function readTFCMipData(tfcPath: string, bulkData: FByteBulkData): Buffer {
  if (bulkData.storageType !== BulkDataStorageType.ExternalFile) {
    throw new Error("readTFCMipData called for non-external bulk data");
  }

  if (bulkData.diskSize <= 0 || bulkData.unused) {
    return Buffer.alloc(0);
  }

  const fd = fs.openSync(tfcPath, "r");
  try {
    const rawData = Buffer.alloc(bulkData.diskSize);
    fs.readSync(fd, rawData, 0, bulkData.diskSize, bulkData.diskOffset);

    if (bulkData.compressionFlag === CompressionFlag.None) {
      return rawData;
    }

    // Compressed data uses chunk-based format
    return decompressChunkData(rawData, bulkData.compressionFlag);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read mipmap pixel data from a buffer (for TFC data already loaded in memory).
 */
export function readTFCMipDataFromBuffer(
  buffer: Buffer,
  bulkData: FByteBulkData,
): Buffer {
  if (bulkData.diskSize <= 0 || bulkData.unused) {
    return Buffer.alloc(0);
  }

  const rawData = buffer.subarray(bulkData.diskOffset, bulkData.diskOffset + bulkData.diskSize);

  if (bulkData.compressionFlag === CompressionFlag.None) {
    return Buffer.from(rawData);
  }

  return decompressChunkData(Buffer.from(rawData), bulkData.compressionFlag);
}

/**
 * Resolve a TFC file path from a texture's TextureFileCacheName and a game directory.
 * Searches for .tfc files in the given directories.
 *
 * @param tfcName The TextureFileCacheName from the Texture2D properties (e.g., "Textures")
 * @param searchDirs Directories to search for the TFC file
 * @param extensions File extensions to try (default: [".tfc"])
 * @returns Full path to the TFC file, or undefined if not found
 */
export function findTFCFile(
  tfcName: string,
  searchDirs: string[],
  extensions: string[] = [".tfc"],
): string | undefined {
  for (const dir of searchDirs) {
    for (const ext of extensions) {
      const filePath = `${dir}/${tfcName}${ext}`;
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
  }
  return undefined;
}

/**
 * Decompress chunk-based compressed data (UE3 format).
 *
 * Format:
 *   Signature (4 bytes, 0x9E2A83C1)
 *   MaxBlockSize (4 bytes)
 *   Sum: compressedSize (4) + uncompressedSize (4)
 *   N × BlockDescriptor: compressedSize (4) + uncompressedSize (4)
 *   N × compressed block data
 *
 * Where N = ceil(sumUncompressedSize / maxBlockSize)
 */
function decompressChunkData(data: Buffer, compressionFlag: CompressionFlag): Buffer {
  const reader = new BinaryReader(data, Endianness.Little);

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

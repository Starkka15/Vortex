import { BinaryReader, Endianness } from "../binary";
import { CompressionFlag } from "../types";
import { decompress, compress } from "./index";
import { UPK_SIGNATURE_LE } from "../packages/Signature";
import { CompressedChunk } from "../packages/UPKPackage";

/**
 * Runtime info for a single compressed chunk in a UPK package.
 * Tracks lazy decompression state and modification status.
 */
export interface ChunkInfo {
  index: number;
  /** Byte range in the decompressed address space */
  uncompressedOffset: number;
  uncompressedSize: number;
  /** Byte range in the compressed (on-disk) file */
  compressedOffset: number;
  compressedSize: number;
  /** Lazily-decompressed data (null until needed) */
  decompressedData: Buffer | null;
  /** Whether this chunk has been modified and needs recompression */
  modified: boolean;
}

/**
 * Manages lazy, selective decompression and recompression of UPK compressed chunks.
 *
 * Instead of decompressing the entire package, the ChunkManager only decompresses
 * the specific chunks that contain data being read or modified. At write time,
 * only modified chunks are recompressed — unmodified chunks are copied verbatim
 * from the original file.
 */
export class ChunkManager {
  private fileBuffer: Buffer;
  private chunks: ChunkInfo[];
  private compressionFlag: CompressionFlag;
  private headerEnd: number;

  constructor(
    fileBuffer: Buffer,
    compressionChunks: CompressedChunk[],
    compressionFlag: CompressionFlag,
  ) {
    this.fileBuffer = fileBuffer;
    this.compressionFlag = compressionFlag;
    this.headerEnd = compressionChunks[0].uncompressedOffset;

    this.chunks = compressionChunks.map((c, i) => ({
      index: i,
      uncompressedOffset: c.uncompressedOffset,
      uncompressedSize: c.uncompressedSize,
      compressedOffset: c.compressedOffset,
      compressedSize: c.compressedSize,
      decompressedData: null,
      modified: false,
    }));
  }

  /**
   * Find the chunk(s) that contain a given uncompressed byte range.
   */
  findChunksForRange(start: number, length: number): ChunkInfo[] {
    const end = start + length;
    return this.chunks.filter(c =>
      c.uncompressedOffset < end &&
      (c.uncompressedOffset + c.uncompressedSize) > start
    );
  }

  /**
   * Decompress a single chunk (if not already cached).
   */
  private ensureDecompressed(chunk: ChunkInfo): Buffer {
    if (chunk.decompressedData) return chunk.decompressedData;

    const reader = new BinaryReader(this.fileBuffer, Endianness.Little);
    reader.seek(chunk.compressedOffset);

    // Read chunk header
    const sig = reader.readUInt32();
    if (sig !== UPK_SIGNATURE_LE) {
      throw new Error(
        `Invalid chunk signature at offset ${chunk.compressedOffset}: ` +
        `0x${sig.toString(16).toUpperCase()}`
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

    const output = Buffer.alloc(chunk.uncompressedSize);
    let outputOffset = 0;
    for (const block of blocks) {
      const compressedData = reader.readBytes(block.compressedSize);
      const decompressed = decompress(compressedData, this.compressionFlag, block.uncompressedSize);
      decompressed.copy(output, outputOffset);
      outputOffset += block.uncompressedSize;
    }

    chunk.decompressedData = output;
    return output;
  }

  /**
   * Read bytes from the decompressed address space.
   * Only decompresses the chunk(s) that overlap the requested range.
   */
  readBytes(uncompressedOffset: number, length: number): Buffer {
    // If entirely in header, read directly
    if (uncompressedOffset + length <= this.headerEnd) {
      return Buffer.from(this.fileBuffer.subarray(uncompressedOffset, uncompressedOffset + length));
    }

    const chunks = this.findChunksForRange(uncompressedOffset, length);
    if (chunks.length === 0) {
      throw new Error(
        `No chunk contains uncompressed range [${uncompressedOffset}, ${uncompressedOffset + length})`
      );
    }

    if (chunks.length === 1) {
      const chunk = chunks[0];
      const data = this.ensureDecompressed(chunk);
      const localOffset = uncompressedOffset - chunk.uncompressedOffset;
      return Buffer.from(data.subarray(localOffset, localOffset + length));
    }

    // Spans multiple chunks — assemble from each
    const result = Buffer.alloc(length);
    let resultPos = 0;

    for (const chunk of chunks) {
      const data = this.ensureDecompressed(chunk);
      const chunkStart = chunk.uncompressedOffset;
      const chunkEnd = chunkStart + chunk.uncompressedSize;

      const readStart = Math.max(uncompressedOffset, chunkStart);
      const readEnd = Math.min(uncompressedOffset + length, chunkEnd);
      const readLen = readEnd - readStart;

      const localOffset = readStart - chunkStart;
      data.copy(result, resultPos, localOffset, localOffset + readLen);
      resultPos += readLen;
    }

    return result;
  }

  /**
   * Create a BinaryReader over a decompressed byte range.
   * The reader's position 0 maps to `uncompressedOffset`.
   */
  createReaderForRange(uncompressedOffset: number, length: number): BinaryReader {
    const data = this.readBytes(uncompressedOffset, length);
    return new BinaryReader(data, Endianness.Little);
  }

  /**
   * Create a BinaryReader over the full decompressed address space for table parsing.
   * This assembles the header + all chunks that contain the name/import/export tables.
   *
   * Unlike full decompression, this only decompresses chunks that contain
   * table data (typically just the first 1-2 chunks).
   */
  createReaderForTables(
    nameOffset: number, nameSize: number,
    importOffset: number, importSize: number,
    exportOffset: number, exportSize: number,
  ): BinaryReader {
    // Find the total range we need
    const minOffset = 0; // always start from beginning for header
    const maxOffset = Math.max(
      nameOffset + nameSize,
      importOffset + importSize,
      exportOffset + exportSize,
    );

    // Check if everything is in the header
    if (maxOffset <= this.headerEnd) {
      return new BinaryReader(
        Buffer.from(this.fileBuffer.subarray(0, maxOffset)),
        Endianness.Little,
      );
    }

    // We need some compressed chunks too — build a composite buffer
    const result = Buffer.alloc(maxOffset);

    // Copy header
    this.fileBuffer.copy(result, 0, 0, this.headerEnd);

    // Fill in from compressed chunks
    const neededChunks = this.findChunksForRange(this.headerEnd, maxOffset - this.headerEnd);
    for (const chunk of neededChunks) {
      const data = this.ensureDecompressed(chunk);
      const dstStart = chunk.uncompressedOffset;
      const copyLen = Math.min(data.length, maxOffset - dstStart);
      data.copy(result, dstStart, 0, copyLen);
    }

    return new BinaryReader(result, Endianness.Little);
  }

  /**
   * Replace bytes in the decompressed address space within a specific chunk.
   * If newData.length !== oldLength, the chunk's decompressed buffer is resized.
   *
   * @param uncompressedOffset Start of the region to replace
   * @param oldLength Length of the old data
   * @param newData The replacement data
   * @returns Size delta (newData.length - oldLength)
   */
  patchChunkBytes(
    uncompressedOffset: number,
    oldLength: number,
    newData: Buffer,
  ): number {
    const chunks = this.findChunksForRange(uncompressedOffset, oldLength);
    if (chunks.length === 0) {
      throw new Error(`No chunk contains offset ${uncompressedOffset}`);
    }

    // If spans multiple chunks, merge them first
    if (chunks.length > 1) {
      this.mergeChunks(chunks);
      return this.patchChunkBytes(uncompressedOffset, oldLength, newData);
    }

    const chunk = chunks[0];
    const data = this.ensureDecompressed(chunk);
    const localOffset = uncompressedOffset - chunk.uncompressedOffset;
    const sizeDelta = newData.length - oldLength;

    if (sizeDelta === 0) {
      // Same size — write in place
      newData.copy(data, localOffset);
    } else {
      // Different size — splice the buffer
      const before = data.subarray(0, localOffset);
      const after = data.subarray(localOffset + oldLength);
      const newBuf = Buffer.alloc(data.length + sizeDelta);
      before.copy(newBuf, 0);
      newData.copy(newBuf, localOffset);
      after.copy(newBuf, localOffset + newData.length);
      chunk.decompressedData = newBuf;
      chunk.uncompressedSize += sizeDelta;

      // Shift subsequent chunks' uncompressed offsets
      for (const otherChunk of this.chunks) {
        if (otherChunk.index > chunk.index) {
          otherChunk.uncompressedOffset += sizeDelta;
        }
      }
    }

    chunk.modified = true;
    return sizeDelta;
  }

  /**
   * Merge adjacent chunks into the first one (for handling cross-boundary exports).
   */
  private mergeChunks(chunks: ChunkInfo[]): void {
    // Sort by index
    chunks.sort((a, b) => a.index - b.index);
    const first = chunks[0];

    // Decompress and concatenate all
    const parts: Buffer[] = [];
    for (const chunk of chunks) {
      parts.push(this.ensureDecompressed(chunk));
    }
    const merged = Buffer.concat(parts);

    // Update first chunk to cover the full range
    first.decompressedData = merged;
    first.uncompressedSize = merged.length;
    first.modified = true;

    // Remove the other chunks
    const removeIndices = new Set(chunks.slice(1).map(c => c.index));
    this.chunks = this.chunks.filter(c => !removeIndices.has(c.index));

    // Re-index
    for (let i = 0; i < this.chunks.length; i++) {
      this.chunks[i].index = i;
    }
  }

  /**
   * Build the final output buffer.
   *
   * - Header region is taken from the fileBuffer (0..headerEnd), with the chunk
   *   table updated in-place.
   * - Unmodified chunks are copied verbatim from the original file.
   * - Modified chunks are recompressed.
   *
   * @param headerBuffer The header buffer with updated export table entries.
   *                     Must be at least `headerEnd` bytes.
   * @param compressionFlagOffset Byte offset of the compression flag in the header
   *                              (used to locate the chunk table).
   */
  buildOutput(
    headerBuffer: Buffer,
    compressionFlagOffset: number,
  ): Buffer {
    const chunkCount = this.chunks.length;
    const chunkTableOffset = compressionFlagOffset + 8; // past flag(4) + count(4)
    const chunkTableEnd = chunkTableOffset + chunkCount * 16;
    const compressedDataStart = Math.max(this.headerEnd, chunkTableEnd);

    // Prepare compressed chunks
    const compressedChunks: Buffer[] = [];
    for (const chunk of this.chunks) {
      if (chunk.modified) {
        // Recompress
        compressedChunks.push(
          compressChunk(chunk.decompressedData!, this.compressionFlag),
        );
      } else {
        // Copy original compressed bytes verbatim
        compressedChunks.push(
          Buffer.from(this.fileBuffer.subarray(
            chunk.compressedOffset,
            chunk.compressedOffset + chunk.compressedSize,
          )),
        );
      }
    }

    // Calculate total output size
    const totalCompressed = compressedChunks.reduce((s, c) => s + c.length, 0);
    const outputSize = compressedDataStart + totalCompressed;
    const output = Buffer.alloc(outputSize);

    // Copy header
    headerBuffer.copy(output, 0, 0, this.headerEnd);

    // Update chunk count (in case chunks were merged)
    output.writeInt32LE(chunkCount, compressionFlagOffset + 4);

    // Write chunk table and compressed data
    let compressedOffset = compressedDataStart;
    for (let i = 0; i < chunkCount; i++) {
      const chunk = this.chunks[i];
      const entryOffset = chunkTableOffset + i * 16;

      output.writeInt32LE(chunk.uncompressedOffset, entryOffset);
      output.writeInt32LE(chunk.uncompressedSize, entryOffset + 4);
      output.writeInt32LE(compressedOffset, entryOffset + 8);
      output.writeInt32LE(compressedChunks[i].length, entryOffset + 12);

      compressedChunks[i].copy(output, compressedOffset);
      compressedOffset += compressedChunks[i].length;
    }

    return output;
  }

  /**
   * Write an Int32LE value at a decompressed address.
   * For in-place updates (export table patching, etc.) without resizing.
   *
   * If the offset is in the header region, writes to headerBuffer.
   * If in a compressed chunk, decompresses the chunk and writes in place.
   */
  writeInt32LE(
    uncompressedOffset: number,
    value: number,
    headerBuffer?: Buffer,
  ): void {
    if (uncompressedOffset + 4 <= this.headerEnd) {
      if (headerBuffer) {
        headerBuffer.writeInt32LE(value, uncompressedOffset);
      } else {
        this.fileBuffer.writeInt32LE(value, uncompressedOffset);
      }
      return;
    }
    const chunks = this.findChunksForRange(uncompressedOffset, 4);
    if (chunks.length === 0) {
      throw new Error(`No chunk contains offset ${uncompressedOffset}`);
    }
    const chunk = chunks[0];
    const data = this.ensureDecompressed(chunk);
    const localOffset = uncompressedOffset - chunk.uncompressedOffset;
    data.writeInt32LE(value, localOffset);
    chunk.modified = true;
  }

  /**
   * Write a BigInt64LE value at a decompressed address.
   */
  writeBigInt64LE(
    uncompressedOffset: number,
    value: bigint,
    headerBuffer?: Buffer,
  ): void {
    if (uncompressedOffset + 8 <= this.headerEnd) {
      if (headerBuffer) {
        headerBuffer.writeBigInt64LE(value, uncompressedOffset);
      } else {
        this.fileBuffer.writeBigInt64LE(value, uncompressedOffset);
      }
      return;
    }
    const chunks = this.findChunksForRange(uncompressedOffset, 8);
    if (chunks.length === 0) {
      throw new Error(`No chunk contains offset ${uncompressedOffset}`);
    }
    const chunk = chunks[0];
    const data = this.ensureDecompressed(chunk);
    const localOffset = uncompressedOffset - chunk.uncompressedOffset;
    data.writeBigInt64LE(value, localOffset);
    chunk.modified = true;
  }

  /**
   * Get the header end offset.
   */
  getHeaderEnd(): number {
    return this.headerEnd;
  }

  /**
   * Release cached decompressed data for chunks that are no longer needed.
   */
  releaseChunk(chunkIndex: number): void {
    const chunk = this.chunks[chunkIndex];
    if (chunk && !chunk.modified) {
      chunk.decompressedData = null;
    }
  }
}

/**
 * Compress a chunk of uncompressed data into UE3 chunk format.
 */
function compressChunk(
  data: Buffer,
  compressionFlag: CompressionFlag,
  maxBlockSize: number = 131072,
): Buffer {
  const blockCount = Math.ceil(data.length / maxBlockSize);
  const compressedBlocks: { compressed: Buffer; uncompressedSize: number }[] = [];

  for (let i = 0; i < blockCount; i++) {
    const start = i * maxBlockSize;
    const end = Math.min(start + maxBlockSize, data.length);
    const block = data.subarray(start, end);
    const compressed = compress(block, compressionFlag);
    compressedBlocks.push({ compressed, uncompressedSize: end - start });
  }

  const sumCompressed = compressedBlocks.reduce((s, b) => s + b.compressed.length, 0);
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

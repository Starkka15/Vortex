import * as fs from "fs";
import { BinaryReader, BinaryWriter, Endianness } from "../binary";
import { readFCompactIndex, encodeFCompactIndex, compactIndexSize } from "./FCompactIndex";

// ============================================================
//  Types
// ============================================================

/**
 * A single texture reference within a BDC chunk.
 */
export interface BDCChunkItem {
  /** Texture object name (e.g., "HarvestSlugFish_Diff") */
  objectName: string;
  /** Package/group name the texture belongs to */
  packageName: string;
  /** Unknown field (4 bytes, preserved for round-trip) */
  unk1: Buffer;
  /** Offset of this item's data within the .blk chunk file */
  offset: number;
  /** Size of the texture data in bytes */
  size: number;
  /** Duplicate of size (always matches size) */
  size2: number;
  /** Unknown field (4 bytes, preserved for round-trip) */
  unk2: Buffer;
}

/**
 * A chunk within a BDC catalog — corresponds to a .blk storage file.
 */
export interface BDCChunk {
  /** Unknown field (8 bytes, preserved for round-trip) */
  unk1: Buffer;
  /** Chunk file name (e.g., "BulkChunk0_0.blk") */
  fileName: string;
  /** Texture items in this chunk */
  items: BDCChunkItem[];
}

/**
 * Parsed BDC catalog file — indexes all .blk storage files and their texture entries.
 */
export interface BDCCatalog {
  /** Source file path */
  filePath: string;
  /** Platform byte (0 = LE, 1 = BE) */
  platform: number;
  /** Unknown header field (8 bytes) */
  unk1: Buffer;
  /** Unknown header field (4 bytes as int32) */
  unk2: number;
  /** All chunks in this catalog */
  chunks: BDCChunk[];
  /** De-duplicated chunks keyed by fileName (last wins) */
  uniqueChunks: Map<string, BDCChunk>;
}

// ============================================================
//  FString reading (UE2 format: FCompactIndex length + Unicode)
// ============================================================

/**
 * Read a UE2 FString from a BinaryReader.
 *
 * BioShock uses IsDefaultUnicode=true, so positive lengths mean Unicode
 * (2 bytes per char). The length includes the null terminator character.
 */
function readBDCString(reader: BinaryReader): string {
  const length = readFCompactIndex(reader);
  if (length === 0) return "";

  if (length > 0) {
    // Unicode (IsDefaultUnicode = true): length chars × 2 bytes each
    const byteCount = length * 2;
    const bytes = reader.readBytes(byteCount);
    // Strip null terminator (last 2 bytes)
    return bytes.subarray(0, (length - 1) * 2).toString("utf16le");
  } else {
    // Negative = ANSI (rarely used in BDC files)
    const charCount = -length;
    const bytes = reader.readBytes(charCount);
    return bytes.subarray(0, charCount - 1).toString("ascii");
  }
}

/**
 * Encode a UE2 FString for writing (Unicode, FCompactIndex length).
 */
function encodeBDCString(str: string): Buffer {
  // Unicode encoding: charCount includes null terminator
  const charCount = str.length + 1;
  const lengthBytes = encodeFCompactIndex(charCount);
  const dataBytes = Buffer.alloc(charCount * 2);

  for (let i = 0; i < str.length; i++) {
    dataBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  }
  // Null terminator (already 0x0000 from alloc)

  return Buffer.concat([lengthBytes, dataBytes]);
}

/**
 * Get the encoded byte size of a BDC FString.
 */
function bdcStringSize(str: string): number {
  const charCount = str.length + 1;
  return compactIndexSize(charCount) + charCount * 2;
}

// ============================================================
//  Reading
// ============================================================

/**
 * Read a BDC catalog file.
 *
 * @param filePath Path to the .bdc file
 * @param excludeDLC4 If true, skip chunks with "DLC4" in the name (for c3Catalog.bdc)
 */
export function readBDCCatalog(
  filePath: string,
  excludeDLC4: boolean = false,
): BDCCatalog {
  const buffer = fs.readFileSync(filePath);
  const platform = buffer[0];
  const endianness = platform === 0 ? Endianness.Little : Endianness.Big;
  const reader = new BinaryReader(buffer, endianness);

  // Header
  reader.skip(1); // platform byte already read
  const unk1 = Buffer.from(reader.readBytes(8));
  const unk2 = reader.readInt32();

  // TArray<BDCChunk> — FCompactIndex count
  const chunkCount = readFCompactIndex(reader);
  const chunks: BDCChunk[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const chunkUnk1 = Buffer.from(reader.readBytes(8));
    const fileName = readBDCString(reader);

    // TArray<BDCChunkItem> — FCompactIndex count
    const itemCount = readFCompactIndex(reader);
    const items: BDCChunkItem[] = [];

    for (let j = 0; j < itemCount; j++) {
      const objectName = readBDCString(reader);
      const packageName = readBDCString(reader);
      const itemUnk1 = Buffer.from(reader.readBytes(4));
      const offset = reader.readInt32();
      const size = reader.readInt32();
      const size2 = reader.readInt32();
      const itemUnk2 = Buffer.from(reader.readBytes(4));

      items.push({
        objectName,
        packageName,
        unk1: itemUnk1,
        offset,
        size,
        size2,
        unk2: itemUnk2,
      });
    }

    chunks.push({ unk1: chunkUnk1, fileName, items });
  }

  // Build unique chunks map (last occurrence wins, per C# logic)
  const uniqueChunks = new Map<string, BDCChunk>();
  for (const chunk of chunks) {
    if (excludeDLC4 && chunk.fileName.includes("DLC4")) continue;
    uniqueChunks.set(chunk.fileName, chunk);
  }

  return {
    filePath,
    platform,
    unk1,
    unk2,
    chunks,
    uniqueChunks,
  };
}

// ============================================================
//  Writing
// ============================================================

/**
 * Write a BDC catalog to a file.
 */
export function writeBDCCatalog(filePath: string, catalog: BDCCatalog): void {
  // Calculate total size
  let totalSize = 1 + 8 + 4; // platform + unk1 + unk2
  totalSize += compactIndexSize(catalog.chunks.length); // chunk count

  for (const chunk of catalog.chunks) {
    totalSize += 8; // chunk unk1
    totalSize += bdcStringSize(chunk.fileName);
    totalSize += compactIndexSize(chunk.items.length); // item count

    for (const item of chunk.items) {
      totalSize += bdcStringSize(item.objectName);
      totalSize += bdcStringSize(item.packageName);
      totalSize += 20; // unk1(4) + offset(4) + size(4) + size2(4) + unk2(4)
    }
  }

  const buffer = Buffer.alloc(totalSize);
  let pos = 0;

  // Header
  buffer[pos++] = catalog.platform;
  catalog.unk1.copy(buffer, pos); pos += 8;
  buffer.writeInt32LE(catalog.unk2, pos); pos += 4;

  // Chunk count
  const countBytes = encodeFCompactIndex(catalog.chunks.length);
  countBytes.copy(buffer, pos); pos += countBytes.length;

  // Chunks
  for (const chunk of catalog.chunks) {
    chunk.unk1.copy(buffer, pos); pos += 8;
    const nameBytes = encodeBDCString(chunk.fileName);
    nameBytes.copy(buffer, pos); pos += nameBytes.length;

    // Item count
    const itemCountBytes = encodeFCompactIndex(chunk.items.length);
    itemCountBytes.copy(buffer, pos); pos += itemCountBytes.length;

    // Items
    for (const item of chunk.items) {
      const objNameBytes = encodeBDCString(item.objectName);
      objNameBytes.copy(buffer, pos); pos += objNameBytes.length;

      const pkgNameBytes = encodeBDCString(item.packageName);
      pkgNameBytes.copy(buffer, pos); pos += pkgNameBytes.length;

      item.unk1.copy(buffer, pos); pos += 4;
      buffer.writeInt32LE(item.offset, pos); pos += 4;
      buffer.writeInt32LE(item.size, pos); pos += 4;
      buffer.writeInt32LE(item.size2, pos); pos += 4;
      item.unk2.copy(buffer, pos); pos += 4;
    }
  }

  fs.writeFileSync(filePath, buffer.subarray(0, pos));
}

// ============================================================
//  Utility functions
// ============================================================

/**
 * Find all .bdc catalog files in a directory.
 */
export function findBDCFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith(".bdc"))
    .map(f => `${dir}/${f}`);
}

/**
 * Get the storage name from a chunk file name.
 * E.g., "BulkChunk0_0.blk" → "BulkChunk0"
 */
export function getStorageName(chunkFileName: string): string {
  const base = chunkFileName.replace(/\.[^.]+$/, ""); // remove extension
  const lastUnderscore = base.lastIndexOf("_");
  return lastUnderscore >= 0 ? base.substring(0, lastUnderscore) : base;
}

import * as fs from "fs";
import * as path from "path";
import {
  BDCCatalog, BDCChunk, BDCChunkItem,
  readBDCCatalog, writeBDCCatalog, findBDCFiles,
} from "./BDCCatalogFile";
import { FTextureEntry } from "../mapping/FTextureEntry";

/**
 * Result of a BulkContent update operation.
 */
export interface BulkContentUpdateResult {
  /** Number of .blk storage files updated */
  chunksUpdated: number;
  /** Number of .bdc catalog files updated */
  catalogsUpdated: number;
  /** Number of texture entries applied */
  texturesApplied: number;
  /** Files that were created or modified (for backup tracking) */
  modifiedFiles: string[];
}

/**
 * Get the BulkChunkOffset of a texture entry (minimum offsetOnDisk of TFC mips).
 */
function getBulkChunkOffset(entry: FTextureEntry): number {
  if (entry.tfcMips.length === 0) return 0;
  return Math.min(...entry.tfcMips.map(m => m.offsetOnDisk));
}

/**
 * Get the BulkChunkSize of a texture entry (sum of sizeOnDisk of TFC mips).
 */
function getBulkChunkSize(entry: FTextureEntry): number {
  return entry.tfcMips.reduce((sum, m) => sum + m.sizeOnDisk, 0);
}

/**
 * Get the TFC file name for a texture entry.
 */
function getTFCFileName(entry: FTextureEntry, tfcExtension: string = ".tfc"): string {
  return `${entry.tfcName}_${entry.tfcIndex}${tfcExtension}`;
}

/**
 * Update BulkContent storage (.blk files) and catalog (.bdc files) for a set
 * of texture entries.
 *
 * This is the BioShock 1/2 specific patching path. Instead of modifying TFC
 * references in UPK packages (which don't use TFC storage), BioShock stores
 * all texture bulk data in .blk chunk files indexed by .bdc catalogs.
 *
 * The process:
 * 1. Read all .bdc catalog files from the BulkContent directory
 * 2. For each chunk that contains textures being replaced:
 *    - Create a new .blk file with updated texture data
 *    - Copy original data for unmodified textures
 *    - Update catalog entries with new offsets/sizes
 * 3. Write updated .bdc catalogs
 *
 * @param bulkContentDir Path to the BulkContent directory (e.g., ContentBaked/pc/BulkContent)
 * @param modDir Path to the mod directory containing .tfc data files
 * @param textureEntries Texture entries from the mapping file
 * @param tfcExtension TFC file extension (default: ".tfc")
 * @param backupFn Optional callback to back up a file before modifying it
 */
export function updateBulkContent(
  bulkContentDir: string,
  modDir: string,
  textureEntries: FTextureEntry[],
  tfcExtension: string = ".tfc",
  backupFn?: (filePath: string) => void,
): BulkContentUpdateResult {
  const result: BulkContentUpdateResult = {
    chunksUpdated: 0,
    catalogsUpdated: 0,
    texturesApplied: 0,
    modifiedFiles: [],
  };

  if (textureEntries.length === 0) return result;

  // Build a lookup map: "packageName\objectName" → FTextureEntry
  // textureId is already in "PackageName\ObjectName" format, matching BDC fields.
  const entryMap = new Map<string, FTextureEntry>();
  for (const entry of textureEntries) {
    if (entry.tfcMipCount > 0) {
      entryMap.set(entry.textureId, entry);
    }
  }

  if (entryMap.size === 0) return result;

  // Read all BDC catalog files
  const bdcFiles = findBDCFiles(bulkContentDir);
  if (bdcFiles.length === 0) return result;

  for (const bdcPath of bdcFiles) {
    const isC3Catalog = path.basename(bdcPath).toLowerCase() === "c3catalog.bdc";
    const catalog = readBDCCatalog(bdcPath, isC3Catalog);

    let catalogModified = false;

    for (const chunk of catalog.chunks) {
      // Check if any items in this chunk match our texture entries
      // Match using composite key: "packageName\objectName" — same format as textureId
      const matchingItems = chunk.items.filter(item =>
        entryMap.has(item.packageName + "\\" + item.objectName)
      );

      if (matchingItems.length === 0) continue;

      // This chunk needs updating
      const blkPath = path.join(bulkContentDir, chunk.fileName);
      if (!fs.existsSync(blkPath)) continue;

      // Back up original .blk file
      backupFn?.(blkPath);

      // Create the updated .blk file
      const tempPath = blkPath + "temp";
      updateChunkFile(
        blkPath, tempPath, chunk, entryMap, modDir, tfcExtension,
      );

      // Replace original with temp
      fs.renameSync(tempPath, blkPath);

      result.chunksUpdated++;
      result.texturesApplied += matchingItems.length;
      result.modifiedFiles.push(blkPath);
      catalogModified = true;
    }

    if (catalogModified) {
      // Back up and rewrite the catalog
      backupFn?.(bdcPath);
      writeBDCCatalog(bdcPath, catalog);
      result.catalogsUpdated++;
      result.modifiedFiles.push(bdcPath);
    }
  }

  return result;
}

/**
 * Update a single .blk chunk file with new texture data.
 *
 * Creates a new temp file with:
 * - 32KB null padding header
 * - For each item (sorted by original offset):
 *   - If matched: texture data from mod's TFC file
 *   - If not matched: original data copied from existing .blk
 * - Updates each item's offset and size in the BDCChunk in-place
 */
function updateChunkFile(
  originalBlkPath: string,
  tempPath: string,
  chunk: BDCChunk,
  entryMap: Map<string, FTextureEntry>,
  modDir: string,
  tfcExtension: string,
): void {
  const PADDING = 32768; // 32KB null prefix, matching C# implementation

  // Sort items by offset for sequential processing
  const sortedItems = [...chunk.items].sort((a, b) => a.offset - b.offset);

  const originalFd = fs.openSync(originalBlkPath, "r");
  const tempFd = fs.openSync(tempPath, "w");

  try {
    // Write 32KB padding
    const padding = Buffer.alloc(PADDING);
    fs.writeSync(tempFd, padding);
    let writePos = PADDING;

    for (const item of sortedItems) {
      const entry = entryMap.get(item.packageName + "\\" + item.objectName);

      if (entry) {
        // Write texture data from mod's TFC file
        const tfcFileName = getTFCFileName(entry, tfcExtension);
        const tfcPath = path.join(modDir, tfcFileName);

        if (!fs.existsSync(tfcPath)) {
          // Fallback: copy original data
          copyData(originalFd, item.offset, item.size, tempFd);
          item.offset = writePos;
          writePos += item.size;
          continue;
        }

        const bulkOffset = getBulkChunkOffset(entry);
        const bulkSize = getBulkChunkSize(entry);

        const tfcFd = fs.openSync(tfcPath, "r");
        try {
          const data = Buffer.alloc(bulkSize);
          fs.readSync(tfcFd, data, 0, bulkSize, bulkOffset);
          fs.writeSync(tempFd, data);
        } finally {
          fs.closeSync(tfcFd);
        }

        // Update item metadata
        item.offset = writePos;
        item.size = bulkSize;
        item.size2 = bulkSize;
        writePos += bulkSize;
      } else {
        // Copy original data unchanged
        copyData(originalFd, item.offset, item.size, tempFd);
        item.offset = writePos;
        // size stays the same
        writePos += item.size;
      }
    }
  } finally {
    fs.closeSync(originalFd);
    fs.closeSync(tempFd);
  }
}

/**
 * Copy data from one file descriptor to another.
 */
function copyData(
  srcFd: number,
  srcOffset: number,
  size: number,
  dstFd: number,
): void {
  if (size <= 0) return;

  // Read in chunks to avoid large allocations
  const CHUNK_SIZE = 1024 * 1024; // 1MB
  let remaining = size;
  let readOffset = srcOffset;

  while (remaining > 0) {
    const readSize = Math.min(remaining, CHUNK_SIZE);
    const buf = Buffer.alloc(readSize);
    fs.readSync(srcFd, buf, 0, readSize, readOffset);
    fs.writeSync(dstFd, buf);
    readOffset += readSize;
    remaining -= readSize;
  }
}

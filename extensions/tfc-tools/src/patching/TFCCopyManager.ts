import * as fs from "fs";
import * as path from "path";

/**
 * Result of copying TFC files to the game directory.
 */
export interface TFCCopyResult {
  /** Index offset applied to avoid collisions (0 = no shift) */
  shiftOffset: number;
  /** Paths of TFC files that were actually copied */
  copiedFiles: string[];
}

/**
 * Copy mod TFC data files to the game directory.
 *
 * Mod TFC files are named like `TextureName_0.tfc`, `TextureName_1.tfc`, etc.
 * If files with the same indices already exist in the destination, we shift
 * all indices up until there's no collision (e.g., `_0` → `_3`, `_1` → `_4`).
 *
 * @param sourcePath Directory containing mod TFC files
 * @param destPath Game directory to copy into
 * @param tfcName Base TFC name (e.g., "Textures")
 * @param minIndex Minimum TFC index used by the mod
 * @param maxIndex Maximum TFC index used by the mod
 * @param tfcExtension File extension (default ".tfc")
 * @returns Copy result with shift offset and list of copied files
 */
export function copyTFCFiles(
  sourcePath: string,
  destPath: string,
  tfcName: string,
  minIndex: number,
  maxIndex: number,
  tfcExtension: string = ".tfc",
): TFCCopyResult {
  // Find a shift offset where all target names are available
  let shiftOffset = 0;
  let canCopy = false;

  while (!canCopy) {
    canCopy = true;
    for (let idx = minIndex; idx <= maxIndex; idx++) {
      const srcFile = getTFCPath(sourcePath, tfcName, idx, tfcExtension);
      const dstFile = getTFCPath(destPath, tfcName, idx + shiftOffset, tfcExtension);

      if (!fs.existsSync(srcFile)) {
        throw new Error(`Source TFC file not found: ${srcFile}`);
      }

      if (fs.existsSync(dstFile)) {
        // If same file (same size and mtime), it's already there — OK
        const srcStat = fs.statSync(srcFile);
        const dstStat = fs.statSync(dstFile);
        if (srcStat.size !== dstStat.size ||
            srcStat.mtimeMs !== dstStat.mtimeMs) {
          canCopy = false;
          shiftOffset++;
          break;
        }
      }
    }
  }

  // Copy the files (overwrite if destination exists)
  const copiedFiles: string[] = [];
  for (let idx = minIndex; idx <= maxIndex; idx++) {
    const srcFile = getTFCPath(sourcePath, tfcName, idx, tfcExtension);
    const dstFile = getTFCPath(destPath, tfcName, idx + shiftOffset, tfcExtension);

    fs.copyFileSync(srcFile, dstFile);
    copiedFiles.push(dstFile);
  }

  return { shiftOffset, copiedFiles };
}

/**
 * Build a TFC file path from components.
 */
function getTFCPath(dir: string, tfcName: string, index: number, ext: string): string {
  return path.join(dir, `${tfcName}_${index}${ext}`);
}

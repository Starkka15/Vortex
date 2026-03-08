import * as fs from "fs";
import * as path from "path";

/**
 * Entry describing a file whose size needs to be updated in the TOC.
 */
export interface TOCEntry {
  /** Relative path (lowercase, forward slashes) from the game's content root */
  relativePath: string;
  /** Actual file on disk */
  filePath: string;
  /** Uncompressed size (for compressed packages; 0 = use disk size) */
  uncompressedSize?: number;
  /** MD5 hash (if the TOC format includes it) */
  md5?: string;
  /** If true, add this entry to the TOC if it doesn't exist */
  mustAdd?: boolean;
}

/**
 * Auto-detected TOC line format.
 * UE3 TOC files are plaintext with space-delimited columns:
 *   diskSize uncompressedSize [md5] ..\relative\path
 * The exact column positions vary by game.
 */
interface TOCFormat {
  diskSizeIndex: number;
  uncompressedSizeIndex: number;
  filePathIndex: number;
  md5Index: number; // -1 if not present
}

/**
 * Detect the TOC file format from the first line.
 * Returns null if the line can't be parsed.
 */
function detectTOCFormat(firstLine: string): TOCFormat | null {
  const parts = firstLine.split(" ");
  if (parts.length < 3) return null;

  // First two columns must be numeric (diskSize, uncompressedSize)
  if (isNaN(Number(parts[0])) || isNaN(Number(parts[1]))) return null;

  let filePathIndex = -1;
  let md5Index = -1;

  for (let i = 2; i < parts.length; i++) {
    if (parts[i].startsWith("..\\") && filePathIndex === -1) {
      filePathIndex = i;
    } else if (parts[i].length === 32 && md5Index === -1) {
      md5Index = i;
    }
    if (filePathIndex !== -1 && md5Index !== -1) break;
  }

  if (filePathIndex === -1) return null;

  return {
    diskSizeIndex: 0,
    uncompressedSizeIndex: 1,
    filePathIndex,
    md5Index,
  };
}

/**
 * Patch a UE3 TOC (Table of Contents) file.
 *
 * UE3 TOC files are plaintext lists mapping relative file paths to their
 * disk and uncompressed sizes. When packages are modified (e.g., by texture
 * patching), the TOC must be updated to reflect the new file sizes.
 *
 * @param tocPath Path to the TOC file
 * @param entries Entries to update/add
 * @returns true if changes were made
 */
export function patchTOC(tocPath: string, entries: TOCEntry[]): boolean {
  if (!fs.existsSync(tocPath) || entries.length === 0) return false;

  const content = fs.readFileSync(tocPath, "utf-8");
  const lines = content.split(/\r?\n/);

  if (lines.length === 0) return false;

  let format: TOCFormat | null = null;
  let modified = false;
  const matchedEntries = new Set<TOCEntry>();

  const outputLines: string[] = [];

  for (const line of lines) {
    if (!format) {
      format = detectTOCFormat(line);
    }

    if (!format) {
      outputLines.push(line);
      continue;
    }

    const parts = line.split(" ");
    if (parts.length <= format.filePathIndex) {
      outputLines.push(line);
      continue;
    }

    const diskSize = Number(parts[format.diskSizeIndex]);
    if (isNaN(diskSize)) {
      outputLines.push(line);
      continue;
    }

    // Extract relative path from TOC (strip leading "..\")
    let tocRelPath = parts[format.filePathIndex];
    if (tocRelPath.startsWith("..\\")) {
      tocRelPath = tocRelPath.substring(3);
    }
    tocRelPath = tocRelPath.toLowerCase();

    // Find matching entry
    const entry = entries.find(e => e.relativePath === tocRelPath);

    if (entry) {
      matchedEntries.add(entry);

      // Update disk size
      const stat = fs.statSync(entry.filePath);
      if (diskSize !== 0 && stat.size !== diskSize) {
        parts[format.diskSizeIndex] = String(stat.size);
        modified = true;
      }

      // Update uncompressed size
      const uncompSize = Number(parts[format.uncompressedSizeIndex]);
      if (uncompSize !== 0 && entry.uncompressedSize !== undefined && entry.uncompressedSize !== uncompSize) {
        parts[format.uncompressedSizeIndex] = String(entry.uncompressedSize);
        modified = true;
      }

      // Update MD5
      if (format.md5Index !== -1 && entry.md5 && parts[format.md5Index] !== entry.md5) {
        parts[format.md5Index] = entry.md5;
        modified = true;
      }

      outputLines.push(parts.join(" "));
    } else {
      outputLines.push(line);
    }
  }

  // Add new entries that weren't in the TOC
  if (format) {
    for (const entry of entries) {
      if (entry.mustAdd && !matchedEntries.has(entry)) {
        const stat = fs.statSync(entry.filePath);
        const templateParts = lines.find(l => detectTOCFormat(l))?.split(" ");
        if (templateParts && templateParts.length > format.filePathIndex) {
          const newParts = [...templateParts];
          newParts[format.diskSizeIndex] = String(stat.size);
          newParts[format.uncompressedSizeIndex] = String(entry.uncompressedSize ?? stat.size);
          newParts[format.filePathIndex] = "..\\" + entry.relativePath;
          if (format.md5Index !== -1 && entry.md5) {
            newParts[format.md5Index] = entry.md5;
          }
          outputLines.push(newParts.join(" "));
          modified = true;
        }
      }
    }
  }

  if (modified) {
    fs.writeFileSync(tocPath, outputLines.join("\n"), "utf-8");
  }

  return modified;
}

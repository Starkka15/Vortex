import * as fs from "fs";
import * as path from "path";

/**
 * Patch a game executable to bypass package hash checks.
 *
 * Some UE3 games (e.g., BioShock) verify that package file names in the
 * executable match the actual files on disk. When we modify packages, the
 * hash check fails. This patcher finds package names in the executable
 * binary and replaces them with mangled names (changing the last N characters
 * to digits), so the game can't find the hash-checked copy and falls through
 * to loading the modified package.
 *
 * @param exePath Path to the game executable
 * @param gameDir Game root directory (to collect all package names)
 * @param packageExtensions Package file extensions to look for (e.g., [".upk", ".u"])
 * @returns List of package names that were patched in the exe
 */
export function patchGameExe(
  exePath: string,
  gameDir: string,
  packageExtensions: string[] = [".upk", ".u"],
): string[] {
  const buffer = fs.readFileSync(exePath);
  const allPackageNames = getAllPackageNames(gameDir, packageExtensions);

  // Build lookup sets
  const uniqueChars = new Set<number>();
  for (const name of allPackageNames) {
    for (const ch of Buffer.from(name, "ascii")) {
      uniqueChars.add(ch);
    }
    for (const ch of Buffer.from(name.toUpperCase(), "ascii")) {
      uniqueChars.add(ch);
    }
  }

  // Group replacers by length (longest first)
  const replacers = allPackageNames
    .map(name => ({ name: name.toLowerCase(), length: name.length, replacement: null as Buffer | null }))
    .sort((a, b) => b.length - a.length);

  const maxLen = replacers.length > 0 ? replacers[0].length : 0;
  const minLen = replacers.length > 0 ? replacers[replacers.length - 1].length : 0;

  const replacedNames: string[] = [];
  let modified = false;

  for (let i = 0; i < buffer.length; i++) {
    if (!uniqueChars.has(buffer[i])) continue;

    const remaining = buffer.length - i;
    const sliceLen = Math.min(maxLen, remaining);
    const slice = buffer.subarray(i, i + sliceLen).toString("ascii").toLowerCase();

    if (slice.length < minLen) continue;

    // Check if all characters up to minLen are valid package chars
    let allValid = true;
    for (let j = 0; j < Math.min(minLen, slice.length); j++) {
      if (!uniqueChars.has(slice.charCodeAt(j)) && !uniqueChars.has(slice.toUpperCase().charCodeAt(j))) {
        allValid = false;
        break;
      }
    }
    if (!allValid) continue;

    // Find matching package name
    let matched: typeof replacers[0] | undefined;
    for (const r of replacers) {
      if (r.length <= slice.length && slice.startsWith(r.name)) {
        matched = r;
        break;
      }
    }

    if (matched) {
      // Generate replacement name (change last digits of base name)
      if (!matched.replacement) {
        matched.replacement = generateReplacement(matched.name, allPackageNames);
      }

      if (matched.replacement) {
        matched.replacement.copy(buffer, i);
        i += matched.replacement.length - 1; // skip past replaced bytes
        replacedNames.push(matched.name);
        modified = true;
      }
    }
  }

  if (modified) {
    fs.writeFileSync(exePath, buffer);
  }

  return [...new Set(replacedNames)];
}

/**
 * Generate a replacement name by changing trailing characters to digits.
 */
function generateReplacement(packageName: string, allNames: string[]): Buffer | null {
  const baseName = path.basename(packageName, path.extname(packageName));
  const ext = path.extname(packageName);
  const allNamesSet = new Set(allNames.map(n => n.toLowerCase()));

  for (let num = 0; num < Math.pow(10, baseName.length) - 1; num++) {
    const numStr = String(num);
    const newBase = baseName.substring(0, baseName.length - numStr.length) + numStr;
    const newName = newBase + ext;
    if (!allNamesSet.has(newName)) {
      return Buffer.from(newName, "ascii");
    }
  }

  return null;
}

/**
 * Recursively collect all unique package file names in a directory.
 */
function getAllPackageNames(dir: string, extensions: string[]): string[] {
  const names = new Set<string>();
  const extSet = new Set(extensions.map(e => e.toLowerCase()));

  function walk(d: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(d, entry.name));
      } else if (entry.isFile() && extSet.has(path.extname(entry.name).toLowerCase())) {
        names.add(entry.name.toLowerCase());
      }
    }
  }

  walk(dir);
  return [...names];
}

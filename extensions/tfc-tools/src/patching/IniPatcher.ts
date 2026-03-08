import * as fs from "fs";

/**
 * Patch type determines how a section or key-value is applied.
 *
 * In the patch file:
 *   (no prefix) → AddOrUpdate: add if missing, update if exists
 *   + prefix    → AddAlways:   always add (even if key already exists)
 *   . prefix    → UpdateOnly:  only modify if already present
 *   - prefix    → RemoveOnly:  remove the section/key entirely
 */
export enum PatchType {
  AddOrUpdate,
  AddAlways,
  UpdateOnly,
  RemoveOnly,
}

/**
 * A key-value entry from a patch file.
 * May include a match string: `(*pattern*)key=value` — applies only when
 * the existing value contains `pattern`.
 */
export interface PatchKeyValue {
  key: string;
  value: string;
  patchType: PatchType;
  /** If set, only applies to existing lines whose value contains this string */
  matchString?: string;
}

/**
 * A section from a patch file, e.g. `[Engine.Engine]` or `-[SectionToRemove]`.
 */
export interface PatchSection {
  /** Section name including brackets, e.g. "[Engine.Engine]" */
  name: string;
  patchType: PatchType;
  keyValues: PatchKeyValue[];
}

/**
 * Parse the patch type prefix from a line.
 * Returns the stripped line and the detected patch type.
 */
function parsePatchType(line: string): { stripped: string; patchType: PatchType } {
  if (line.startsWith("+")) return { stripped: line.substring(1), patchType: PatchType.AddAlways };
  if (line.startsWith(".")) return { stripped: line.substring(1), patchType: PatchType.UpdateOnly };
  if (line.startsWith("-")) return { stripped: line.substring(1), patchType: PatchType.RemoveOnly };
  return { stripped: line, patchType: PatchType.AddOrUpdate };
}

/**
 * Check if a trimmed line is a section header.
 * In patch files, `-[Section]` is also a valid section header.
 */
function isSection(line: string, isPatch: boolean): boolean {
  if (!line.endsWith("]")) return false;
  if (line.startsWith("[")) return true;
  if (isPatch && line.startsWith("-[")) return true;
  return false;
}

/**
 * Check if a trimmed line is a key=value pair.
 */
function isKeyValue(line: string, isPatch: boolean): boolean {
  if (line.startsWith(";")) return false; // comment
  if (isSection(line, isPatch)) return false;
  const eqIdx = line.indexOf("=");
  return eqIdx > 0;
}

/**
 * Parse a patch file into sections with their key-value entries.
 *
 * Patch file format:
 * ```
 * [SectionName]
 * key=value
 * +key=alwaysAddedValue
 * .key=onlyUpdateIfExists
 * -key=removeThisLine
 * (*matchPattern*)key=conditionalValue
 * -[RemoveThisSection]
 * ```
 */
export function parsePatchFile(content: string): PatchSection[] {
  const sections: PatchSection[] = [];
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith(";")) continue;

    if (isSection(trimmed, true)) {
      const { stripped, patchType } = parsePatchType(trimmed);
      sections.push({ name: stripped, patchType, keyValues: [] });
    } else if (isKeyValue(trimmed, true)) {
      let line = trimmed;
      const { stripped, patchType } = parsePatchType(line);
      line = stripped;

      // Extract match string: (*pattern*)key=value
      let matchString: string | undefined;
      if (line.startsWith("(*") && line.includes("*)")) {
        const endIdx = line.lastIndexOf("*)");
        matchString = line.substring(2, endIdx);
        line = line.substring(endIdx + 2);
      }

      const eqIdx = line.indexOf("=");
      const key = line.substring(0, eqIdx);
      const value = line.substring(eqIdx + 1);

      if (sections.length === 0) {
        throw new Error(`INI patch: values without sections not supported ('${key}')`);
      }

      sections[sections.length - 1].keyValues.push({ key, value, patchType, matchString });
    }
  }

  return sections;
}

/**
 * Apply an INI patch to a target INI file.
 *
 * Reads the target file, applies patch operations (add, update, remove),
 * and writes the result to outputPath. If outputPath is omitted, overwrites
 * the input file.
 *
 * @param targetPath Path to the INI file to patch
 * @param patchSections Parsed patch sections
 * @param outputPath Output path (defaults to targetPath)
 * @returns true if any changes were made
 */
export function patchIniFile(
  targetPath: string,
  patchSections: PatchSection[],
  outputPath?: string,
): boolean {
  if (patchSections.length === 0) return false;

  const targetExists = fs.existsSync(targetPath);
  const inputLines = targetExists
    ? fs.readFileSync(targetPath, "utf-8").split(/\r?\n/)
    : [];

  // Build section map from patch data
  const sectionMap = new Map<string, PatchSectionState>();
  for (const ps of patchSections) {
    sectionMap.set(ps.name, {
      section: ps,
      written: false,
      // Track which key-values have been consumed
      kvConsumed: new Array(ps.keyValues.length).fill(false),
    });
  }

  const output: string[] = [];
  let currentSection: PatchSectionState | null = null;
  let modified = false;
  // Buffer empty lines so we can drop trailing empties before removed sections
  const emptyBuffer: string[] = [];

  function flushEmpties(): void {
    for (const e of emptyBuffer) output.push(e);
    emptyBuffer.length = 0;
  }

  function writeRemainingKVs(state: PatchSectionState): void {
    if (state.section.patchType === PatchType.RemoveOnly) return;
    const { section, kvConsumed } = state;
    for (let i = 0; i < section.keyValues.length; i++) {
      if (!kvConsumed[i]) {
        const kv = section.keyValues[i];
        // UpdateOnly entries shouldn't be added if not matched
        if (kv.patchType === PatchType.UpdateOnly) continue;
        // RemoveOnly entries that weren't matched — nothing to do
        if (kv.patchType === PatchType.RemoveOnly) continue;
        output.push(`${kv.key}=${kv.value}`);
        kvConsumed[i] = true;
        modified = true;
      }
    }
  }

  for (const rawLine of inputLines) {
    const trimmed = rawLine.trim();

    // Empty line
    if (!trimmed) {
      emptyBuffer.push(rawLine);
      continue;
    }

    // Section header
    if (isSection(trimmed, false)) {
      // Flush remaining KVs from previous section
      if (currentSection) {
        writeRemainingKVs(currentSection);
      }

      const state = sectionMap.get(trimmed) ?? null;

      if (state && state.section.patchType === PatchType.RemoveOnly) {
        // Remove this section — drop the empty line before it too
        if (emptyBuffer.length > 0) emptyBuffer.pop();
        flushEmpties();
        currentSection = state;
        state.written = true;
        modified = true;
        continue; // skip writing the section header
      }

      flushEmpties();

      if (state) {
        state.written = true;
        currentSection = state;
        // Write section header as-is
        output.push(rawLine);
      } else {
        currentSection = null;
        output.push(rawLine);
      }
      continue;
    }

    // Key=value in a section being removed
    if (currentSection?.section.patchType === PatchType.RemoveOnly) {
      modified = true;
      continue; // skip all lines in removed sections
    }

    // Key=value with active patch section
    if (currentSection && isKeyValue(trimmed, false)) {
      flushEmpties();
      const eqIdx = trimmed.indexOf("=");
      const existingKey = trimmed.substring(0, eqIdx);
      const existingValue = trimmed.substring(eqIdx + 1);

      const result = processKeyValue(currentSection, existingKey, existingValue, rawLine);
      if (result.changed) modified = true;
      for (const line of result.lines) output.push(line);
      continue;
    }

    // Regular line (comment, non-KV, or no active patch section)
    flushEmpties();
    output.push(rawLine);
  }

  // Flush remaining KVs from last section
  if (currentSection) {
    writeRemainingKVs(currentSection);
  }

  // Write sections that weren't in the original file
  for (const [, state] of sectionMap) {
    if (!state.written && state.section.patchType !== PatchType.UpdateOnly) {
      output.push(""); // blank line before new section
      output.push(state.section.name);
      state.written = true;
      writeRemainingKVs(state);
      modified = true;
    }
  }

  // Flush any trailing empties
  flushEmpties();

  if (modified) {
    fs.writeFileSync(outputPath ?? targetPath, output.join("\n"), "utf-8");
  }

  return modified;
}

interface PatchSectionState {
  section: PatchSection;
  written: boolean;
  kvConsumed: boolean[];
}

/**
 * Process a key=value line against the active patch section.
 * Returns the output lines and whether anything changed.
 */
function processKeyValue(
  state: PatchSectionState,
  existingKey: string,
  existingValue: string,
  rawLine: string,
): { lines: string[]; changed: boolean } {
  const { section, kvConsumed } = state;
  const lines: string[] = [];
  let changed = false;

  // First, write any AddAlways entries for this key that haven't been written yet
  for (let i = 0; i < section.keyValues.length; i++) {
    if (kvConsumed[i]) continue;
    const kv = section.keyValues[i];
    if (kv.key !== existingKey) continue;
    if (kv.patchType !== PatchType.AddAlways) continue;
    lines.push(`${kv.key}=${kv.value}`);
    kvConsumed[i] = true;
    changed = true;
  }

  // Find matching patch entries for this key (non-AddAlways)
  let matchIdx = -1;

  // Try match-string entries first
  for (let i = 0; i < section.keyValues.length; i++) {
    if (kvConsumed[i]) continue;
    const kv = section.keyValues[i];
    if (kv.key !== existingKey) continue;
    if (kv.patchType === PatchType.AddAlways) continue;
    if (kv.matchString && existingValue.includes(kv.matchString)) {
      matchIdx = i;
      break;
    }
  }

  // Fall back to non-match-string entries
  if (matchIdx === -1) {
    for (let i = 0; i < section.keyValues.length; i++) {
      if (kvConsumed[i]) continue;
      const kv = section.keyValues[i];
      if (kv.key !== existingKey) continue;
      if (kv.patchType === PatchType.AddAlways) continue;
      if (kv.matchString) continue; // skip match-string entries that didn't match
      matchIdx = i;
      break;
    }
  }

  if (matchIdx !== -1) {
    const kv = section.keyValues[matchIdx];
    kvConsumed[matchIdx] = true;

    if (kv.patchType === PatchType.RemoveOnly) {
      // Don't write the line — it's removed
      changed = true;
    } else {
      // Replace the value
      const newLine = `${kv.key}=${kv.value}`;
      lines.push(newLine);
      if (newLine !== rawLine.trim()) changed = true;
    }
  } else {
    // No matching patch entry — keep original line
    lines.push(rawLine);
  }

  return { lines, changed };
}

/**
 * Convenience: parse a patch file and apply it to a target INI.
 *
 * @param targetPath INI file to patch
 * @param patchPath Patch file path
 * @param outputPath Output path (defaults to targetPath)
 * @returns true if changes were made
 */
export function applyIniPatch(
  targetPath: string,
  patchPath: string,
  outputPath?: string,
): boolean {
  if (!fs.existsSync(patchPath)) return false;
  const patchContent = fs.readFileSync(patchPath, "utf-8");
  const sections = parsePatchFile(patchContent);
  return patchIniFile(targetPath, sections, outputPath);
}

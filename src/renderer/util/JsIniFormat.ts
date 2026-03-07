import * as fsOrig from "fs-extra";

/**
 * Pure-JS INI format for Linux (replaces WinapiFormat which uses Windows API).
 * Implements the IIniFormat interface from vortex-parse-ini.
 */
export class JsIniFormat {
  read(filePath: string): Promise<any> {
    return fsOrig.readFile(filePath, { encoding: "utf8" })
      .then((content: string) => {
        const result: any = {};
        let currentSection = "";
        for (const rawLine of content.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line || line.startsWith(";") || line.startsWith("#")) continue;
          const sectionMatch = line.match(/^\[(.+?)\]$/);
          if (sectionMatch) {
            currentSection = sectionMatch[1];
            if (result[currentSection] === undefined) {
              result[currentSection] = {};
            }
          } else {
            const eqIdx = line.indexOf("=");
            if (eqIdx !== -1 && currentSection) {
              const key = line.slice(0, eqIdx).trim();
              const value = line.slice(eqIdx + 1).trim();
              if (result[currentSection] === undefined) {
                result[currentSection] = {};
              }
              result[currentSection][key] = value;
            }
          }
        }
        return result;
      });
  }

  write(
    filePath: string,
    data: any,
    changes: { added: string[]; removed: string[]; changed: string[] },
  ): Promise<void> {
    return fsOrig.readFile(filePath, { encoding: "utf8" })
      .catch(() => "")
      .then((content: string) => {
        const lines = content.split(/\r?\n/);
        const removedSet = new Set(changes.removed);
        const changedMap = new Map<string, string>();
        for (const fullKey of [...changes.changed, ...changes.added]) {
          const [section, key] = fullKey.split("###");
          if (data[section]?.[key] !== undefined) {
            changedMap.set(fullKey, data[section][key]);
          }
        }

        let currentSection = "";
        const output: string[] = [];
        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          const sectionMatch = trimmed.match(/^\[(.+?)\]$/);
          if (sectionMatch) {
            currentSection = sectionMatch[1];
            output.push(rawLine);
          } else {
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx !== -1 && currentSection) {
              const key = trimmed.slice(0, eqIdx).trim();
              const fullKey = `${currentSection}###${key}`;
              if (removedSet.has(fullKey)) continue;
              if (changedMap.has(fullKey)) {
                output.push(`${key}=${changedMap.get(fullKey)}`);
                changedMap.delete(fullKey);
                continue;
              }
            }
            output.push(rawLine);
          }
        }

        // Append remaining added keys by section
        const addedBySec: { [sec: string]: { key: string; val: string }[] } = {};
        for (const [fullKey, val] of changedMap) {
          const [section, key] = fullKey.split("###");
          if (!addedBySec[section]) addedBySec[section] = [];
          addedBySec[section].push({ key, val });
        }
        for (const [section, entries] of Object.entries(addedBySec)) {
          output.push(`[${section}]`);
          for (const { key, val } of entries) {
            output.push(`${key}=${val}`);
          }
        }

        return fsOrig.writeFile(filePath, output.join("\n"));
      });
  }
}

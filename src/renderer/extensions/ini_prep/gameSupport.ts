import getVortexPath from "../../util/getVortexPath";

import * as fsNative from "fs";
import * as path from "path";
import format from "string-template";
import type { IDiscoveryResult } from "../gamemode_management/types/IDiscoveryResult";
import { makeOverlayableDictionary } from "../../util/util";
import { findHeroicWinePrefix, findHeroicAppIdByPath, findWinePrefixUserDir } from "../../util/linux/heroicPaths";

interface IGameSupport {
  iniFiles: string[];
  iniFormat: string;
}

const gameSupport = makeOverlayableDictionary<string, IGameSupport>(
  {
    skyrim: {
      iniFiles: [
        path.join("{mygames}", "Skyrim", "Skyrim.ini"),
        path.join("{mygames}", "Skyrim", "SkyrimPrefs.ini"),
      ],
      iniFormat: "winapi",
    },
    enderal: {
      iniFiles: [
        path.join("{mygames}", "Enderal", "Enderal.ini"),
        path.join("{mygames}", "Enderal", "EnderalPrefs.ini"),
      ],
      iniFormat: "winapi",
    },
    skyrimse: {
      iniFiles: [
        path.join("{mygames}", "Skyrim Special Edition", "Skyrim.ini"),
        path.join("{mygames}", "Skyrim Special Edition", "SkyrimPrefs.ini"),
        path.join("{mygames}", "Skyrim Special Edition", "SkyrimCustom.ini"),
      ],
      iniFormat: "winapi",
    },
    enderalspecialedition: {
      iniFiles: [
        path.join("{mygames}", "Enderal Special Edition", "Enderal.ini"),
        path.join("{mygames}", "Enderal Special Edition", "EnderalPrefs.ini"),
      ],
      iniFormat: "winapi",
    },
    skyrimvr: {
      iniFiles: [
        path.join("{mygames}", "Skyrim VR", "Skyrim.ini"),
        path.join("{mygames}", "Skyrim VR", "SkyrimVR.ini"),
        path.join("{mygames}", "Skyrim VR", "SkyrimPrefs.ini"),
      ],
      iniFormat: "winapi",
    },
    fallout3: {
      iniFiles: [
        path.join("{mygames}", "Fallout3", "Fallout.ini"),
        path.join("{mygames}", "Fallout3", "FalloutPrefs.ini"),
        path.join("{mygames}", "Fallout3", "FalloutCustom.ini"),
      ],
      iniFormat: "winapi",
    },
    fallout4: {
      iniFiles: [
        path.join("{mygames}", "Fallout4", "Fallout4.ini"),
        path.join("{mygames}", "Fallout4", "Fallout4Prefs.ini"),
        path.join("{mygames}", "Fallout4", "Fallout4Custom.ini"),
      ],
      iniFormat: "winapi",
    },
    fallout4vr: {
      iniFiles: [
        path.join("{mygames}", "Fallout4VR", "Fallout4Custom.ini"),
        path.join("{mygames}", "Fallout4VR", "Fallout4Prefs.ini"),
      ],
      iniFormat: "winapi",
    },
    falloutnv: {
      iniFiles: [
        path.join("{mygames}", "FalloutNV", "Fallout.ini"),
        path.join("{mygames}", "FalloutNV", "FalloutPrefs.ini"),
        path.join("{mygames}", "FalloutNV", "FalloutCustom.ini"),
      ],
      iniFormat: "winapi",
    },
    starfield: {
      iniFiles: [
        path.join("{mygames}", "Starfield", "Starfield.ini"),
        path.join("{mygames}", "Starfield", "StarfieldPrefs.ini"),
        path.join("{mygames}", "Starfield", "StarfieldCustom.ini"),
      ],
      iniFormat: "winapi",
    },
    oblivion: {
      iniFiles: [path.join("{mygames}", "Oblivion", "Oblivion.ini")],
      iniFormat: "winapi",
    },
    oblivionremastered: {
      iniFiles: [
        path.join(
          "{mygames}",
          "Oblivion Remastered",
          "Saved",
          "Config",
          "Windows",
          "Altar.ini",
        ),
      ],
      iniFormat: "winapi",
    },
    morrowind: {
      iniFiles: [path.join("{game}", "Morrowind.ini")],
      iniFormat: "winapi",
    },
  },
  {
    gog: {
      skyrimse: {
        iniFiles: [
          path.join("{mygames}", "Skyrim Special Edition GOG", "Skyrim.ini"),
          path.join(
            "{mygames}",
            "Skyrim Special Edition GOG",
            "SkyrimPrefs.ini",
          ),
          path.join(
            "{mygames}",
            "Skyrim Special Edition GOG",
            "SkyrimCustom.ini",
          ),
        ],
        iniFormat: "winapi",
      },
      enderalspecialedition: {
        iniFiles: [
          path.join("{mygames}", "Enderal Special Edition GOG", "Enderal.ini"),
          path.join(
            "{mygames}",
            "Enderal Special Edition GOG",
            "EnderalPrefs.ini",
          ),
        ],
        iniFormat: "winapi",
      },
    },
    epic: {
      skyrimse: {
        iniFiles: [
          path.join("{mygames}", "Skyrim Special Edition EPIC", "Skyrim.ini"),
          path.join(
            "{mygames}",
            "Skyrim Special Edition EPIC",
            "SkyrimPrefs.ini",
          ),
          path.join(
            "{mygames}",
            "Skyrim Special Edition EPIC",
            "SkyrimCustom.ini",
          ),
        ],
        iniFormat: "winapi",
      },
      fallout4: {
        iniFiles: [
          path.join("{mygames}", "Fallout4 EPIC", "Fallout4.ini"),
          path.join("{mygames}", "Fallout4 EPIC", "Fallout4Prefs.ini"),
          path.join("{mygames}", "Fallout4 EPIC", "Fallout4Custom.ini"),
        ],
        iniFormat: "winapi",
      },
    },
    xbox: {
      skyrimse: {
        iniFiles: [
          path.join("{mygames}", "Skyrim Special Edition MS", "Skyrim.ini"),
          path.join(
            "{mygames}",
            "Skyrim Special Edition MS",
            "SkyrimPrefs.ini",
          ),
          path.join(
            "{mygames}",
            "Skyrim Special Edition MS",
            "SkyrimCustom.ini",
          ),
        ],
        iniFormat: "winapi",
      },
      fallout4: {
        iniFiles: [
          path.join("{mygames}", "Fallout4 MS", "Fallout4.ini"),
          path.join("{mygames}", "Fallout4 MS", "Fallout4Prefs.ini"),
          path.join("{mygames}", "Fallout4 MS", "Fallout4Custom.ini"),
        ],
        iniFormat: "winapi",
      },
    },
    enderalOverride: {
      enderalspecialedition: {
        iniFiles: [
          path.join("{mygames}", "Skyrim Special Edition", "Skyrim.ini"),
          path.join("{mygames}", "Skyrim Special Edition", "SkyrimPrefs.ini"),
          path.join("{mygames}", "Skyrim Special Edition", "SkyrimCustom.ini"),
        ],
        iniFormat: "winapi",
      },
    },
  },
  (gameId: string, store: string) => store,
);

/**
 * On Linux, games running through Proton store their "My Documents" files
 * inside the Proton prefix rather than the user's home directory.
 * Derive the Proton prefix Documents path from the game's install path.
 */
function getProtonMyGames(gamePath: string): string | undefined {
  const parts = gamePath.split(path.sep);
  const commonIdx = parts.findIndex(
    (p, i) =>
      p.toLowerCase() === "common" &&
      i > 0 &&
      parts[i - 1].toLowerCase() === "steamapps",
  );
  if (commonIdx === -1) return undefined;

  const steamAppsPath = parts.slice(0, commonIdx).join(path.sep);
  const gameFolder = parts[commonIdx + 1];
  if (!gameFolder) return undefined;

  try {
    const manifests = fsNative
      .readdirSync(steamAppsPath)
      .filter((f) => f.startsWith("appmanifest_") && f.endsWith(".acf"));

    for (const manifest of manifests) {
      const content = fsNative.readFileSync(
        path.join(steamAppsPath, manifest),
        "utf8",
      );
      const installdirMatch = content.match(/"installdir"\s+"([^"]+)"/);
      const appidMatch = content.match(/"appid"\s+"([^"]+)"/);
      if (
        installdirMatch &&
        appidMatch &&
        installdirMatch[1].toLowerCase() === gameFolder.toLowerCase()
      ) {
        const docsPath = path.join(
          steamAppsPath,
          "compatdata",
          appidMatch[1],
          "pfx",
          "drive_c",
          "users",
          "steamuser",
          "Documents",
          "My Games",
        );
        if (fsNative.existsSync(docsPath)) {
          return docsPath;
        }
      }
    }
  } catch (e) {
    // Fall through to default documents path
  }
  return undefined;
}

/**
 * On Linux, get the "My Games" path from a Heroic Wine prefix.
 */
function getHeroicMyGames(gamePath: string): string | undefined {
  const appId = findHeroicAppIdByPath(gamePath);
  if (!appId) return undefined;

  const winePrefix = findHeroicWinePrefix(appId);
  if (!winePrefix) return undefined;

  const userDir = findWinePrefixUserDir(winePrefix);
  if (!userDir) return undefined;

  const myGames = path.join(userDir, "Documents", "My Games");
  if (fsNative.existsSync(myGames)) {
    return myGames;
  }
  return undefined;
}

export function iniFiles(gameMode: string, discovery: IDiscoveryResult) {
  let mygames = path.join(getVortexPath("documents"), "My Games");

  // On Linux, check if the game runs through Proton/Wine and use the prefix's Documents
  if (process.platform === "linux" && discovery?.path) {
    let prefixMyGames: string | undefined;
    if (discovery.store === "heroic") {
      prefixMyGames = getHeroicMyGames(discovery.path);
    } else {
      prefixMyGames = getProtonMyGames(discovery.path);
    }
    if (prefixMyGames !== undefined) {
      mygames = prefixMyGames;
    }
  }

  let store = discovery?.store;

  // override for the case where enderal se is installed as a total conversion
  // instead of the stand-alone version
  if (
    gameMode === "enderalspecialedition" &&
    discovery?.path !== undefined &&
    discovery?.path.toLowerCase().includes("skyrim")
  ) {
    store = "enderaloverride";
  }

  const files = (gameSupport.get(gameMode, "iniFiles", store) ?? []).map(
    (filePath) => format(filePath, { mygames, game: discovery.path }),
  );

  // On Linux, resolve case-insensitive filenames since Wine/Proton may create
  // files with different casing than what game extensions expect
  if (process.platform === "linux") {
    return files.map(resolveCaseInsensitive);
  }
  return files;
}

/**
 * On a case-sensitive filesystem, find the actual filename that matches
 * the expected path case-insensitively. Returns the original path if no
 * match is found (so the caller gets the expected ENOENT).
 */
function resolveCaseInsensitive(filePath: string): string {
  try {
    fsNative.statSync(filePath);
    return filePath; // exact match exists
  } catch {
    // file doesn't exist with this exact case — try to find it
  }

  const dir = path.dirname(filePath);
  const base = path.basename(filePath).toLowerCase();

  try {
    const entries = fsNative.readdirSync(dir);
    const match = entries.find((e) => e.toLowerCase() === base);
    if (match) {
      return path.join(dir, match);
    }
  } catch {
    // directory doesn't exist
  }

  // Also try resolving the parent directory case-insensitively
  // (e.g. "Fallout3" dir might be "fallout3")
  const parentDir = path.dirname(dir);
  const dirBase = path.basename(dir).toLowerCase();

  try {
    const parentEntries = fsNative.readdirSync(parentDir);
    const dirMatch = parentEntries.find((e) => e.toLowerCase() === dirBase);
    if (dirMatch) {
      const resolvedDir = path.join(parentDir, dirMatch);
      const entries = fsNative.readdirSync(resolvedDir);
      const fileMatch = entries.find((e) => e.toLowerCase() === base);
      if (fileMatch) {
        return path.join(resolvedDir, fileMatch);
      }
    }
  } catch {
    // parent doesn't exist either
  }

  return filePath;
}

export function iniFormat(gameMode: string) {
  return gameSupport.get(gameMode, "iniFormat");
}

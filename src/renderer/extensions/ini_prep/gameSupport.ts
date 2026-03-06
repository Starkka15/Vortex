import getVortexPath from "../../util/getVortexPath";

import * as fsNative from "fs";
import * as path from "path";
import format from "string-template";
import type { IDiscoveryResult } from "../gamemode_management/types/IDiscoveryResult";
import { makeOverlayableDictionary } from "../../util/util";

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

export function iniFiles(gameMode: string, discovery: IDiscoveryResult) {
  let mygames = path.join(getVortexPath("documents"), "My Games");

  // On Linux, check if the game runs through Proton and use the prefix's Documents
  if (process.platform === "linux" && discovery?.path) {
    const protonMyGames = getProtonMyGames(discovery.path);
    if (protonMyGames !== undefined) {
      mygames = protonMyGames;
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

  return (gameSupport.get(gameMode, "iniFiles", store) ?? []).map((filePath) =>
    format(filePath, { mygames, game: discovery.path }),
  );
}

export function iniFormat(gameMode: string) {
  return gameSupport.get(gameMode, "iniFormat");
}

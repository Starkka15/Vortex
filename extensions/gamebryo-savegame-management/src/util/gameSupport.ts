import * as fs from "fs";
import * as path from "path";
import * as Redux from "redux";
import { selectors, types, util } from "vortex-api";

interface IGameSupport {
  mygamesPath: string;
  iniName: string;
  prefIniName?: string;
  saveFiles: (input: string) => string[];
}

function scriptExtenderFiles(input: string, seext: string): string[] {
  const ext = path.extname(input);
  return [path.basename(input, ext) + "." + seext];
}

const gameSupport = util.makeOverlayableDictionary<string, IGameSupport>(
  {
    skyrim: {
      mygamesPath: "skyrim",
      iniName: "Skyrim.ini",
      prefIniName: "SkyrimPrefs.ini",
      saveFiles: (input: string): string[] => {
        return [].concat([input], scriptExtenderFiles(input, "skse"));
      },
    },
    enderal: {
      mygamesPath: "enderal",
      iniName: "Enderal.ini",
      prefIniName: "EnderalPrefs.ini",
      saveFiles: (input: string): string[] =>
        [].concat([input], scriptExtenderFiles(input, "skse")),
    },
    skyrimse: {
      mygamesPath: "Skyrim Special Edition",
      iniName: "Skyrim.ini",
      prefIniName: "SkyrimPrefs.ini",
      saveFiles: (input: string): string[] => {
        return [].concat([input], scriptExtenderFiles(input, "skse"));
      },
    },
    skyrimvr: {
      mygamesPath: "Skyrim VR",
      iniName: "SkyrimVR.ini",
      prefIniName: "SkyrimPrefs.ini",
      saveFiles: (input: string): string[] => {
        return [].concat([input], scriptExtenderFiles(input, "skse"));
      },
    },
    fallout3: {
      mygamesPath: "Fallout3",
      iniName: "Fallout.ini",
      prefIniName: "FalloutPrefs.ini",
      saveFiles: (input: string): string[] => {
        return [].concat([input], scriptExtenderFiles(input, "fose"));
      },
    },
    fallout4: {
      mygamesPath: "Fallout4",
      iniName: "Fallout4Custom.ini",
      prefIniName: "Fallout4Prefs.ini",
      saveFiles: (input: string): string[] => {
        return [].concat([input], scriptExtenderFiles(input, "f4se"));
      },
    },
    fallout4vr: {
      mygamesPath: "Fallout4VR",
      iniName: "Fallout4Custom.ini",
      saveFiles: (input: string): string[] => {
        return [].concat([input], scriptExtenderFiles(input, "f4se"));
      },
    },
    falloutnv: {
      mygamesPath: "FalloutNV",
      iniName: "Fallout.ini",
      prefIniName: "FalloutPrefs.ini",
      saveFiles: (input: string): string[] => {
        return [].concat([input], scriptExtenderFiles(input, "nvse"));
      },
    },
    // starfield: {
    //   mygamesPath: 'Starfield',
    //   iniName: 'StarfieldCustom.ini',
    //   prefIniName: 'StarfieldPrefs.ini',
    //   saveFiles: (input: string): string[] => {
    //     return [].concat([input], scriptExtenderFiles(input, 'sfse'));
    //   },
    // },
    oblivion: {
      mygamesPath: "Oblivion",
      iniName: "Oblivion.ini",
      saveFiles: (input: string): string[] => {
        return [].concat([input], scriptExtenderFiles(input, "obse"));
      },
    },
    enderalspecialedition: {
      mygamesPath: "Enderal Special Edition",
      iniName: "Enderal.ini",
      prefIniName: "EnderalPrefs.ini",
      saveFiles: (input: string): string[] =>
        [].concat([input], scriptExtenderFiles(input, "skse")),
    },
  },
  {
    xbox: {
      skyrimse: {
        mygamesPath: "Skyrim Special Edition MS",
      },
      fallout4: {
        mygamesPath: "Fallout4 MS",
      },
      // starfield: {
      //   mygamesPath: path.join(util.getVortexPath('localAppData'), 'Packages', 'BethesdaSoftworks.Starfield_3275kfvn8vcwc', 'SystemAppData', 'wgs'),
      // }
    },
    gog: {
      skyrimse: {
        mygamesPath: "Skyrim Special Edition GOG",
      },
      enderalspecialedition: {
        mygamesPath: "Enderal Special Edition GOG",
      },
    },
    epic: {
      skyrimse: {
        mygamesPath: "Skyrim Special Edition EPIC",
      },
      fallout4: {
        mygamesPath: "Fallout4 EPIC",
      },
    },
    enderalseOverlay: {
      enderalspecialedition: {
        mygamesPath: "Skyrim Special Edition",
        iniName: "Skyrim.ini",
        prefIniName: "SkyrimPrefs.ini",
      },
    },
  },
  (gameId: string) => {
    const discovery = discoveryForGame(gameId);
    if (
      discovery?.path !== undefined &&
      gameId === "enderalspecialedition" &&
      discovery.path.includes("skyrim")
    ) {
      return "enderalseOverlay";
    } else {
      return discovery?.store;
    }
  },
);

let discoveryForGame: (gameId: string) => types.IDiscoveryResult = () =>
  undefined;

export function initGameSupport(api: types.IExtensionApi) {
  discoveryForGame = (gameId: string) =>
    selectors.discoveryByGame(api.store.getState(), gameId);
}

export function gameSupported(gameMode: string): boolean {
  return gameSupport[gameMode] !== undefined;
}

function getProtonMyGames(gamePath: string): string | undefined {
  if (process.platform !== "linux" || !gamePath) return undefined;
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
    const manifests = fs
      .readdirSync(steamAppsPath)
      .filter((f) => f.startsWith("appmanifest_") && f.endsWith(".acf"));

    for (const manifest of manifests) {
      const content = fs.readFileSync(
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
        if (fs.existsSync(docsPath)) {
          return docsPath;
        }
      }
    }
  } catch (e) {
    // Fall through to default
  }
  return undefined;
}

export function mygamesPath(gameMode: string): string {
  let baseMyGames: string | undefined;

  if (process.platform === "linux") {
    // setupProtonEnvVars sets DOCUMENTS for both Steam and Heroic games
    if (process.env.DOCUMENTS) {
      baseMyGames = path.join(process.env.DOCUMENTS, "My Games");
    } else {
      const discovery = discoveryForGame(gameMode);
      const protonMyGames = discovery?.path
        ? getProtonMyGames(discovery.path)
        : undefined;
      baseMyGames = protonMyGames;
    }
  }

  if (!baseMyGames) {
    baseMyGames = path.join(util.getVortexPath("documents"), "My Games");
  }

  return path.join(
    baseMyGames,
    gameSupport.get(gameMode, "mygamesPath"),
  );
}

export function iniPath(gameMode: string): string {
  return path.join(mygamesPath(gameMode), gameSupport.get(gameMode, "iniName"));
}

export function prefIniPath(gameMode: string): string {
  const prefIniName = gameSupport.get(gameMode, "prefIniName");
  if (prefIniName === undefined) {
    return undefined;
  }
  return path.join(mygamesPath(gameMode), prefIniName);
}

export function saveFiles(gameMode: string, savePath: string): string[] {
  return gameSupport.get(gameMode, "saveFiles")(savePath);
}

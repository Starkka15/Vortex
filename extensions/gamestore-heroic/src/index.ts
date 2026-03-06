import Bluebird from "bluebird";
import * as path from "path";
import * as fs from "fs";
import { log, types } from "vortex-api";

const STORE_ID = "heroic";
const STORE_NAME = "Heroic";
const STORE_PRIORITY = 20; // DRM-free friendly, similar to GOG

// Heroic can be installed via Flatpak, native package, or AppImage
// Each has a different config path
function findHeroicConfigPath(): string | undefined {
  const home = process.env.HOME || require("os").homedir();

  const candidates = [
    // Flatpak (most common on Linux)
    path.join(home, ".var/app/com.heroicgameslauncher.hgl/config/heroic"),
    // Native / AppImage / deb / rpm
    path.join(home, ".config/heroic"),
    // Snap
    path.join(home, "snap/heroic-games-launcher/current/.config/heroic"),
  ];

  for (const candidate of candidates) {
    try {
      fs.statSync(candidate);
      return candidate;
    } catch {
      // not found, try next
    }
  }
  return undefined;
}

interface IHeroicGogInstalled {
  appName: string;
  install_path: string;
  platform: string;
  install_size: string;
  version: string;
  language: string;
  is_dlc: boolean;
}

interface IHeroicGameConfig {
  wineVersion?: {
    bin: string;
    name: string;
    type: string;
  };
  winePrefix?: string;
}

export interface IHeroicEntry extends types.IGameStoreEntry {
  /** "epic", "gog", or "nile" (Amazon) */
  heroicStore: string;
  /** Wine/Proton prefix path if configured */
  winePrefix?: string;
  /** Proton/Wine binary path */
  wineBin?: string;
  /** "proton" or "wine" */
  wineType?: string;
}

function readJsonSync(filePath: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

class HeroicLauncher implements types.IGameStore {
  public id: string = STORE_ID;
  public name: string = STORE_NAME;
  public priority: number = STORE_PRIORITY;
  private mConfigPath: string | undefined;
  private mCache: Bluebird<IHeroicEntry[]>;

  constructor() {
    this.mConfigPath = findHeroicConfigPath();
    if (this.mConfigPath) {
      log("info", "heroic config found", { path: this.mConfigPath });
    } else {
      log("info", "heroic not found");
    }
  }

  public findByName(namePattern: string): Bluebird<IHeroicEntry> {
    const re = new RegExp("^" + namePattern + "$", "i");
    return this.allGames()
      .then((entries) => entries.find((entry) => re.test(entry.name)))
      .then((entry) => {
        if (entry === undefined) {
          return Bluebird.reject(
            new types.GameEntryNotFound(namePattern, STORE_ID),
          );
        }
        return Bluebird.resolve(entry);
      });
  }

  public findByAppId(
    appId: string | string[],
  ): Bluebird<IHeroicEntry> {
    const matcher = Array.isArray(appId)
      ? (entry: IHeroicEntry) => appId.includes(entry.appid)
      : (entry: IHeroicEntry) => appId === entry.appid;

    return this.allGames().then((entries) => {
      const entry = entries.find(matcher);
      if (entry === undefined) {
        return Bluebird.reject(
          new types.GameEntryNotFound(
            Array.isArray(appId) ? appId.join(", ") : appId,
            STORE_ID,
          ),
        );
      }
      return Bluebird.resolve(entry);
    });
  }

  public launchGame(appInfo: any, api?: types.IExtensionApi): Bluebird<void> {
    const appId =
      typeof appInfo === "object" ? appInfo.appId || appInfo : appInfo;
    const { exec } = require("child_process");
    return new Bluebird<void>((resolve, reject) => {
      // Try xdg-open with heroic:// protocol, fall back to flatpak run
      exec(`xdg-open "heroic://launch/${appId}"`, (err: any) => {
        if (err) {
          exec(
            `flatpak run com.heroicgameslauncher.hgl --no-gui "heroic://launch/${appId}"`,
            (err2: any) => {
              if (err2) {
                log("warn", "failed to launch game via heroic", {
                  appId,
                  error: err2.message,
                });
              }
              resolve();
            },
          );
        } else {
          resolve();
        }
      });
    });
  }

  public getExecInfo(appId: any): Bluebird<types.IExecInfo> {
    // Heroic doesn't have a simple executable launch pattern
    return Bluebird.reject(
      new types.GameEntryNotFound(String(appId), STORE_ID),
    );
  }

  public allGames(): Bluebird<IHeroicEntry[]> {
    if (!this.mCache) {
      this.mCache = Bluebird.resolve(this.getGameEntries());
    }
    return this.mCache;
  }

  public reloadGames(): Bluebird<void> {
    return new Bluebird((resolve) => {
      this.mCache = Bluebird.resolve(this.getGameEntries());
      resolve();
    });
  }

  public getGameStorePath(): Bluebird<string | undefined> {
    // Try to find the heroic executable
    const candidates = [
      "/usr/bin/heroic",
      "/usr/local/bin/heroic",
    ];
    for (const c of candidates) {
      try {
        fs.statSync(c);
        return Bluebird.resolve(c);
      } catch {
        // continue
      }
    }
    // Flatpak - no single executable path, but it's installed
    return Bluebird.resolve(undefined);
  }

  public isGameStoreInstalled(): Bluebird<boolean> {
    return Bluebird.resolve(this.mConfigPath !== undefined);
  }

  public identifyGame(
    gamePath: string,
    fallback: (gamePath: string) => PromiseLike<boolean>,
  ): Bluebird<boolean> {
    // Check if the game path is under a known Heroic library path
    return this.allGames().then((entries) => {
      const found = entries.some(
        (entry) =>
          gamePath.toLowerCase() === entry.gamePath.toLowerCase(),
      );
      return Bluebird.resolve(fallback(gamePath)).then(
        (fbResult: boolean) => found || fbResult,
      );
    });
  }

  private getGameEntries(): IHeroicEntry[] {
    if (!this.mConfigPath) {
      return [];
    }

    const entries: IHeroicEntry[] = [];

    // 1. GOG games (installed.json)
    this.loadGogGames(entries);

    // 2. Epic/Legendary games (legendary_install_info.json)
    this.loadEpicGames(entries);

    // 3. Amazon/Nile games (nile_install_info.json)
    this.loadNileGames(entries);

    log("info", "heroic games discovered", { count: entries.length });
    return entries;
  }

  private loadGogGames(entries: IHeroicEntry[]): void {
    const installedPath = path.join(
      this.mConfigPath!,
      "gog_store",
      "installed.json",
    );
    const data = readJsonSync(installedPath);
    if (!data?.installed) return;

    // Load GOG library for titles
    const libPath = path.join(
      this.mConfigPath!,
      "store_cache",
      "gog_library.json",
    );
    const libData = readJsonSync(libPath);
    const titleMap = new Map<string, string>();
    if (libData?.games) {
      for (const g of libData.games) {
        if (g.app_name && g.title) {
          titleMap.set(g.app_name, g.title);
        }
      }
    }

    for (const game of data.installed as IHeroicGogInstalled[]) {
      if (game.is_dlc || !game.install_path) continue;

      const config = this.loadGameConfig(game.appName);
      const title = titleMap.get(game.appName) || game.appName;

      entries.push({
        appid: game.appName,
        name: title,
        gamePath: game.install_path,
        gameStoreId: STORE_ID,
        heroicStore: "gog",
        winePrefix: config?.winePrefix,
        wineBin: config?.wineVersion?.bin,
        wineType: config?.wineVersion?.type,
      });
    }
  }

  private loadEpicGames(entries: IHeroicEntry[]): void {
    const installInfoPath = path.join(
      this.mConfigPath!,
      "store_cache",
      "legendary_install_info.json",
    );
    const data = readJsonSync(installInfoPath);
    if (!data) return;

    for (const [appName, info] of Object.entries<any>(data)) {
      if (appName === "__timestamp") continue;
      const install = info?.install;
      if (!install?.install_path || info?.game?.is_dlc) continue;

      const config = this.loadGameConfig(appName);
      const title = info?.game?.title || appName;

      entries.push({
        appid: appName,
        name: title,
        gamePath: install.install_path,
        gameStoreId: STORE_ID,
        heroicStore: "epic",
        winePrefix: config?.winePrefix,
        wineBin: config?.wineVersion?.bin,
        wineType: config?.wineVersion?.type,
      });
    }
  }

  private loadNileGames(entries: IHeroicEntry[]): void {
    const installInfoPath = path.join(
      this.mConfigPath!,
      "store_cache",
      "nile_install_info.json",
    );
    const data = readJsonSync(installInfoPath);
    if (!data) return;

    for (const [appName, info] of Object.entries<any>(data)) {
      if (appName === "__timestamp") continue;
      const install = info?.install;
      if (!install?.install_path || info?.game?.is_dlc) continue;

      const config = this.loadGameConfig(appName);
      const title = info?.game?.title || appName;

      entries.push({
        appid: appName,
        name: title,
        gamePath: install.install_path,
        gameStoreId: STORE_ID,
        heroicStore: "nile",
        winePrefix: config?.winePrefix,
        wineBin: config?.wineVersion?.bin,
        wineType: config?.wineVersion?.type,
      });
    }
  }

  private loadGameConfig(appName: string): IHeroicGameConfig | undefined {
    const configPath = path.join(
      this.mConfigPath!,
      "GamesConfig",
      `${appName}.json`,
    );
    const data = readJsonSync(configPath);
    if (!data) return undefined;

    // The config file has the appName as key, and sometimes a "version" key
    return data[appName] as IHeroicGameConfig | undefined;
  }
}

function main(context: types.IExtensionContext) {
  if (process.platform !== "linux") {
    // Heroic is primarily a Linux launcher
    // (it does run on Windows/Mac but rarely used for modding there)
    return true;
  }

  const instance = new HeroicLauncher();
  context.registerGameStore(instance);

  return true;
}

export default main;

import * as path from "path";
import * as fs from "fs";
import { log } from "../log";

/**
 * Find the Heroic Games Launcher config directory.
 * Heroic can be installed via Flatpak, native package, or Snap.
 */
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

/**
 * Read the Heroic per-game config to get the Wine prefix path.
 * Config files are at <heroicConfig>/GamesConfig/<appId>.json
 */
export function findHeroicWinePrefix(appId: string): string | undefined {
  const configPath = findHeroicConfigPath();
  if (!configPath) return undefined;

  const gameConfigPath = path.join(configPath, "GamesConfig", `${appId}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(gameConfigPath, "utf8"));
    const prefix = data?.[appId]?.winePrefix;
    if (prefix && typeof prefix === "string") {
      return prefix;
    }
  } catch {
    // config not found or unreadable
  }
  return undefined;
}

/**
 * Find the Heroic app ID for a game by its install path.
 * Searches GOG installed.json and Epic/Nile store caches.
 */
export function findHeroicAppIdByPath(gamePath: string): string | undefined {
  const configPath = findHeroicConfigPath();
  if (!configPath) return undefined;

  const lowerGamePath = gamePath.toLowerCase();

  // Check GOG installed.json
  try {
    const gogPath = path.join(configPath, "gog_store", "installed.json");
    const gogData = JSON.parse(fs.readFileSync(gogPath, "utf8"));
    if (gogData?.installed) {
      for (const game of gogData.installed) {
        if (game.install_path?.toLowerCase() === lowerGamePath) {
          return game.appName;
        }
      }
    }
  } catch { /* not found */ }

  // Check Epic store cache
  try {
    const epicPath = path.join(configPath, "store_cache", "legendary_install_info.json");
    const epicData = JSON.parse(fs.readFileSync(epicPath, "utf8"));
    for (const [appName, info] of Object.entries<any>(epicData)) {
      if (appName === "__timestamp") continue;
      if (info?.install?.install_path?.toLowerCase() === lowerGamePath) {
        return appName;
      }
    }
  } catch { /* not found */ }

  // Check Nile (Amazon) store cache
  try {
    const nilePath = path.join(configPath, "store_cache", "nile_install_info.json");
    const nileData = JSON.parse(fs.readFileSync(nilePath, "utf8"));
    for (const [appName, info] of Object.entries<any>(nileData)) {
      if (appName === "__timestamp") continue;
      if (info?.install?.install_path?.toLowerCase() === lowerGamePath) {
        return appName;
      }
    }
  } catch { /* not found */ }

  return undefined;
}

/**
 * Find the user directory inside a Wine prefix's drive_c/users/.
 * Heroic prefixes may use the actual Linux username instead of "steamuser".
 * Returns the first existing user dir that has a Documents folder.
 */
export function findWinePrefixUserDir(prefixPath: string): string | undefined {
  const driveC = path.join(prefixPath, "drive_c");
  const usersDir = path.join(driveC, "users");

  try {
    const entries = fs.readdirSync(usersDir);
    // Prefer steamuser first (Proton convention), then try actual usernames
    const candidates = ["steamuser", ...entries.filter(
      (e) => e !== "steamuser" && e !== "Public",
    )];

    for (const user of candidates) {
      const userDir = path.join(usersDir, user);
      const docsDir = path.join(userDir, "Documents");
      try {
        fs.statSync(docsDir);
        return userDir;
      } catch {
        // no Documents dir, try next user
      }
    }
  } catch (err: any) {
    log("debug", "Could not scan Wine prefix users dir", { error: err?.message });
  }
  return undefined;
}

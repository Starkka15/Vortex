import type { IGame } from "../../../types/IGame";
import type { IGameStore } from "../../../types/IGameStore";
import local from "../../../util/local";
import type { IExtensionDownloadInfo } from "../../../types/extensions";
import type GameVersionManager from "../../gameversion_management/GameVersionManager";
import type { IGameStub } from "../GameModeManager";
import type GameModeManager from "../GameModeManager";
import type { IDiscoveryResult } from "../types/IDiscoveryResult";

import { getModTypeExtensions } from "./modTypeExtensions";

import * as fs from "fs";
import * as path from "path";

/**
 * Synchronously resolve a path case-insensitively on Linux.
 * Walks each segment and finds the actual casing on disk.
 * If a segment doesn't exist at all, returns the original path
 * (so mkdir will create it with the extension-specified casing).
 */
function resolvePathCaseSync(filePath: string): string {
  if (!filePath || process.platform === "win32") {
    return filePath;
  }
  filePath = filePath.replace(/\\/g, "/");
  const segments = filePath.split(path.sep).filter(Boolean);
  let resolved = filePath.startsWith(path.sep) ? path.sep : "";
  for (const seg of segments) {
    const candidate = path.join(resolved, seg);
    try {
      fs.statSync(candidate);
      resolved = candidate;
    } catch {
      // Exact case doesn't exist — try case-insensitive match
      try {
        const entries = fs.readdirSync(resolved);
        const match = entries.find(
          (e: string) => e.toLowerCase() === seg.toLowerCase(),
        );
        if (match) {
          resolved = path.join(resolved, match);
        } else {
          // Directory doesn't exist at all — use original casing for the rest
          return path.join(resolved, ...segments.slice(segments.indexOf(seg)));
        }
      } catch {
        return filePath;
      }
    }
  }
  return resolved;
}

// "decorate" IGame objects with added functionality
const gameExHandler = {
  get: (target: IGame, key: PropertyKey) => {
    if (key === "getModPaths") {
      const applicableExtensions = getModTypeExtensions().filter((ex) =>
        ex.isSupported(target.id),
      );
      const extTypes = applicableExtensions.reduce((prev, val) => {
        try {
          const typePath = val.getPath(target);
          if (typePath !== undefined) {
            prev[val.typeId] = typePath;
          }
        } catch (err) {
          // Some extensions may return invalid paths (e.g. null pattern)
          // before full initialization. Skip them rather than crashing.
        }
        return prev;
      }, {});

      return (gamePath) => {
        let defaultPath = target.queryModPath(gamePath);
        if (!defaultPath) {
          defaultPath = ".";
        }
        if (!path.isAbsolute(defaultPath)) {
          defaultPath = path.resolve(gamePath, defaultPath);
        }
        const result = {
          ...extTypes,
          "": defaultPath,
        };
        // On Linux, resolve each mod path case-insensitively so we use
        // the actual directory on disk (e.g. "data" instead of "Data")
        // rather than creating a duplicate directory with different casing.
        if (process.platform === "linux") {
          for (const key of Object.keys(result)) {
            result[key] = resolvePathCaseSync(result[key]);
          }
        }
        return result;
      };
    } else if (key === "modTypes") {
      return getModTypeExtensions().filter((ex) => ex.isSupported(target.id));
    } else if (key === "getInstalledVersion") {
      return (discovery: IDiscoveryResult) =>
        gvm.gameVersionManager.getGameVersion(target, discovery);
    } else {
      return target[key];
    }
  },
};

function makeGameProxy(game: IGame): IGame {
  if (game === undefined) {
    return undefined;
  }
  return new Proxy(game, gameExHandler);
}

// this isn't nice...
const $ = local<{
  gameModeManager: GameModeManager;
  extensionGames: IGame[];
  extensionStubs: IGameStub[];
}>("gamemode-management", {
  gameModeManager: undefined,
  extensionGames: [],
  extensionStubs: [],
});

// ...neither is this
const gvm = local<{
  gameVersionManager: GameVersionManager;
}>("gameversion-manager", {
  gameVersionManager: undefined,
});

// ...or this
export function getGames(): IGame[] {
  if ($.gameModeManager === undefined) {
    throw new Error("getGames only available in renderer process");
  }
  return $.gameModeManager.games.map(makeGameProxy);
}

export function getGame(gameId: string): IGame {
  let game = $.extensionGames.find((iter) => iter.id === gameId);
  if (game === undefined) {
    const stub = $.extensionStubs.find((iter) => iter.game.id === gameId);
    if (stub !== undefined) {
      game = stub.game;
    }
  }
  return makeGameProxy(game);
}

export function getGameStubDownloadInfo(
  gameId: string,
): IExtensionDownloadInfo | undefined {
  const stub = $.extensionStubs.find((iter) => iter.game.id === gameId);
  return stub?.ext;
}

export function getGameStores(): IGameStore[] {
  if ($.gameModeManager === undefined) {
    throw new Error("getGameStores only available in renderer process");
  }

  return $.gameModeManager.gameStores || [];
}

export function getGameStore(id: string): IGameStore {
  return $.gameModeManager.gameStores.find((store) => store?.id === id);
}

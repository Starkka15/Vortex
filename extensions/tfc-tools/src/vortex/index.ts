import { fork } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { log, selectors, types } from "vortex-api";
import { InstallResult } from "../patching/Orchestrator";
import { BackupManager } from "../patching/BackupManager";

/**
 * Game IDs supported by TFC texture patching.
 */
const SUPPORTED_GAMES = new Set([
  "bioshock",
  "bioshock2",
  "bioshockinfinite",
  "dishonored",
]);

/**
 * Mod type IDs used by BioShock/Dishonored game extensions for TFC mods.
 */
const TFC_MOD_TYPE_SUFFIXES = ["-tfcmod"];

/**
 * Files that indicate a directory contains a TFC mod.
 */
const TFC_MARKER_FILES = ["gameprofile.xml"];
const TFC_MARKER_EXTS = [".tfcmapping"];

function isGameSupported(gameId: string): boolean {
  return SUPPORTED_GAMES.has(gameId);
}

function isTfcMod(mod: types.IMod): boolean {
  if (mod.type && TFC_MOD_TYPE_SUFFIXES.some(s => mod.type.endsWith(s))) {
    return true;
  }
  return false;
}

/**
 * Find all deployed TFC mod directories in the staging folder.
 */
function findTfcModDirs(
  stagingPath: string,
  mods: { [id: string]: types.IMod },
  enabledModIds: Set<string>,
): string[] {
  const modDirs: string[] = [];

  for (const [modId, mod] of Object.entries(mods)) {
    if (mod.state !== "installed") continue;
    if (!enabledModIds.has(modId)) continue;

    const modPath = path.join(stagingPath, mod.installationPath);
    if (!fs.existsSync(modPath)) continue;

    // Scan for TFC markers (GameProfile.xml, .tfcmapping, .packagepatch)
    const dirs = findDirsWithMarker(modPath);
    modDirs.push(...dirs);
  }

  return modDirs;
}

/**
 * Recursively find directories containing TFC mod markers.
 */
function findDirsWithMarker(dir: string, depth: number = 3): string[] {
  if (depth <= 0) return [];

  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const hasMarker = entries.some(e =>
    e.isFile() && (
      TFC_MARKER_FILES.includes(e.name.toLowerCase()) ||
      TFC_MARKER_EXTS.includes(path.extname(e.name).toLowerCase())
    )
  );

  if (hasMarker) {
    results.push(dir);
  } else {
    for (const entry of entries) {
      if (entry.isDirectory()) {
        results.push(...findDirsWithMarker(path.join(dir, entry.name), depth - 1));
      }
    }
  }

  return results;
}

/**
 * Run installTextureMod in a child process to avoid blocking the UI.
 * Uses fork() with ELECTRON_RUN_AS_NODE so the Electron binary acts as Node.
 */
function runPatchWorker(
  modDir: string,
  gameDir: string,
  gameId: string,
  onProgress?: (info: { phase: string; message: string }) => void,
): Promise<InstallResult> {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, "patchWorker.js");
    const child = fork(workerPath, [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      silent: true,
    });

    let settled = false;

    child.on("message", (msg: any) => {
      if (msg.type === "progress") {
        onProgress?.(msg);
      } else if (msg.type === "result") {
        settled = true;
        resolve(msg.result);
      } else if (msg.type === "error") {
        settled = true;
        reject(new Error(msg.message));
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Patch worker exited with code ${code}`));
      }
    });

    // Send work parameters to the child
    child.send({ modDir, gameDir, gameId });
  });
}

/**
 * Run TFC texture patching for all deployed TFC mods.
 */
async function patchTextureMods(
  api: types.IExtensionApi,
  gameId: string,
): Promise<void> {
  const state = api.getState();

  const discovery = state.settings.gameMode.discovered?.[gameId];
  if (!discovery?.path) {
    return;
  }
  const gamePath = discovery.path;

  const stagingPath = selectors.installPathForGame(state, gameId);
  const mods = state.persistent.mods?.[gameId] ?? {};

  log("info", "[tfc-tools] patchTextureMods", { gamePath, stagingPath, totalMods: Object.keys(mods).length });

  // Get active profile's enabled mods
  const profileId = selectors.lastActiveProfileForGame(state, gameId);
  const profile = state.persistent.profiles?.[profileId];
  const enabledModIds = new Set<string>();
  if (profile?.modState) {
    for (const [modId, modState] of Object.entries(profile.modState)) {
      if ((modState as any)?.enabled) {
        enabledModIds.add(modId);
      }
    }
  }

  // Find TFC mod directories
  const modDirs = findTfcModDirs(stagingPath, mods, enabledModIds);
  log("info", "[tfc-tools] TFC mod dirs found", { count: modDirs.length, dirs: modDirs });
  if (modDirs.length === 0) {
    return;
  }

  const notifId = `tfc-patching-${Date.now()}`;

  api.sendNotification?.({
    id: notifId,
    type: "activity",
    message: "Patching textures...",
    noDismiss: true,
    allowSuppress: false,
  });

  const results: { modDir: string; result?: InstallResult; error?: string }[] = [];

  try {
    for (let i = 0; i < modDirs.length; i++) {
      const modDir = modDirs[i];
      const modName = path.basename(modDir);

      api.sendNotification?.({
        id: notifId,
        type: "activity",
        message: `Patching textures: ${modName} (${i + 1}/${modDirs.length})`,
        noDismiss: true,
        allowSuppress: false,
      });

      try {
        const result = await runPatchWorker(modDir, gamePath, gameId, (info) => {
          api.sendNotification?.({
            id: notifId,
            type: "activity",
            message: `${modName}: ${info.message}`,
            noDismiss: true,
            allowSuppress: false,
          });
        });
        results.push({ modDir, result });
      } catch (err: any) {
        results.push({ modDir, error: err.message ?? String(err) });
      }
    }

    api.dismissNotification?.(notifId);

    // Summarize results
    const totalTextures = results.reduce(
      (sum, r) => sum + (r.result?.texturesUpdated ?? 0), 0,
    );
    const totalPackages = results.reduce(
      (sum, r) => sum + (r.result?.packagesModified ?? 0), 0,
    );
    const errors = results.filter(r => r.error || (r.result?.errors?.length ?? 0) > 0);

    if (errors.length > 0) {
      const errorDetails = errors.map(e => {
        if (e.error) return `${path.basename(e.modDir)}: ${e.error}`;
        return e.result!.errors.map(
          err => `${path.basename(e.modDir)}: ${err.file} — ${err.message}`
        ).join("\n");
      }).join("\n");

      api.showErrorNotification?.(
        "Texture patching completed with errors",
        errorDetails,
        { allowReport: false },
      );
    }

    if (totalTextures > 0) {
      api.sendNotification?.({
        type: "success",
        message: `Textures patched: ${totalTextures} textures in ${totalPackages} packages`,
        displayMS: 5000,
      });
    }
  } catch (err: any) {
    api.dismissNotification?.(notifId);
    api.showErrorNotification?.("Texture patching failed", err, {
      allowReport: false,
    });
  }
}

/**
 * Restore backed-up files when mods are purged.
 */
async function restoreBackups(
  api: types.IExtensionApi,
  gameId: string,
): Promise<void> {
  const state = api.getState();
  const discovery = state.settings.gameMode.discovered?.[gameId];
  if (!discovery?.path) return;

  const gamePath = discovery.path;
  const backupMgr = new BackupManager(gamePath);

  if (!backupMgr.hasBackup()) return;

  api.sendNotification?.({
    type: "activity",
    message: "Restoring texture backups...",
    noDismiss: true,
    allowSuppress: false,
  });

  try {
    backupMgr.restoreLatest();
    api.sendNotification?.({
      type: "success",
      message: "Texture backups restored",
      displayMS: 3000,
    });
  } catch (err: any) {
    api.showErrorNotification?.("Failed to restore texture backups", err, {
      allowReport: false,
    });
  }
}

/**
 * Vortex extension entry point.
 */
function init(context: types.IExtensionContext): boolean {
  context.once(() => {
    context.api.onAsync("did-deploy", async (profileId: string) => {
      const state = context.api.getState();
      const gameId = selectors.activeGameId(state);

      log("debug", "[tfc-tools] did-deploy fired", { profileId, gameId });

      if (!isGameSupported(gameId)) return;

      const lastProfile = selectors.lastActiveProfileForGame(state, gameId);
      if (profileId !== lastProfile) return;

      await patchTextureMods(context.api, gameId);
    });

    context.api.onAsync("will-purge", async (profileId: string) => {
      const state = context.api.getState();
      const gameId = selectors.activeGameId(state);

      if (!isGameSupported(gameId)) return;

      await restoreBackups(context.api, gameId);
    });
  });

  return true;
}

export default init;

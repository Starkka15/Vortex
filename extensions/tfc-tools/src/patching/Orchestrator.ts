import * as fs from "fs";
import * as path from "path";
import {
  ModInstance, ModComponentContent,
  discoverMod, loadComponentMapping,
} from "../core/mod/ModInstance";
import { GameProfile, PackageFolder } from "../core/gameprofile/GameProfile";
import { FTextureEntry } from "../core/mapping/FTextureEntry";
import { updatePackageTextures, findPackageFiles, PackageUpdateResult } from "./TextureUpdater";
import { copyTFCFiles, TFCCopyResult } from "./TFCCopyManager";
import { patchTOC, TOCEntry } from "./TOCPatcher";
import { patchGameExe } from "./GameExePatcher";
import { patchIniFile, parsePatchFile } from "./IniPatcher";
import { BackupManager, BackupSession } from "./BackupManager";
import { updateBulkContent } from "../core/bulkcontent/BulkContentInstaller";

/**
 * Progress callback for the installation orchestrator.
 */
export type InstallProgress = (info: {
  phase: string;
  message: string;
  current: number;
  total: number;
}) => void;

/**
 * Result of a full mod installation.
 */
export interface InstallResult {
  /** Total textures updated across all packages */
  texturesUpdated: number;
  /** Total packages modified */
  packagesModified: number;
  /** Names of updated textures */
  updatedTextureNames: string[];
  /** TFC files copied to the game directory */
  copiedTfcFiles: string[];
  /** TOC was patched */
  tocPatched: boolean;
  /** Game EXE was patched (hash check bypass) */
  exePatched: boolean;
  /** INI files patched */
  iniFilesPatched: number;
  /** Errors encountered (non-fatal) */
  errors: { file: string; message: string }[];
}

/**
 * Resolve a PackageFolder to an absolute directory path.
 */
function resolvePackageDir(gameDir: string, folder: PackageFolder): string {
  // PackageFolder path uses backslashes (Windows convention), normalize
  const relPath = folder.path.replace(/\\/g, "/");
  return path.join(gameDir, relPath);
}

/**
 * Resolve the TFC destination directory for a PackageFolder.
 * Uses customTfcPath if set, otherwise the package folder itself.
 */
function resolveTfcDestDir(
  gameDir: string,
  folder: PackageFolder,
): string {
  const tfcPath = folder.customTfcPath ?? folder.tfcPath ?? folder.path;
  return path.join(gameDir, tfcPath.replace(/\\/g, "/"));
}

/**
 * Find all package files across all PackageFolders for a component.
 */
function findComponentPackages(
  gameDir: string,
  folders: PackageFolder[],
  excludedFiles: string[],
): string[] {
  const allFiles: string[] = [];
  const excludeSet = new Set(excludedFiles.map(f => f.toLowerCase()));

  for (const folder of folders) {
    const dir = resolvePackageDir(gameDir, folder);
    if (!fs.existsSync(dir)) continue;

    const extensions = [".upk", ".u", ".xxx", ".bsm"];
    const files = findPackageFiles([dir], extensions);

    for (const file of files) {
      const baseName = path.basename(file).toLowerCase();
      if (!excludeSet.has(baseName)) {
        allFiles.push(file);
      }
    }
  }

  return allFiles;
}

/**
 * Install a TFC texture mod into a game directory.
 *
 * This is the main entry point for the complete installation pipeline.
 * It processes a mod directory containing GameProfile.xml, .TFCMapping,
 * and .tfc data files, applying texture replacements to the game's
 * UPK packages.
 *
 * @param modDir Path to the mod directory (containing GameProfile.xml)
 * @param gameDir Path to the game's root directory
 * @param progress Optional progress callback
 * @returns Installation result
 */
export function installTextureMod(
  modDir: string,
  gameDir: string,
  progress?: InstallProgress,
  gameId?: string,
): InstallResult {
  const result: InstallResult = {
    texturesUpdated: 0,
    packagesModified: 0,
    updatedTextureNames: [],
    copiedTfcFiles: [],
    tocPatched: false,
    exePatched: false,
    iniFilesPatched: 0,
    errors: [],
  };

  // 1. Discover mod structure
  progress?.({ phase: "init", message: "Loading mod structure...", current: 0, total: 0 });
  const mod = discoverMod(modDir, gameId);
  const profile = mod.gameProfile;

  // 2. Create backup session
  progress?.({ phase: "backup", message: "Preparing backup...", current: 0, total: 0 });
  const backupMgr = new BackupManager(gameDir);
  const backup = backupMgr.createBackup(mod.name);

  // 3. Process main game component
  if (mod.mainGame?.mappingFilePath) {
    processComponent(
      mod, mod.mainGame, gameDir, profile.packageFolders,
      profile, result, backup, progress,
    );
  }

  // 4. Process DLC components
  for (const dlc of mod.dlcs) {
    if (dlc.mappingFilePath && dlc.dlcProfile) {
      processComponent(
        mod, dlc, gameDir, dlc.dlcProfile.packageFolders,
        profile, result, backup, progress,
      );
    }
  }

  // 5. Patch TOC file
  if (profile.tocFilePath && result.packagesModified > 0) {
    progress?.({ phase: "toc", message: "Updating TOC...", current: 0, total: 1 });
    const tocPath = path.join(gameDir, profile.tocFilePath.replace(/\\/g, "/"));
    if (fs.existsSync(tocPath)) {
      try {
        backup.backupFile(tocPath);
        const tocEntries: TOCEntry[] = [];
        for (const tfcFile of result.copiedTfcFiles) {
          const relPath = path.relative(gameDir, tfcFile)
            .replace(/\//g, "\\").toLowerCase();
          tocEntries.push({
            relativePath: relPath,
            filePath: tfcFile,
            mustAdd: true,
          });
        }
        if (tocEntries.length > 0) {
          result.tocPatched = patchTOC(tocPath, tocEntries);
        }
      } catch (err: any) {
        result.errors.push({ file: tocPath, message: err.message });
      }
    }
  }

  // 6. Patch game EXE (hash check bypass)
  if (profile.hasHashCheck && profile.gameExeFilePath) {
    progress?.({ phase: "exe", message: "Patching game executable...", current: 0, total: 1 });
    const exePath = path.join(gameDir, profile.gameExeFilePath.replace(/\\/g, "/"));
    if (fs.existsSync(exePath)) {
      try {
        backup.backupFile(exePath);
        const patched = patchGameExe(exePath, gameDir);
        result.exePatched = patched.length > 0;
      } catch (err: any) {
        result.errors.push({ file: exePath, message: err.message });
      }
    }
  }

  // 7. Apply INI patches
  const iniPatchFiles = findIniPatches(modDir);
  if (iniPatchFiles.length > 0) {
    progress?.({ phase: "ini", message: "Applying INI patches...", current: 0, total: iniPatchFiles.length });
    for (let i = 0; i < iniPatchFiles.length; i++) {
      progress?.({ phase: "ini", message: `Patching ${path.basename(iniPatchFiles[i])}`, current: i + 1, total: iniPatchFiles.length });
      try {
        const patchFile = iniPatchFiles[i];
        const targetName = path.basename(patchFile).replace(/\.patch$/i, "");
        const targetPath = path.join(gameDir, targetName);
        if (fs.existsSync(targetPath)) {
          backup.backupFile(targetPath);
          const patchContent = fs.readFileSync(patchFile, "utf-8");
          const sections = parsePatchFile(patchContent);
          patchIniFile(targetPath, sections);
          result.iniFilesPatched++;
        }
      } catch (err: any) {
        result.errors.push({ file: iniPatchFiles[i], message: err.message });
      }
    }
  }

  // 8. Commit backup
  backup.commit();

  return result;
}

/**
 * Process a single mod component (main game or DLC).
 */
function processComponent(
  mod: ModInstance,
  component: ModComponentContent,
  gameDir: string,
  packageFolders: PackageFolder[],
  profile: GameProfile,
  result: InstallResult,
  backup: BackupSession,
  progress?: InstallProgress,
): void {
  // Load mapping data
  progress?.({ phase: "mapping", message: "Loading texture mapping...", current: 0, total: 0 });
  const mappingData = loadComponentMapping(component);
  const entries = mappingData.entries;

  if (entries.length === 0) return;

  // Copy TFC files from mod to game
  progress?.({ phase: "tfc", message: "Copying TFC archives...", current: 0, total: 0 });
  for (const folder of packageFolders) {
    const destDir = resolveTfcDestDir(gameDir, folder);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Group TFC files by base name and copy each group
    const tfcGroups = groupTfcFilesByName(mod.tfcFiles);
    for (const [tfcName, tfcIndices] of tfcGroups) {
      if (tfcIndices.length === 0) continue;
      const minIdx = Math.min(...tfcIndices);
      const maxIdx = Math.max(...tfcIndices);
      try {
        const copyResult = copyTFCFiles(
          mod.modDir, destDir, tfcName, minIdx, maxIdx,
          profile.tfcExtension,
        );
        result.copiedTfcFiles.push(...copyResult.copiedFiles);
      } catch (err: any) {
        result.errors.push({ file: `${tfcName}.tfc`, message: err.message });
      }
    }
  }

  // BulkContent path (BioShock 1/2): update .blk storage files via BDC catalogs
  if (mappingData.hasBulkContent) {
    progress?.({ phase: "bulkcontent", message: "Updating BulkContent storage...", current: 0, total: 0 });

    for (const folder of packageFolders) {
      const tfcPath = folder.tfcPath ?? folder.path;
      const bulkContentDir = path.join(gameDir, tfcPath.replace(/\\/g, "/"));

      if (!fs.existsSync(bulkContentDir)) continue;

      try {
        const bcResult = updateBulkContent(
          bulkContentDir, mod.modDir, entries, profile.tfcExtension,
          (filePath) => backup.backupFile(filePath),
        );
        result.texturesUpdated += bcResult.texturesApplied;
        result.packagesModified += bcResult.chunksUpdated;
      } catch (err: any) {
        result.errors.push({ file: bulkContentDir, message: err.message });
      }
    }
  }

  // Standard path: patch UPK/XXX package files directly
  // Skip if BulkContent path was used — BioShock textures are in .blk files, not UPK exports
  if (mappingData.hasBulkContent) return;

  const packageFiles = findComponentPackages(
    gameDir, packageFolders, profile.excludedFiles,
  );

  if (packageFiles.length === 0) return;

  // Process each package
  for (let i = 0; i < packageFiles.length; i++) {
    const pkgPath = packageFiles[i];
    progress?.({
      phase: "packages",
      message: `Updating ${path.basename(pkgPath)} (${i + 1}/${packageFiles.length})`,
      current: i + 1,
      total: packageFiles.length,
    });

    try {
      // Backup original before modification
      backup.backupFile(pkgPath);

      const updateResult = updatePackageTextures(
        pkgPath, entries, pkgPath, mod.modDir,
      );

      if (updateResult) {
        result.texturesUpdated += updateResult.texturesUpdated;
        result.packagesModified++;
        result.updatedTextureNames.push(...updateResult.updatedTextureNames);
      }
    } catch (err: any) {
      result.errors.push({ file: pkgPath, message: err.message });
    }
  }
}

/**
 * Group TFC files by their base name.
 * E.g., ["Textures_0.tfc", "Textures_1.tfc", "LocalMips_0.tfc"]
 * → Map { "Textures" → [0, 1], "LocalMips" → [0] }
 */
function groupTfcFilesByName(
  tfcFiles: string[],
): Map<string, number[]> {
  const groups = new Map<string, number[]>();

  for (const filePath of tfcFiles) {
    const fileName = path.basename(filePath, path.extname(filePath));
    // Parse "Name_Index" pattern
    const match = fileName.match(/^(.+?)_(\d+)$/);
    if (match) {
      const baseName = match[1];
      const index = parseInt(match[2], 10);
      if (!groups.has(baseName)) {
        groups.set(baseName, []);
      }
      groups.get(baseName)!.push(index);
    }
  }

  return groups;
}

/**
 * Find INI patch files in a mod directory.
 */
function findIniPatches(modDir: string): string[] {
  const patches: string[] = [];
  try {
    for (const entry of fs.readdirSync(modDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".patch")) {
        patches.push(path.join(modDir, entry.name));
      }
    }
  } catch {
    // Ignore
  }
  return patches;
}

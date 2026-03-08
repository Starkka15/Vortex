import * as fs from "fs";
import * as path from "path";
import { GameProfile, DLCProfile, readGameProfile, parseGameProfileXml } from "../gameprofile";
import { getDefaultProfileXml } from "../gameprofile/DefaultProfiles";
import { MappingFileData, readMappingFile } from "../mapping";

/**
 * Discovered mod content for a game component (base game or DLC).
 */
export interface ModComponentContent {
  /** Whether this is a DLC component */
  isDlc: boolean;
  /** DLC profile (if isDlc) */
  dlcProfile?: DLCProfile;
  /** Path to the .TFCMapping file for this component */
  mappingFilePath: string | null;
  /** Parsed mapping data (loaded lazily) */
  mappingData?: MappingFileData;
}

/**
 * Represents a discovered TFC mod instance from a directory.
 */
export interface ModInstance {
  /** Mod name (directory name) */
  name: string;
  /** Root directory of the mod */
  modDir: string;
  /** Parsed game profile */
  gameProfile: GameProfile;
  /** Path to GameProfile.xml */
  gameProfilePath: string;
  /** Path to IdRemappings file (if present) */
  idRemappingsPath: string | null;
  /** Path to ObjectDescriptors file (if present) */
  objectDescriptorsPath: string | null;
  /** Path to PackageExtensions file (if present) */
  packageExtensionsPath: string | null;
  /** All .TFCMapping files found */
  mappingFiles: string[];
  /** All .tfc data files found */
  tfcFiles: string[];
  /** All .PackagePatch files found */
  packagePatchFiles: string[];
  /** Base game component */
  mainGame: ModComponentContent | null;
  /** DLC components */
  dlcs: ModComponentContent[];
}

/**
 * Discover a TFC mod from a directory path.
 * Finds GameProfile.xml, mapping files, TFC data files, etc.
 *
 * @param modDir Path to the mod directory
 * @param gameId Optional Vortex game ID — used to load a built-in profile
 *               when the mod doesn't include its own GameProfile.xml.
 */
export function discoverMod(modDir: string, gameId?: string): ModInstance {
  const entries = fs.readdirSync(modDir, { withFileTypes: true });
  const files = entries.filter(e => e.isFile()).map(e => e.name);

  // Find GameProfile.xml (mod-provided or built-in fallback)
  const gameProfileName = files.find(
    f => f.toLowerCase() === "gameprofile.xml"
  );

  let gameProfilePath: string;
  let gameProfile: GameProfile;

  if (gameProfileName) {
    gameProfilePath = path.join(modDir, gameProfileName);
    gameProfile = readGameProfile(gameProfilePath);
  } else if (gameId) {
    const defaultXml = getDefaultProfileXml(gameId);
    if (!defaultXml) {
      throw new Error(`No GameProfile.xml found in ${modDir} and no built-in profile for game "${gameId}"`);
    }
    gameProfilePath = "(built-in)";
    gameProfile = parseGameProfileXml(defaultXml);
  } else {
    throw new Error(`No GameProfile.xml found in ${modDir}`);
  }

  // Find IdRemappings
  const idRemappingsName = files.find(
    f => f.toLowerCase() === "gameprofile.idremappings.xml"
  );
  const idRemappingsPath = idRemappingsName
    ? path.join(modDir, idRemappingsName)
    : null;

  // Find ObjectDescriptors (.xml or binary)
  const objDescName = files.find(
    f => f.toLowerCase() === "objectdescriptors.xml"
      || f.toLowerCase() === "objectdescriptors.bin"
  );
  const objectDescriptorsPath = objDescName
    ? path.join(modDir, objDescName)
    : null;

  // Find PackageExtensions.xml
  const pkgExtName = files.find(
    f => f.toLowerCase() === "packageextensions.xml"
  );
  const packageExtensionsPath = pkgExtName
    ? path.join(modDir, pkgExtName)
    : null;

  // Find .TFCMapping files (in root or TexturePack/ subfolder)
  let mappingFiles = files
    .filter(f => f.toLowerCase().endsWith(".tfcmapping"))
    .map(f => path.join(modDir, f));

  if (mappingFiles.length === 0) {
    const texPackDir = path.join(modDir, "TexturePack");
    if (fs.existsSync(texPackDir)) {
      mappingFiles = fs.readdirSync(texPackDir)
        .filter(f => f.toLowerCase().endsWith(".tfcmapping"))
        .map(f => path.join(texPackDir, f));
    }
  }

  // Find .tfc data files
  const tfcFiles = files
    .filter(f => f.toLowerCase().endsWith(".tfc"))
    .map(f => path.join(modDir, f));

  // Find .PackagePatch files (in root or Game/ subfolder)
  let packagePatchFiles = files
    .filter(f => f.toLowerCase().endsWith(".packagepatch"))
    .map(f => path.join(modDir, f));

  if (packagePatchFiles.length === 0) {
    const gameDir = path.join(modDir, "Game");
    if (fs.existsSync(gameDir)) {
      packagePatchFiles = findFilesRecursive(gameDir, ".packagepatch");
    }
  }

  // Build main game component
  const mainMappingName = gameProfile.tfcMappingFileName
    ? `${gameProfile.tfcMappingFileName}.TFCMapping`
    : null;
  const mainMappingPath = mainMappingName
    ? mappingFiles.find(f => path.basename(f).toLowerCase() === mainMappingName.toLowerCase()) ?? null
    : null;

  const mainGame: ModComponentContent | null = mainMappingPath
    ? { isDlc: false, mappingFilePath: mainMappingPath }
    : null;

  // Build DLC components
  const dlcs: ModComponentContent[] = [];
  for (const dlc of gameProfile.dlcs) {
    const dlcMappingName = `${dlc.tfcMappingFileName}.TFCMapping`;
    const dlcMappingPath = mappingFiles.find(
      f => path.basename(f).toLowerCase() === dlcMappingName.toLowerCase()
    ) ?? null;

    if (dlcMappingPath) {
      dlcs.push({
        isDlc: true,
        dlcProfile: dlc,
        mappingFilePath: dlcMappingPath,
      });
    }
  }

  return {
    name: path.basename(modDir),
    modDir,
    gameProfile,
    gameProfilePath,
    idRemappingsPath,
    objectDescriptorsPath,
    packageExtensionsPath,
    mappingFiles,
    tfcFiles,
    packagePatchFiles,
    mainGame,
    dlcs,
  };
}

/**
 * Load the mapping data for a component (lazy — call when needed).
 */
export function loadComponentMapping(component: ModComponentContent): MappingFileData {
  if (component.mappingData) return component.mappingData;
  if (!component.mappingFilePath) {
    throw new Error("No mapping file for this component");
  }
  component.mappingData = readMappingFile(component.mappingFilePath);
  return component.mappingData;
}

/**
 * Check if a directory looks like a TFC mod (has GameProfile.xml or .TFCMapping files).
 */
export function isTfcMod(dirPath: string): boolean {
  try {
    const files = fs.readdirSync(dirPath);
    return files.some(
      f => f.toLowerCase() === "gameprofile.xml"
        || f.toLowerCase().endsWith(".tfcmapping")
    );
  } catch {
    return false;
  }
}

function findFilesRecursive(dir: string, ext: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursive(full, ext));
    } else if (entry.name.toLowerCase().endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

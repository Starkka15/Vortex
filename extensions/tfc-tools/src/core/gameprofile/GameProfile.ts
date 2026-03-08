import * as fs from "fs";
import { XMLParser } from "fast-xml-parser";
import { PackageRecompression, Platform } from "../types";

/**
 * A folder containing UPK packages within the game directory.
 */
export interface PackageFolder {
  /** Relative path from game root to the package folder */
  path: string;
  /** Relative path to the TFC file folder (if separate from packages) */
  tfcPath?: string;
  /** Secondary TFC path */
  tfcPath2?: string;
  /** Path for custom (mod) TFC files */
  customTfcPath?: string;
  /** Starting index for custom TFC files in this folder */
  customTfcStartIndex: number;
  /** Whether to recursively search subdirectories */
  includeSubDirectories: boolean;
  /** Folders to exclude from recursive search */
  excludedFolders: string[];
}

/**
 * DLC configuration within a game profile.
 */
export interface DLCProfile {
  /** Display name of the DLC */
  displayName: string;
  /** Name of the .TFCMapping file for this DLC */
  tfcMappingFileName: string;
  /** Package folders for this DLC */
  packageFolders: PackageFolder[];
}

/**
 * Parsed GameProfile.xml — describes how a game's packages and textures are organized.
 * Shipped with each TFC mod to tell the installer how to process it.
 */
export interface GameProfile {
  /** Optional game identifier for disambiguation */
  gameId?: string;
  /** UPK file version */
  packageFileVersion: number;
  /** UPK licensee version */
  packageLicenseeVersion: number;
  /** Display name of the game */
  displayName?: string;
  /** Name of the .TFCMapping file */
  tfcMappingFileName?: string;
  /** Target platform */
  platform: Platform;
  /** Default TFC file name */
  defaultTfc?: string;
  /** TFC file extension (default: ".tfc") */
  tfcExtension: string;

  // Feature flags
  enableCustomTfcs: boolean;
  enableTfcNamePropertyCleanup: boolean;
  removeLodBias: boolean;
  removeLodGroup: boolean;
  hasHashCheck: boolean;
  enableObjectDataShift: boolean;
  enableExpandTables: boolean;
  updateUiTextureSizeProperties: boolean;
  enableNewCompressedChunks: boolean;
  enableUpdateStats: boolean;
  packageRecompression: PackageRecompression;
  deleteUcsFiles: boolean;
  optimizePackageSpace: boolean;

  /** Path to game exe (for hash check patching) */
  gameExeFilePath?: string;
  /** Path to TOC file */
  tocFilePath?: string;

  /** Package folders in the base game */
  packageFolders: PackageFolder[];
  /** DLC configurations */
  dlcs: DLCProfile[];
  /** Files to exclude from processing */
  excludedFiles: string[];
}

const RECURSIVE_SUFFIX = "\\*";

function parseBool(value: any, defaultValue: boolean = false): boolean {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
}

function parsePlatform(value: string | undefined): Platform {
  if (!value) return Platform.PC;
  const lower = value.toLowerCase();
  for (const p of Object.values(Platform)) {
    if (p.toLowerCase() === lower) return p;
  }
  return Platform.PC;
}

function parsePackageRecompression(value: any): PackageRecompression {
  if (value === undefined || value === null) return PackageRecompression.All;
  const num = Number(value);
  if (!isNaN(num)) return num;
  const str = String(value).toLowerCase();
  if (str === "none") return PackageRecompression.None;
  if (str === "partial") return PackageRecompression.Partial;
  return PackageRecompression.All;
}

function parsePackageFolder(raw: any): PackageFolder {
  const rawPath = String(raw["@_path"] ?? "");
  const includeSubDirectories = rawPath.endsWith(RECURSIVE_SUFFIX);
  const path = includeSubDirectories
    ? rawPath.slice(0, -RECURSIVE_SUFFIX.length)
    : rawPath;

  return {
    path,
    tfcPath: raw["@_TFCpath"] ?? undefined,
    tfcPath2: raw["@_TFCpath2"] ?? undefined,
    customTfcPath: raw["@_customTFCpath"] ?? undefined,
    customTfcStartIndex: Number(raw["@_customTFCStartIndex"] ?? 0),
    includeSubDirectories,
    excludedFolders: ensureArray(raw["ExcludedFolder"]),
  };
}

function parseDLC(raw: any): DLCProfile {
  return {
    displayName: raw["@_displayName"] ?? raw["@_TFCMappingFileName"] ?? "",
    tfcMappingFileName: raw["@_TFCMappingFileName"] ?? "",
    packageFolders: ensureArray(raw?.PackageFolders?.PackageFolder).map(parsePackageFolder),
  };
}

function ensureArray(value: any): any[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Parse a GameProfile.xml file.
 */
export function readGameProfile(filePath: string): GameProfile {
  const xml = fs.readFileSync(filePath, "utf-8");
  return parseGameProfileXml(xml);
}

/**
 * Parse GameProfile XML string.
 */
export function parseGameProfileXml(xml: string): GameProfile {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
    parseAttributeValue: false, // keep as strings for explicit parsing
  });

  const doc = parser.parse(xml);
  const gp = doc.GameProfile;
  if (!gp) {
    throw new Error("Invalid GameProfile.xml: missing <GameProfile> root element");
  }

  const packageFolders = ensureArray(gp.PackageFolders?.PackageFolder).map(parsePackageFolder);
  const dlcs = ensureArray(gp.DLCs?.DLC).map(parseDLC);
  const excludedFiles = ensureArray(gp.ExcludedFile);

  return {
    gameId: gp["@_gameId"] ?? undefined,
    packageFileVersion: Number(gp["@_packageFileVersion"]),
    packageLicenseeVersion: Number(gp["@_packageLicenseeVersion"]),
    displayName: gp["@_displayName"] ?? undefined,
    tfcMappingFileName: gp["@_TFCMappingFileName"] ?? undefined,
    platform: parsePlatform(gp["@_platform"]),
    defaultTfc: gp["@_defaultTFC"] ?? undefined,
    tfcExtension: gp["@_tfcExtension"] ?? ".tfc",

    enableCustomTfcs: parseBool(gp["@_enableCustomTFCs"], true),
    enableTfcNamePropertyCleanup: parseBool(gp["@_enableTFCNamePropertyCleanup"], true),
    removeLodBias: parseBool(gp["@_removeLODBias"]),
    removeLodGroup: parseBool(gp["@_removeLODGroup"]),
    hasHashCheck: parseBool(gp["@_hasHashCheck"]),
    enableObjectDataShift: parseBool(gp["@_enableObjectDataShift"]),
    enableExpandTables: parseBool(gp["@_enableExpandTables"], true),
    updateUiTextureSizeProperties: parseBool(gp["@_updateUITextureSizeProperties"]),
    enableNewCompressedChunks: parseBool(gp["@_enableNewCompressedChunks"], true),
    enableUpdateStats: parseBool(gp["@_enableUpdateStats"], true),
    packageRecompression: parsePackageRecompression(gp["@_packageRecompression"]),
    deleteUcsFiles: parseBool(gp["@_deleteUCSFiles"]),
    optimizePackageSpace: parseBool(gp["@_optimizePackageSpace"]),

    gameExeFilePath: gp["@_gameExeFilePath"] ?? undefined,
    tocFilePath: gp["@_TOCFilePath"] ?? undefined,

    packageFolders,
    dlcs,
    excludedFiles,
  };
}

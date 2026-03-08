import { PackageId } from "./PackageId";

/**
 * Profile flags controlling how a UPK package is parsed.
 * Different games use different subsets of fields in the UPK format.
 * Instead of the C# approach (25+ sub-profile classes with inheritance),
 * we use a flat config built per-game from the PackageId.
 */
export interface PackageProfile {
  packageId: PackageId;
  fileVersion: number;
  isUnreal2: boolean;
  hasBulkContent: boolean;

  object: ObjectProfile;
  summary: SummaryProfile;
  nameEntry: NameEntryProfile;
  objectExport: ObjectExportProfile;
  objectImport: ObjectImportProfile;
  texture2D: Texture2DProfile;
  byteBulkData: FByteBulkDataProfile;
  mipMap: FTexture2DMipMapProfile;
}

export interface ObjectProfile {
  hasNetIndex: boolean;
  hasFObjectHeader: boolean;
  /** If true, BoolProperty value is stored as 1 byte after the tag (dataSize=0) */
  isBoolPropertyStoredAsByte: boolean;
  /** If true, ByteProperty stores enum type + value UNameIndex (16 bytes total) */
  isBytePropertyUsedForEnum: boolean;
}

export interface SummaryProfile {
  unknownBytesAfterLicenseeVersion: number;
  hasHeaderSize: boolean;
  hasPackageGroup: boolean;
  hasDependsOffset: boolean;
  hasSerializedOffset: boolean;
  hasSerializedOffset64: boolean;
  unknownBytesAfterSerializedOffset: number;
  hasUnknownInt32BeforeGuid: boolean;
  hasGuid: boolean;
  hasGenerations: boolean;
  hasGenerationsGuid: boolean;
  unknownBytesAfterGenerations: number;
  hasEngineVersion: boolean;
  hasCookerVersion: boolean;
  hasCompressionFlagsAndChunks: boolean;
  zlibCompressionPackageFlag: number;
}

export interface NameEntryProfile {
  hasFlags: boolean;
  has64BitFlags: boolean;
  isNameEndedWithZero: boolean;
  /** UE2: FString length uses FCompactIndex instead of int32 */
  usesCompactIndex: boolean;
}

export interface ObjectExportProfile {
  hasArchetypeReference: boolean;
  unknownBytesAfterArchetypeReference: number;
  hasObjectFlags64: boolean;
  hasComponentMap: boolean;
  hasExportFlags: boolean;
  hasExportFlags2: boolean;
  hasExportFlags2AsByte: boolean;
  unknownBytesAfterGuid: number;
  hasLegacySerialOffset: boolean;
  unknownBytesAfterSerialOffset: number;
  hasNetObjectCount: boolean;
  hasGuid: boolean;
  hasGuidAfterFlags: boolean;
  hasUnknownInt32BeforeObjectName: boolean;
  hasMainPackageName: boolean;
  hasSerialDataOffset64: boolean;
  hasUnknownInt32IfExportFlag8: boolean;
}

export interface ObjectImportProfile {
  hasUnknownGuidAfterObjectName: boolean;
  hasTypeAndPackageShortNamesAfterName: boolean;
}

export interface Texture2DProfile {
  hasSourceArt: boolean;
  hasSourceArt2: boolean;
  hasSourceFilePath: boolean;
  hasTFCguid: boolean;
  hasSizeAndFormatAsProperties: boolean;
  hasObjectHeader: boolean;
  hasCachedPVRTCMips: boolean;
  hasCachedFlashMips: boolean;
  hasCachedETCMips: boolean;
  unknownBytesAfterSourceArt: number;
  unknownBytesAfterMipmaps: number;
  hasUnknownIntArrayBeforeMipmaps: boolean;
  mustPreserveLowerResMips: boolean;
}

export interface FByteBulkDataProfile {
  hasFlags: boolean;
  hasSizeOffsetOnDisk: boolean;
  hasDiskDataOffset64: boolean;
  hasDiskDataSize64: boolean;
  hasBulkDataKey: boolean;
}

export interface FTexture2DMipMapProfile {
  hasObjectHeader: boolean;
  hasX360GammaData: boolean;
  hasUnknownInt64: boolean;
  hasIndex: boolean;
  hasByteArray: boolean;
}

/**
 * Build a PackageProfile from version info and PackageId.
 * Combines the logic from the C# PackageSummaryProfile, FNameEntryProfile,
 * FObjectExportProfile, and FObjectImportProfile constructors.
 */
export function createPackageProfile(
  packageId: PackageId,
  fileVersion: number,
): PackageProfile {
  const isUnreal2 = fileVersion <= 200;

  // --- Object profile defaults ---
  const object: ObjectProfile = {
    hasNetIndex: fileVersion >= 322,
    hasFObjectHeader: false,
    isBoolPropertyStoredAsByte: fileVersion >= 673,
    isBytePropertyUsedForEnum: fileVersion >= 633,
  };

  // --- Summary defaults based on file version ---
  const summary: SummaryProfile = {
    unknownBytesAfterLicenseeVersion: 0,
    hasHeaderSize: fileVersion >= 249,
    hasPackageGroup: fileVersion >= 269,
    hasDependsOffset: fileVersion >= 415,
    hasSerializedOffset: fileVersion >= 623,
    hasSerializedOffset64: false,
    unknownBytesAfterSerializedOffset: fileVersion >= 623 ? 8 : 0,
    hasUnknownInt32BeforeGuid: fileVersion >= 584,
    hasGuid: true,
    hasGenerations: !isUnreal2,
    hasGenerationsGuid: false,
    unknownBytesAfterGenerations: 0,
    hasEngineVersion: fileVersion >= 245,
    hasCookerVersion: fileVersion >= 277,
    hasCompressionFlagsAndChunks: fileVersion >= 334,
    zlibCompressionPackageFlag: 0,
  };

  // --- Name entry defaults ---
  const nameEntry: NameEntryProfile = {
    hasFlags: true,
    has64BitFlags: fileVersion >= 195,
    isNameEndedWithZero: true,
    usesCompactIndex: isUnreal2,
  };

  // --- Object export defaults ---
  const objectExport: ObjectExportProfile = {
    hasArchetypeReference: fileVersion >= 220,
    unknownBytesAfterArchetypeReference: 0,
    hasObjectFlags64: fileVersion >= 195,
    hasComponentMap: !isUnreal2 && fileVersion < 543,
    hasExportFlags: fileVersion >= 247,
    hasExportFlags2: false,
    hasExportFlags2AsByte: false,
    unknownBytesAfterGuid: fileVersion >= 475 ? 4 : 0,
    hasLegacySerialOffset: fileVersion < 249,
    unknownBytesAfterSerialOffset: 0,
    hasNetObjectCount: fileVersion >= 322,
    hasGuid: fileVersion >= 322,
    hasGuidAfterFlags: false,
    hasUnknownInt32BeforeObjectName: false,
    hasMainPackageName: false,
    hasSerialDataOffset64: false,
    hasUnknownInt32IfExportFlag8: false,
  };

  // --- Object import defaults ---
  const objectImport: ObjectImportProfile = {
    hasUnknownGuidAfterObjectName: false,
    hasTypeAndPackageShortNamesAfterName: false,
  };

  // --- Texture2D defaults ---
  const texture2D: Texture2DProfile = {
    hasSourceArt: !isUnreal2,
    hasSourceArt2: false,
    hasSourceFilePath: false,
    hasTFCguid: fileVersion >= 567,
    hasSizeAndFormatAsProperties: isUnreal2 || fileVersion >= 297,
    hasObjectHeader: false,
    hasCachedPVRTCMips: fileVersion >= 674,
    hasCachedFlashMips: fileVersion >= 857,
    hasCachedETCMips: fileVersion >= 864,
    unknownBytesAfterSourceArt: 0,
    unknownBytesAfterMipmaps: 0,
    hasUnknownIntArrayBeforeMipmaps: false,
    mustPreserveLowerResMips: false,
  };

  // --- FByteBulkData defaults ---
  const byteBulkData: FByteBulkDataProfile = {
    hasFlags: fileVersion >= 266,
    hasSizeOffsetOnDisk: fileVersion >= 266,
    hasDiskDataOffset64: false,
    hasDiskDataSize64: false,
    hasBulkDataKey: false,
  };

  // --- FTexture2DMipMap defaults ---
  const mipMap: FTexture2DMipMapProfile = {
    hasObjectHeader: false,
    hasX360GammaData: false,
    hasUnknownInt64: false,
    hasIndex: false,
    hasByteArray: isUnreal2,
  };

  let hasBulkContent = false;

  // --- Per-game overrides ---
  switch (packageId) {
    // BioShock 1 / 1 Remastered / 2
    case PackageId.Bioshock1_V141_L56:
    case PackageId.Bioshock1Remastered_V142_L56:
    case PackageId.Bioshock2_V141_L57:
    case PackageId.Bioshock2_V143_L59:
      hasBulkContent = true;
      summary.zlibCompressionPackageFlag = 0x20000;
      summary.hasGenerations = true;
      nameEntry.has64BitFlags = true;
      objectExport.hasUnknownInt32BeforeObjectName = true;
      objectExport.hasObjectFlags64 = true;
      objectExport.unknownBytesAfterSerialOffset = 4;
      object.hasFObjectHeader = true;
      texture2D.hasObjectHeader = true;
      texture2D.mustPreserveLowerResMips = true;
      if (packageId === PackageId.Bioshock1_V141_L56 ||
          packageId === PackageId.Bioshock1Remastered_V142_L56) {
        texture2D.mustPreserveLowerResMips = true;
      }
      mipMap.hasObjectHeader = true;
      break;

    // BioShock Infinite (V727.L69)
    case PackageId.Bioshock3_V727_L69:
      summary.unknownBytesAfterLicenseeVersion = 4;
      summary.hasSerializedOffset = true;
      summary.unknownBytesAfterSerializedOffset = 8;
      summary.hasUnknownInt32BeforeGuid = true;
      objectExport.hasExportFlags2 = true;
      texture2D.hasSourceArt = false;
      texture2D.hasTFCguid = false;
      texture2D.hasCachedPVRTCMips = false;
      texture2D.hasCachedFlashMips = false;
      texture2D.hasCachedETCMips = false;
      break;

    // BioShock Infinite (V727.L73/75/78)
    case PackageId.Bioshock3_V727_L73:
    case PackageId.Bioshock3_V727_L75:
    case PackageId.Bioshock3_V727_L78:
      summary.unknownBytesAfterLicenseeVersion = 4;
      summary.hasSerializedOffset = false;
      summary.unknownBytesAfterSerializedOffset = 0;
      summary.hasUnknownInt32BeforeGuid = true;
      objectExport.hasExportFlags2 = true;
      texture2D.hasSourceArt = false;
      texture2D.hasTFCguid = false;
      texture2D.hasCachedPVRTCMips = false;
      texture2D.hasCachedFlashMips = false;
      texture2D.hasCachedETCMips = false;
      break;

    // Dishonored — uses all defaults for V801
    case PackageId.Dishonored_V801_L30:
    case PackageId.DishonoredPS4_V804_L42:
      break;

    // XCOM
    case PackageId.XCom_EnemyUnknown_V845_L59:
    case PackageId.XCom_EnemyUnknown_V845_L64:
      break;

    // A Hat In Time
    case PackageId.AHatInTime_V877_L5:
    case PackageId.AHatInTime_V881_L5:
    case PackageId.AHatInTime_V882_L5:
    case PackageId.AHatInTime_V884_L5:
    case PackageId.AHatInTime_V885_L5:
    case PackageId.AHatInTime_V888_L5:
    case PackageId.AHatInTime_V889_L5:
    case PackageId.AHatInTime_V893_L5:
      break;

    // Batman
    case PackageId.Batman_V576_L21:
      break;
    case PackageId.Batman2ArkhamCity_V805_L101:
    case PackageId.Batman2ArkhamCity_V805_L102:
    case PackageId.Batman3_V806_L138:
    case PackageId.Batman3ArkhamOrigins_V807_L138:
      objectExport.unknownBytesAfterArchetypeReference = 4;
      break;

    // Borderlands
    case PackageId.Borderlands_V584_L57:
    case PackageId.Borderlands_V584_L58:
    case PackageId.Borderlands_V595_L58:
    case PackageId.BorderlandsGOTY_V594_L58_OverrideV584:
    case PackageId.Borderlands2_V832_L46:
    case PackageId.BorderlandsTheHandSomeCollection_V884_L46:
    case PackageId.BorderlandsPreSequel:
      break;

    // Spec Ops
    case PackageId.SpecOps_V737_L22:
    case PackageId.SpecOps_V740_L26:
      break;

    // Bulletstorm
    case PackageId.Bulletstorm_V742_L29:
    case PackageId.BulletstormFullClipEdition_V887_L41:
      break;

    // DmC
    case PackageId.DmC_V845_L4:
      break;

    // Remember Me
    case PackageId.RememberMe_V832_L21:
    case PackageId.RememberMe_V893_L21:
      break;

    // Generic fallback
    case PackageId.Generic:
    default:
      break;
  }

  return {
    packageId,
    fileVersion,
    isUnreal2,
    hasBulkContent,
    object,
    summary,
    nameEntry,
    objectExport,
    objectImport,
    texture2D,
    byteBulkData,
    mipMap,
  };
}

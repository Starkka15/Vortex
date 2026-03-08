/**
 * Package identifiers for games supported by TFC tools.
 * Mapped from (fileVersion, licenseeVersion) pairs in UPK headers.
 *
 * Only includes games that TFC Installer supports — not all 150+ UE3 games.
 */
export enum PackageId {
  Generic = "Generic",

  // BioShock 1
  Bioshock1_V141_L56 = "Bioshock1_V141_L56",
  Bioshock1Remastered_V142_L56 = "Bioshock1Remastered_V142_L56",

  // BioShock 2
  Bioshock2_V141_L57 = "Bioshock2_V141_L57",
  Bioshock2_V143_L59 = "Bioshock2_V143_L59",

  // BioShock Infinite
  Bioshock3_V727_L69 = "Bioshock3_V727_L69",
  Bioshock3_V727_L73 = "Bioshock3_V727_L73",
  Bioshock3_V727_L75 = "Bioshock3_V727_L75",
  Bioshock3_V727_L78 = "Bioshock3_V727_L78",

  // Dishonored
  Dishonored_V801_L30 = "Dishonored_V801_L30",
  DishonoredPS4_V804_L42 = "DishonoredPS4_V804_L42",

  // XCOM
  XCom_EnemyUnknown_V845_L59 = "XCom_EnemyUnknown_V845_L59",
  XCom_EnemyUnknown_V845_L64 = "XCom_EnemyUnknown_V845_L64",

  // A Hat In Time
  AHatInTime_V877_L5 = "AHatInTime_V877_L5",
  AHatInTime_V881_L5 = "AHatInTime_V881_L5",
  AHatInTime_V882_L5 = "AHatInTime_V882_L5",
  AHatInTime_V884_L5 = "AHatInTime_V884_L5",
  AHatInTime_V885_L5 = "AHatInTime_V885_L5",
  AHatInTime_V888_L5 = "AHatInTime_V888_L5",
  AHatInTime_V889_L5 = "AHatInTime_V889_L5",
  AHatInTime_V893_L5 = "AHatInTime_V893_L5",

  // Batman
  Batman_V576_L21 = "Batman_V576_L21",
  Batman2ArkhamCity_V805_L101 = "Batman2ArkhamCity_V805_L101",
  Batman2ArkhamCity_V805_L102 = "Batman2ArkhamCity_V805_L102",
  Batman3_V806_L138 = "Batman3_V806_L138",
  Batman3ArkhamOrigins_V807_L138 = "Batman3ArkhamOrigins_V807_L138",

  // Borderlands
  Borderlands_V584_L57 = "Borderlands_V584_L57",
  Borderlands_V584_L58 = "Borderlands_V584_L58",
  Borderlands_V595_L58 = "Borderlands_V595_L58",
  BorderlandsGOTY_V594_L58_OverrideV584 = "BorderlandsGOTY_V594_L58_OverrideV584",
  Borderlands2_V832_L46 = "Borderlands2_V832_L46",
  BorderlandsTheHandSomeCollection_V884_L46 = "BorderlandsTheHandSomeCollection_V884_L46",
  BorderlandsPreSequel = "BorderlandsPreSequel",

  // Spec Ops: The Line
  SpecOps_V737_L22 = "SpecOps_V737_L22",
  SpecOps_V740_L26 = "SpecOps_V740_L26",

  // Bulletstorm
  Bulletstorm_V742_L29 = "Bulletstorm_V742_L29",
  BulletstormFullClipEdition_V887_L41 = "BulletstormFullClipEdition_V887_L41",

  // DmC: Devil May Cry
  DmC_V845_L4 = "DmC_V845_L4",

  // Remember Me
  RememberMe_V832_L21 = "RememberMe_V832_L21",
  RememberMe_V893_L21 = "RememberMe_V893_L21",
}

/**
 * Special game ID overrides — for games that can't be identified by
 * (fileVersion, licenseeVersion) alone.
 */
const GAME_ID_OVERRIDES: Record<string, PackageId> = {
  BORPRESEQ: PackageId.BorderlandsPreSequel,
};

/**
 * Resolve a PackageId from file version and licensee version.
 * Optionally accepts a game-specific parserId for disambiguation.
 */
export function getPackageId(
  fileVersion: number,
  licenseeVersion: number,
  parserId?: string,
): PackageId {
  if (parserId && GAME_ID_OVERRIDES[parserId]) {
    return GAME_ID_OVERRIDES[parserId];
  }

  switch (fileVersion) {
    case 141:
      switch (licenseeVersion) {
        case 56: return PackageId.Bioshock1_V141_L56;
        case 57: return PackageId.Bioshock2_V141_L57;
      }
      break;
    case 142:
      if (licenseeVersion === 56) return PackageId.Bioshock1Remastered_V142_L56;
      break;
    case 143:
      if (licenseeVersion === 59) return PackageId.Bioshock2_V143_L59;
      break;
    case 576:
      if (licenseeVersion === 21) return PackageId.Batman_V576_L21;
      break;
    case 584:
      switch (licenseeVersion) {
        case 57: return PackageId.Borderlands_V584_L57;
        case 58: return PackageId.Borderlands_V584_L58;
      }
      break;
    case 594:
      if (licenseeVersion === 58) return PackageId.BorderlandsGOTY_V594_L58_OverrideV584;
      break;
    case 595:
      if (licenseeVersion === 58) return PackageId.Borderlands_V595_L58;
      break;
    case 727:
      switch (licenseeVersion) {
        case 69: return PackageId.Bioshock3_V727_L69;
        case 73: return PackageId.Bioshock3_V727_L73;
        case 75: return PackageId.Bioshock3_V727_L75;
        case 78: return PackageId.Bioshock3_V727_L78;
      }
      break;
    case 737:
      if (licenseeVersion === 22) return PackageId.SpecOps_V737_L22;
      break;
    case 740:
      if (licenseeVersion === 26) return PackageId.SpecOps_V740_L26;
      break;
    case 742:
      if (licenseeVersion === 29) return PackageId.Bulletstorm_V742_L29;
      break;
    case 801:
      if (licenseeVersion === 30) return PackageId.Dishonored_V801_L30;
      break;
    case 804:
      if (licenseeVersion === 42) return PackageId.DishonoredPS4_V804_L42;
      break;
    case 805:
      switch (licenseeVersion) {
        case 101: return PackageId.Batman2ArkhamCity_V805_L101;
        case 102: return PackageId.Batman2ArkhamCity_V805_L102;
      }
      break;
    case 806:
      if (licenseeVersion === 138) return PackageId.Batman3_V806_L138;
      break;
    case 807:
      if (licenseeVersion === 138) return PackageId.Batman3ArkhamOrigins_V807_L138;
      break;
    case 832:
      switch (licenseeVersion) {
        case 21: return PackageId.RememberMe_V832_L21;
        case 46: return PackageId.Borderlands2_V832_L46;
      }
      break;
    case 845:
      switch (licenseeVersion) {
        case 4: return PackageId.DmC_V845_L4;
        case 59: return PackageId.XCom_EnemyUnknown_V845_L59;
        case 64: return PackageId.XCom_EnemyUnknown_V845_L64;
      }
      break;
    case 877:
      if (licenseeVersion === 5) return PackageId.AHatInTime_V877_L5;
      break;
    case 881:
      if (licenseeVersion === 5) return PackageId.AHatInTime_V881_L5;
      break;
    case 882:
      if (licenseeVersion === 5) return PackageId.AHatInTime_V882_L5;
      break;
    case 884:
      switch (licenseeVersion) {
        case 5: return PackageId.AHatInTime_V884_L5;
        case 46: return PackageId.BorderlandsTheHandSomeCollection_V884_L46;
      }
      break;
    case 885:
      if (licenseeVersion === 5) return PackageId.AHatInTime_V885_L5;
      break;
    case 887:
      if (licenseeVersion === 41) return PackageId.BulletstormFullClipEdition_V887_L41;
      break;
    case 888:
      if (licenseeVersion === 5) return PackageId.AHatInTime_V888_L5;
      break;
    case 889:
      if (licenseeVersion === 5) return PackageId.AHatInTime_V889_L5;
      break;
    case 893:
      switch (licenseeVersion) {
        case 5: return PackageId.AHatInTime_V893_L5;
        case 21: return PackageId.RememberMe_V893_L21;
      }
      break;
  }

  return PackageId.Generic;
}

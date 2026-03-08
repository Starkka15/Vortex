import { BinaryReader, BinaryWriter } from "../binary";
import { CompressionFlag } from "../types";
import { FMipEntry, readFMipEntry, writeFMipEntry, LEGACY_VERSION } from "./FMipEntry";

/**
 * A texture entry in a .TFCMapping file.
 * Maps a texture name to its mip data across TFC files.
 */
export interface FTextureEntry {
  /** Texture identifier (e.g. "PackageName.GroupName.TextureName") */
  textureId: string;

  /** Mip levels stored in the external TFC file */
  tfcMipCount: number;
  /** Name of the TFC file (without index suffix or extension) */
  tfcName: string;
  /** TFC file index (forms filename: tfcName_tfcIndex.tfc) */
  tfcIndex: number;
  /** Mip entries for TFC-stored mips */
  tfcMips: FMipEntry[];

  /** Mip levels stored locally (inlined into the package) */
  localMipCount: number;
  /** Name of the local TFC file */
  localTfcName: string;
  /** Local TFC file index */
  localTfcIndex: number;
  /** Mip entries for locally-stored mips */
  localMips: FMipEntry[];
}

/**
 * Computed properties for an FTextureEntry.
 */
export function getTextureEntrySize(entry: FTextureEntry): { sizeX: number; sizeY: number } {
  const mips = entry.tfcMips.length > 0 ? entry.tfcMips : entry.localMips;
  return {
    sizeX: Math.max(...mips.map(m => m.sizeX)),
    sizeY: Math.max(...mips.map(m => m.sizeY)),
  };
}

export function getTextureTfcFullName(entry: FTextureEntry): string | null {
  if (entry.tfcMipCount > 0) {
    return `${entry.tfcName}_${entry.tfcIndex}`;
  }
  return null;
}

export function readFTextureEntry(reader: BinaryReader, version: number): FTextureEntry {
  const textureId = reader.readFString();

  const tfcMipCount = reader.readInt32();
  let tfcName = "";
  let tfcIndex = -1;
  const tfcMips: FMipEntry[] = [];

  if (tfcMipCount > 0) {
    tfcName = reader.readFString();
    tfcIndex = reader.readInt32();
    for (let i = 0; i < tfcMipCount; i++) {
      tfcMips.push(readFMipEntry(reader, version, CompressionFlag.LZO));
    }
  }

  const localMipCount = reader.readInt32();
  let localTfcName = "";
  let localTfcIndex = -1;
  const localMips: FMipEntry[] = [];

  if (localMipCount > 0) {
    localTfcName = reader.readFString();
    localTfcIndex = reader.readInt32();
    for (let i = 0; i < localMipCount; i++) {
      localMips.push(readFMipEntry(reader, version, CompressionFlag.None));
    }
  }

  const totalMips = tfcMipCount + localMipCount;
  if (totalMips === 0) {
    throw new Error(`${textureId}: MipCount = 0`);
  }

  return {
    textureId,
    tfcMipCount,
    tfcName,
    tfcIndex,
    tfcMips,
    localMipCount,
    localTfcName,
    localTfcIndex,
    localMips,
  };
}

export function writeFTextureEntry(writer: BinaryWriter, entry: FTextureEntry, version: number): void {
  writer.writeFString(entry.textureId);

  writer.writeInt32(entry.tfcMipCount);
  if (entry.tfcMipCount > 0) {
    writer.writeFString(entry.tfcName);
    writer.writeInt32(entry.tfcIndex);
    for (const mip of entry.tfcMips) {
      writeFMipEntry(writer, mip, version);
    }
  }

  writer.writeInt32(entry.localMipCount);
  if (entry.localMipCount > 0) {
    writer.writeFString(entry.localTfcName);
    writer.writeInt32(entry.localTfcIndex);
    for (const mip of entry.localMips) {
      writeFMipEntry(writer, mip, version);
    }
  }

  const totalMips = entry.tfcMipCount + entry.localMipCount;
  if (totalMips === 0) {
    throw new Error(`${entry.textureId}: MipCount = 0`);
  }
}

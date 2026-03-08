import * as fs from "fs";
import { BinaryReader, BinaryWriter, Endianness } from "../binary";
import { LEGACY_VERSION } from "./FMipEntry";
import { FTextureEntry, readFTextureEntry, writeFTextureEntry } from "./FTextureEntry";

/** Marker value indicating a versioned (non-legacy) mapping file */
const VERSION_MARKER = -1;

/** Highest version this implementation supports */
export const CURRENT_VERSION = 3;

/**
 * Parsed contents of a .TFCMapping file.
 * Maps texture names to their mip data locations in .tfc files.
 */
export interface MappingFileData {
  /** Format version (1 = legacy, 2+  = versioned) */
  version: number;
  /** Whether this mapping uses BulkContent (.bdc) files (BioShock 1/2) */
  hasBulkContent: boolean;
  /** All texture entries in this mapping */
  entries: FTextureEntry[];
}

/**
 * Read a .TFCMapping file from disk.
 */
export function readMappingFile(filePath: string): MappingFileData {
  const reader = BinaryReader.fromFile(filePath, Endianness.Little);
  return readMappingFileFromReader(reader);
}

/**
 * Read a .TFCMapping from a buffer.
 */
export function readMappingFileFromBuffer(buffer: Buffer): MappingFileData {
  const reader = new BinaryReader(buffer, Endianness.Little);
  return readMappingFileFromReader(reader);
}

/**
 * Parse mapping file data from a BinaryReader.
 */
function readMappingFileFromReader(reader: BinaryReader): MappingFileData {
  let version: number;

  const firstInt = reader.readInt32();
  if (firstInt === VERSION_MARKER) {
    version = reader.readInt32();
  } else {
    version = LEGACY_VERSION;
  }

  if (version > CURRENT_VERSION) {
    throw new Error(
      `Unsupported mapping file version ${version}. ` +
      `Maximum supported: ${CURRENT_VERSION}`
    );
  }

  let hasBulkContent = false;
  if (version >= 3) {
    hasBulkContent = reader.readByte() === 1;
  }

  const entryCount = reader.readInt32();
  const entries: FTextureEntry[] = [];

  for (let i = 0; i < entryCount; i++) {
    entries.push(readFTextureEntry(reader, version));
  }

  return { version, hasBulkContent, entries };
}

/**
 * Write a .TFCMapping file to disk.
 */
export function writeMappingFile(filePath: string, data: MappingFileData): void {
  const buffer = writeMappingFileToBuffer(data);
  fs.writeFileSync(filePath, buffer);
}

/**
 * Serialize mapping file data to a Buffer.
 */
export function writeMappingFileToBuffer(data: MappingFileData): Buffer {
  const writer = new BinaryWriter(4096, Endianness.Little);

  if (data.version === LEGACY_VERSION) {
    // Legacy format: write 0 as marker (no version header)
    writer.writeInt32(0);
  } else {
    writer.writeInt32(VERSION_MARKER);
    writer.writeInt32(data.version);
    if (data.version >= 3) {
      writer.writeByte(data.hasBulkContent ? 1 : 0);
    }
  }

  writer.writeInt32(data.entries.length);
  for (const entry of data.entries) {
    writeFTextureEntry(writer, entry, data.version);
  }

  return writer.toBuffer();
}

/**
 * Read just the entry count without parsing all entries (quick peek).
 */
export function readMappingFileEntryCount(filePath: string): number {
  const reader = BinaryReader.fromFile(filePath, Endianness.Little);

  const firstInt = reader.readInt32();
  if (firstInt === VERSION_MARKER) {
    const version = reader.readInt32();
    if (version >= 3) {
      reader.readByte(); // hasBulkContent
    }
  }

  return reader.readInt32();
}

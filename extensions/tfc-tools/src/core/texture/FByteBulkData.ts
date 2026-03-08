import { BinaryReader } from "../binary";
import { FByteBulkDataProfile } from "../packages/PackageProfile";
import { CompressionFlag, BulkDataFlags } from "../types";

/**
 * Storage type determined from bulk data flags.
 */
export enum BulkDataStorageType {
  Local = 0,
  ExternalFile = 1,
}

/**
 * Parsed FByteBulkData — describes where mipmap data is stored.
 */
export interface FByteBulkData {
  bulkDataFlags: number;
  storageType: BulkDataStorageType;
  compressionFlag: CompressionFlag;
  elementCount: number;
  diskSize: number;
  diskOffset: number;
  unused: boolean;
  /** Local inline data (only present for local storage with size > 0) */
  localData?: Buffer;
}

/**
 * Read an FByteBulkData from the reader.
 *
 * Standard format (HasFlags + HasSizeOffsetOnDisk, e.g. Dishonored V801):
 *   - bulkDataFlags: uint32
 *   - elementCount: int32
 *   - diskSize: int32 (or int64 if hasDiskDataSize64)
 *   - diskOffset: int32 (or int64 if hasDiskDataOffset64)
 *   - [data]: byte[diskSize] if local and size > 0
 *
 * Legacy format (!HasFlags, !HasSizeOffsetOnDisk, e.g. BioShock 1 V141):
 *   - offsetPlusCount: int32 (offset + elementCount)
 *   - elementCount: int32
 *   - diskOffset = offsetPlusCount - elementCount
 *   - diskSize = elementCount
 */
export function readFByteBulkData(
  reader: BinaryReader,
  profile: FByteBulkDataProfile,
  readLocalData: boolean = false,
): FByteBulkData {
  let bulkDataFlags = 0;
  let elementCount: number;
  let diskSize: number;
  let diskOffset: number;

  if (profile.hasFlags) {
    bulkDataFlags = reader.readUInt32();
  }

  if (profile.hasSizeOffsetOnDisk) {
    elementCount = reader.readInt32();

    if (profile.hasDiskDataSize64) {
      diskSize = Number(reader.readInt64());
    } else {
      diskSize = reader.readInt32();
    }

    if (profile.hasDiskDataOffset64) {
      diskOffset = Number(reader.readInt64());
    } else {
      diskOffset = reader.readInt32();
    }
  } else {
    // Legacy format
    const offsetPlusCount = reader.readInt32();
    elementCount = reader.readInt32();
    diskOffset = offsetPlusCount - elementCount;
    diskSize = elementCount;
  }

  if (profile.hasBulkDataKey) {
    reader.skip(4); // bulkDataKey
  }

  // Decode flags
  const unused = (bulkDataFlags & BulkDataFlags.Unused) !== 0;
  const isExternalFile = (bulkDataFlags & BulkDataFlags.StoreInSeparateFile) !== 0;
  const storageType = isExternalFile
    ? BulkDataStorageType.ExternalFile
    : BulkDataStorageType.Local;

  let compressionFlag = CompressionFlag.None;
  if ((bulkDataFlags & BulkDataFlags.CompressedLzo) !== 0) {
    compressionFlag = CompressionFlag.LZO;
  } else if ((bulkDataFlags & BulkDataFlags.CompressedZlib) !== 0) {
    compressionFlag = CompressionFlag.ZLIB;
  } else if ((bulkDataFlags & BulkDataFlags.CompressedLzx) !== 0) {
    compressionFlag = CompressionFlag.LZX;
  }

  // Read local inline data
  let localData: Buffer | undefined;
  if (storageType === BulkDataStorageType.Local && diskSize > 0 && !unused) {
    if (readLocalData) {
      localData = reader.readBytes(diskSize);
    } else {
      reader.skip(diskSize);
    }
  }

  return {
    bulkDataFlags,
    storageType,
    compressionFlag,
    elementCount,
    diskSize,
    diskOffset,
    unused,
    localData,
  };
}

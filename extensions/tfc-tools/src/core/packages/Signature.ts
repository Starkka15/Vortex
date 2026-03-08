import { BinaryReader, Endianness } from "../binary";

/** Standard UPK signature (little-endian) */
export const UPK_SIGNATURE_LE = 0x9E2A83C1;
/** Standard UPK signature (big-endian read) */
export const UPK_SIGNATURE_BE = 0xC1832A9E;
/** Killing Floor variant */
const UPK_SIGNATURE_KF = 0x9E2A83C2;

/**
 * Read and validate the UPK package signature.
 * Returns the detected endianness.
 */
export function readSignature(reader: BinaryReader): Endianness {
  const value = reader.readUInt32();

  if (value === UPK_SIGNATURE_LE || value === UPK_SIGNATURE_KF) {
    reader.setEndianness(Endianness.Little);
    return Endianness.Little;
  }

  if (value === UPK_SIGNATURE_BE) {
    reader.setEndianness(Endianness.Big);
    return Endianness.Big;
  }

  throw new Error(
    `Invalid UPK signature: 0x${value.toString(16).toUpperCase().padStart(8, "0")}. ` +
    `Expected 0x${UPK_SIGNATURE_LE.toString(16).toUpperCase()}`
  );
}

/**
 * Read the file version and licensee version that follow the signature.
 * In little-endian: fileVersion first, then licenseeVersion.
 * In big-endian: licenseeVersion first, then fileVersion.
 */
export function readVersions(reader: BinaryReader): {
  fileVersion: number;
  licenseeVersion: number;
} {
  if (reader.endianness === Endianness.Little) {
    const fileVersion = reader.readUInt16();
    const licenseeVersion = reader.readUInt16();
    return { fileVersion, licenseeVersion };
  } else {
    const licenseeVersion = reader.readUInt16();
    const fileVersion = reader.readUInt16();
    return { fileVersion, licenseeVersion };
  }
}

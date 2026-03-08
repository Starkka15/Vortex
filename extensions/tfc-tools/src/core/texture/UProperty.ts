import { BinaryReader } from "../binary";
import { UPKPackage, resolveName } from "../packages/UPKPackage";

/**
 * A parsed UE3 object property tag + value.
 */
export interface UProperty {
  name: string;
  typeName: string;
  dataSize: number;
  arrayIndex: number;
  structName?: string;
  /** Raw property value bytes (dataSize bytes) */
  data: Buffer;
}

/**
 * Read UE3 serialized properties from a BinaryReader.
 * Properties are a tagged list terminated by a "None" name entry.
 *
 * Format per property:
 *   - name: UNameIndex (int32 nameIndex + int32 suffix)
 *   - type: UNameIndex (int32 nameIndex + int32 suffix)
 *   - dataSize: int32
 *   - arrayIndex: int32
 *   - if type == "StructProperty": structName UNameIndex
 *   - if type == "BoolProperty": value is encoded in the data differently per version
 *   - data: byte[dataSize]
 *
 * Returns the list of properties and the reader position after the None terminator.
 */
export function readProperties(reader: BinaryReader, pkg: UPKPackage): UProperty[] {
  const properties: UProperty[] = [];

  while (true) {
    const nameIndex = reader.readInt32();
    const nameSuffix = reader.readInt32();

    const name = resolveName(pkg, nameIndex);

    if (name === "None") {
      break;
    }

    const typeIndex = reader.readInt32();
    const typeSuffix = reader.readInt32();
    const typeName = resolveName(pkg, typeIndex);

    const dataSize = reader.readInt32();
    const arrayIndex = reader.readInt32();

    let structName: string | undefined;
    if (typeName === "StructProperty") {
      const structNameIndex = reader.readInt32();
      const structSuffix = reader.readInt32();
      structName = resolveName(pkg, structNameIndex);
    }

    // ByteProperty with enum: extra UNameIndex for enum type name
    if (typeName === "ByteProperty" && pkg.profile.object.isBytePropertyUsedForEnum) {
      reader.skip(8); // enum type UNameIndex (not needed for our purposes)
    }

    // BoolProperty: when stored as byte, value is 1 byte AFTER the tag,
    // and dataSize is 0.
    let data: Buffer;
    if (typeName === "BoolProperty" && pkg.profile.object.isBoolPropertyStoredAsByte) {
      data = reader.readBytes(dataSize > 0 ? dataSize : 1);
    } else {
      data = reader.readBytes(dataSize);
    }

    properties.push({ name, typeName, dataSize, arrayIndex, structName, data });
  }

  return properties;
}

/**
 * Get the total byte size of a property list (for size calculations).
 */
export function getPropertiesSize(properties: UProperty[], pkg: UPKPackage): number {
  let size = 0;
  for (const prop of properties) {
    // name: 8 bytes (index + suffix)
    size += 8;
    // type: 8 bytes
    size += 8;
    // dataSize: 4, arrayIndex: 4
    size += 8;
    if (prop.typeName === "StructProperty") {
      size += 8; // struct name
    }
    size += prop.data.length;
  }
  // "None" terminator: 8 bytes
  size += 8;
  return size;
}

// --- Property value helpers ---

export function getIntProperty(properties: UProperty[], name: string): number | undefined {
  const prop = properties.find(p => p.name === name && p.typeName === "IntProperty");
  if (!prop || prop.data.length < 4) return undefined;
  return prop.data.readInt32LE(0);
}

export function getNameProperty(properties: UProperty[], name: string, pkg: UPKPackage): string | undefined {
  const prop = properties.find(p => p.name === name && p.typeName === "NameProperty");
  if (!prop || prop.data.length < 8) return undefined;
  const nameIndex = prop.data.readInt32LE(0);
  return resolveName(pkg, nameIndex);
}

export function getStrProperty(properties: UProperty[], name: string): string | undefined {
  const prop = properties.find(p => p.name === name && p.typeName === "StrProperty");
  if (!prop || prop.data.length < 4) return undefined;
  const len = prop.data.readInt32LE(0);
  if (len === 0) return "";
  if (len < 0) {
    // UTF-16
    const charCount = -len;
    return prop.data.subarray(4, 4 + (charCount - 1) * 2).toString("utf16le");
  }
  return prop.data.subarray(4, 4 + len - 1).toString("ascii");
}

export function getBoolProperty(properties: UProperty[], name: string): boolean | undefined {
  const prop = properties.find(p => p.name === name && p.typeName === "BoolProperty");
  if (!prop || prop.data.length < 1) return undefined;
  return prop.data[0] !== 0;
}

export function getByteProperty(properties: UProperty[], name: string, pkg: UPKPackage): string | undefined {
  const prop = properties.find(p => p.name === name && p.typeName === "ByteProperty");
  if (!prop) return undefined;
  // ByteProperty can store an enum name index (8 bytes) or a raw byte value
  if (prop.data.length >= 8) {
    const nameIndex = prop.data.readInt32LE(0);
    return resolveName(pkg, nameIndex);
  }
  if (prop.data.length >= 1) {
    return String(prop.data[0]);
  }
  return undefined;
}

import { BinaryReader } from "../binary";

/**
 * Read a UE2 FCompactIndex from a BinaryReader.
 *
 * FCompactIndex is a variable-length integer encoding:
 *   First byte: [sign(bit7)] [more(bit6)] [6 value bits]
 *   Following bytes: [more(bit7)] [7 value bits]
 *
 * Sign bit in first byte indicates negative values.
 * "More" flag indicates additional bytes follow.
 */
export function readFCompactIndex(reader: BinaryReader): number {
  const b0 = reader.readByte();
  const isNegative = (b0 & 0x80) !== 0;
  let hasMore = (b0 & 0x40) !== 0;
  let value = b0 & 0x3F;
  let shift = 6;

  while (hasMore) {
    const b = reader.readByte();
    hasMore = (b & 0x80) !== 0;
    value |= (b & 0x7F) << shift;
    shift += 7;
  }

  return isNegative ? -value : value;
}

/**
 * Encode an integer as UE2 FCompactIndex bytes.
 */
export function encodeFCompactIndex(value: number): Buffer {
  const isNegative = value < 0;
  let magnitude = Math.abs(value);

  const bytes: number[] = [];
  // First 6 bits
  bytes.push(magnitude & 0x3F);
  magnitude >>= 6;

  // Remaining in 7-bit chunks
  while (magnitude > 0) {
    bytes.push(magnitude & 0x7F);
    magnitude >>= 7;
  }

  // Set flags
  for (let i = 0; i < bytes.length; i++) {
    if (i === 0) {
      // First byte: set sign and more flags
      if (isNegative) bytes[i] |= 0x80;
      if (bytes.length > 1) bytes[i] |= 0x40;
    } else {
      // Subsequent bytes: set more flag if not last
      if (i < bytes.length - 1) bytes[i] |= 0x80;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Get the encoded size of a value as FCompactIndex.
 */
export function compactIndexSize(value: number): number {
  const mag = Math.abs(value);
  if (mag < 64) return 1;         // 2^6
  if (mag < 8192) return 2;       // 2^13
  if (mag < 1048576) return 3;    // 2^20
  if (mag < 134217728) return 4;  // 2^27
  return 5;
}

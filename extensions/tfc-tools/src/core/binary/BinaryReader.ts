import * as fs from "fs";

export enum Endianness {
  Little,
  Big,
}

/**
 * Binary reader supporting both little-endian and big-endian UPK packages.
 * Reads from a Node.js Buffer with position tracking.
 */
export class BinaryReader {
  private buffer: Buffer;
  private pos: number;
  private endian: Endianness;

  constructor(buffer: Buffer, endian: Endianness = Endianness.Little) {
    this.buffer = buffer;
    this.pos = 0;
    this.endian = endian;
  }

  static fromFile(filePath: string, endian?: Endianness): BinaryReader {
    return new BinaryReader(fs.readFileSync(filePath), endian);
  }

  get position(): number {
    return this.pos;
  }

  get length(): number {
    return this.buffer.length;
  }

  get remaining(): number {
    return this.buffer.length - this.pos;
  }

  get endianness(): Endianness {
    return this.endian;
  }

  setEndianness(endian: Endianness): void {
    this.endian = endian;
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.buffer.length) {
      throw new RangeError(`Seek offset ${offset} out of range [0, ${this.buffer.length}]`);
    }
    this.pos = offset;
  }

  skip(count: number): void {
    this.seek(this.pos + count);
  }

  readByte(): number {
    this.ensureAvailable(1);
    return this.buffer[this.pos++];
  }

  readBytes(count: number): Buffer {
    this.ensureAvailable(count);
    const result = this.buffer.subarray(this.pos, this.pos + count);
    this.pos += count;
    return Buffer.from(result);
  }

  readBoolean(): boolean {
    return this.readInt32() !== 0;
  }

  readInt16(): number {
    this.ensureAvailable(2);
    const val = this.endian === Endianness.Little
      ? this.buffer.readInt16LE(this.pos)
      : this.buffer.readInt16BE(this.pos);
    this.pos += 2;
    return val;
  }

  readUInt16(): number {
    this.ensureAvailable(2);
    const val = this.endian === Endianness.Little
      ? this.buffer.readUInt16LE(this.pos)
      : this.buffer.readUInt16BE(this.pos);
    this.pos += 2;
    return val;
  }

  readInt32(): number {
    this.ensureAvailable(4);
    const val = this.endian === Endianness.Little
      ? this.buffer.readInt32LE(this.pos)
      : this.buffer.readInt32BE(this.pos);
    this.pos += 4;
    return val;
  }

  readUInt32(): number {
    this.ensureAvailable(4);
    const val = this.endian === Endianness.Little
      ? this.buffer.readUInt32LE(this.pos)
      : this.buffer.readUInt32BE(this.pos);
    this.pos += 4;
    return val;
  }

  readInt64(): bigint {
    this.ensureAvailable(8);
    const val = this.endian === Endianness.Little
      ? this.buffer.readBigInt64LE(this.pos)
      : this.buffer.readBigInt64BE(this.pos);
    this.pos += 8;
    return val;
  }

  readUInt64(): bigint {
    this.ensureAvailable(8);
    const val = this.endian === Endianness.Little
      ? this.buffer.readBigUInt64LE(this.pos)
      : this.buffer.readBigUInt64BE(this.pos);
    this.pos += 8;
    return val;
  }

  readFloat(): number {
    this.ensureAvailable(4);
    const val = this.endian === Endianness.Little
      ? this.buffer.readFloatLE(this.pos)
      : this.buffer.readFloatBE(this.pos);
    this.pos += 4;
    return val;
  }

  readDouble(): number {
    this.ensureAvailable(8);
    const val = this.endian === Endianness.Little
      ? this.buffer.readDoubleLE(this.pos)
      : this.buffer.readDoubleBE(this.pos);
    this.pos += 8;
    return val;
  }

  /**
   * Read an Unreal FString: int32 length prefix followed by ASCII/UTF-8 bytes.
   * Length includes a null terminator byte.
   */
  readFString(): string {
    const length = this.readInt32();
    if (length === 0) return "";
    if (length < 0) {
      // Negative length = UTF-16 string (length is -charCount)
      const charCount = -length;
      this.ensureAvailable(charCount * 2);
      const buf = this.readBytes(charCount * 2);
      // Strip null terminator (last 2 bytes)
      return buf.subarray(0, (charCount - 1) * 2).toString("utf16le");
    }
    this.ensureAvailable(length);
    const bytes = this.readBytes(length);
    // Strip null terminator
    return bytes.subarray(0, length - 1).toString("ascii");
  }

  /**
   * Read an Unreal FGuid: 4 × uint32
   */
  readFGuid(): FGuid {
    return {
      a: this.readUInt32(),
      b: this.readUInt32(),
      c: this.readUInt32(),
      d: this.readUInt32(),
    };
  }

  /**
   * Peek at bytes without advancing position.
   */
  peek(count: number): Buffer {
    this.ensureAvailable(count);
    return Buffer.from(this.buffer.subarray(this.pos, this.pos + count));
  }

  peekInt32(): number {
    this.ensureAvailable(4);
    return this.endian === Endianness.Little
      ? this.buffer.readInt32LE(this.pos)
      : this.buffer.readInt32BE(this.pos);
  }

  peekUInt32(): number {
    this.ensureAvailable(4);
    return this.endian === Endianness.Little
      ? this.buffer.readUInt32LE(this.pos)
      : this.buffer.readUInt32BE(this.pos);
  }

  /**
   * Get the underlying buffer (or a slice).
   */
  getBuffer(): Buffer {
    return this.buffer;
  }

  slice(offset: number, length: number): Buffer {
    return Buffer.from(this.buffer.subarray(offset, offset + length));
  }

  private ensureAvailable(count: number): void {
    if (count < 0) {
      throw new RangeError(`Invalid read count: ${count} at offset ${this.pos}`);
    }
    if (this.pos + count > this.buffer.length) {
      throw new RangeError(
        `Read past end: need ${count} bytes at offset ${this.pos}, buffer length ${this.buffer.length}`
      );
    }
  }
}

export interface FGuid {
  a: number;
  b: number;
  c: number;
  d: number;
}

import * as fs from "fs";
import { Endianness, FGuid } from "./BinaryReader";

/**
 * Binary writer supporting both little-endian and big-endian.
 * Writes to a dynamically growing Buffer.
 */
export class BinaryWriter {
  private buffer: Buffer;
  private pos: number;
  private endian: Endianness;

  constructor(initialSize: number = 4096, endian: Endianness = Endianness.Little) {
    this.buffer = Buffer.alloc(initialSize);
    this.pos = 0;
    this.endian = endian;
  }

  /**
   * Create a writer backed by an existing buffer (for in-place modification).
   */
  static fromBuffer(buffer: Buffer, endian: Endianness = Endianness.Little): BinaryWriter {
    const writer = new BinaryWriter(0, endian);
    writer.buffer = buffer;
    writer.pos = 0;
    return writer;
  }

  get position(): number {
    return this.pos;
  }

  get length(): number {
    return this.pos;
  }

  get endianness(): Endianness {
    return this.endian;
  }

  setEndianness(endian: Endianness): void {
    this.endian = endian;
  }

  seek(offset: number): void {
    if (offset < 0) {
      throw new RangeError(`Seek offset ${offset} out of range`);
    }
    this.ensureCapacity(offset);
    this.pos = offset;
  }

  writeByte(value: number): void {
    this.ensureCapacity(this.pos + 1);
    this.buffer[this.pos++] = value & 0xff;
  }

  writeBytes(data: Buffer): void {
    this.ensureCapacity(this.pos + data.length);
    data.copy(this.buffer, this.pos);
    this.pos += data.length;
  }

  writeBoolean(value: boolean): void {
    this.writeInt32(value ? 1 : 0);
  }

  writeInt16(value: number): void {
    this.ensureCapacity(this.pos + 2);
    if (this.endian === Endianness.Little) {
      this.buffer.writeInt16LE(value, this.pos);
    } else {
      this.buffer.writeInt16BE(value, this.pos);
    }
    this.pos += 2;
  }

  writeUInt16(value: number): void {
    this.ensureCapacity(this.pos + 2);
    if (this.endian === Endianness.Little) {
      this.buffer.writeUInt16LE(value, this.pos);
    } else {
      this.buffer.writeUInt16BE(value, this.pos);
    }
    this.pos += 2;
  }

  writeInt32(value: number): void {
    this.ensureCapacity(this.pos + 4);
    if (this.endian === Endianness.Little) {
      this.buffer.writeInt32LE(value, this.pos);
    } else {
      this.buffer.writeInt32BE(value, this.pos);
    }
    this.pos += 4;
  }

  writeUInt32(value: number): void {
    this.ensureCapacity(this.pos + 4);
    if (this.endian === Endianness.Little) {
      this.buffer.writeUInt32LE(value, this.pos);
    } else {
      this.buffer.writeUInt32BE(value, this.pos);
    }
    this.pos += 4;
  }

  writeInt64(value: bigint): void {
    this.ensureCapacity(this.pos + 8);
    if (this.endian === Endianness.Little) {
      this.buffer.writeBigInt64LE(value, this.pos);
    } else {
      this.buffer.writeBigInt64BE(value, this.pos);
    }
    this.pos += 8;
  }

  writeUInt64(value: bigint): void {
    this.ensureCapacity(this.pos + 8);
    if (this.endian === Endianness.Little) {
      this.buffer.writeBigUInt64LE(value, this.pos);
    } else {
      this.buffer.writeBigUInt64BE(value, this.pos);
    }
    this.pos += 8;
  }

  writeFloat(value: number): void {
    this.ensureCapacity(this.pos + 4);
    if (this.endian === Endianness.Little) {
      this.buffer.writeFloatLE(value, this.pos);
    } else {
      this.buffer.writeFloatBE(value, this.pos);
    }
    this.pos += 4;
  }

  writeDouble(value: number): void {
    this.ensureCapacity(this.pos + 8);
    if (this.endian === Endianness.Little) {
      this.buffer.writeDoubleLE(value, this.pos);
    } else {
      this.buffer.writeDoubleBE(value, this.pos);
    }
    this.pos += 8;
  }

  /**
   * Write an Unreal FString: int32 length prefix + ASCII bytes + null terminator.
   */
  writeFString(value: string): void {
    if (value.length === 0) {
      this.writeInt32(0);
      return;
    }
    const length = value.length + 1; // +1 for null terminator
    this.writeInt32(length);
    this.ensureCapacity(this.pos + length);
    this.buffer.write(value, this.pos, "ascii");
    this.pos += value.length;
    this.buffer[this.pos++] = 0; // null terminator
  }

  /**
   * Write an Unreal FGuid: 4 × uint32
   */
  writeFGuid(guid: FGuid): void {
    this.writeUInt32(guid.a);
    this.writeUInt32(guid.b);
    this.writeUInt32(guid.c);
    this.writeUInt32(guid.d);
  }

  /**
   * Get the written data as a Buffer (trimmed to actual written length).
   */
  toBuffer(): Buffer {
    return Buffer.from(this.buffer.subarray(0, this.pos));
  }

  /**
   * Get the full backing buffer (may be larger than written data).
   */
  getBuffer(): Buffer {
    return this.buffer;
  }

  /**
   * Write the buffer contents to a file.
   */
  toFile(filePath: string): void {
    fs.writeFileSync(filePath, this.toBuffer());
  }

  private ensureCapacity(required: number): void {
    if (required <= this.buffer.length) return;
    let newSize = this.buffer.length * 2;
    while (newSize < required) {
      newSize *= 2;
    }
    const newBuffer = Buffer.alloc(newSize);
    this.buffer.copy(newBuffer);
    this.buffer = newBuffer;
  }
}

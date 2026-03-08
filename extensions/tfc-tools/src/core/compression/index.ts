import * as zlib from "zlib";
import { CompressionFlag } from "../types";

/**
 * Decompress a buffer using the specified compression method.
 */
export function decompress(
  data: Buffer,
  flag: CompressionFlag,
  uncompressedSize: number,
): Buffer {
  switch (flag) {
    case CompressionFlag.None:
      return data;
    case CompressionFlag.ZLIB:
      return decompressZlib(data);
    case CompressionFlag.LZO:
      return decompressLzo(data, uncompressedSize);
    case CompressionFlag.LZX:
      return decompressLzx(data, uncompressedSize);
    default:
      throw new Error(`Unsupported compression: ${CompressionFlag[flag] ?? flag}`);
  }
}

/**
 * Compress a buffer using the specified compression method.
 */
export function compress(
  data: Buffer,
  flag: CompressionFlag,
): Buffer {
  switch (flag) {
    case CompressionFlag.None:
      return data;
    case CompressionFlag.ZLIB:
      return compressZlib(data);
    case CompressionFlag.LZO:
      return compressLzo(data);
    default:
      throw new Error(`Compression not supported for: ${CompressionFlag[flag] ?? flag}`);
  }
}

// --- ZLIB (Node.js built-in) ---

function decompressZlib(data: Buffer): Buffer {
  return zlib.inflateSync(data);
}

function compressZlib(data: Buffer): Buffer {
  return zlib.deflateSync(data, { level: 6 });
}

// --- LZO (pure TypeScript via lzo-ts) ---

let LZO: typeof import("lzo-ts").LZO | null = null;

function getLZO(): typeof import("lzo-ts").LZO {
  if (!LZO) {
    LZO = require("lzo-ts").LZO;
  }
  return LZO!;
}

function decompressLzo(data: Buffer, _uncompressedSize: number): Buffer {
  const result = getLZO().decompress<Uint8Array>(data);
  return Buffer.from(result);
}

function compressLzo(data: Buffer): Buffer {
  const result = getLZO().compress<Uint8Array>(data);
  return Buffer.from(result);
}

// --- LZX (Xbox LZXD) ---

function decompressLzx(_data: Buffer, _uncompressedSize: number): Buffer {
  // LZX is only needed for Xbox 360 packages
  // Can be implemented later via native addon or WASM
  throw new Error(
    "LZX decompression not yet implemented. " +
    "This is only needed for Xbox 360 game packages."
  );
}

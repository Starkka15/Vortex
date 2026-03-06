# Gamebryo Save Parser - Linux Fix

These patched source files fix the native Gamebryo save parser for 64-bit Linux.

## Problem
The original code uses `unsigned long` to read 32-bit fields from save files.
On Windows, `unsigned long` is 4 bytes. On 64-bit Linux, it's 8 bytes.
This causes the parser to read garbage data, failing sanity checks and marking
all saves as corrupted.

## Fix
All `unsigned long` replaced with `uint32_t` (explicit 4-byte type).
Also fixed `MoreInfoException` to inherit from `std::runtime_error` instead of
using MSVC-specific `std::exception(std::runtime_error(...))` constructor.

## How to Apply
After `pnpm install`, copy these files over the originals and rebuild:

```bash
cp patches/gamebryo-savegame/gamebryosavegame.{cpp,h} \
  node_modules/.pnpm/gamebryo-savegame@*/node_modules/gamebryo-savegame/src/
cd node_modules/.pnpm/gamebryo-savegame@*/node_modules/gamebryo-savegame
npx node-gyp rebuild
cd -
pnpm run subprojects:out
```

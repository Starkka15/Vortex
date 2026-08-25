# Vendored `libloot-nodejs`

Prebuilt Linux binding for [libloot](https://github.com/loot/libloot), used to provide
LOOT plugin sorting on Linux. Windows continues to use the `loot` (node-loot) package;
nothing here is loaded on Windows.

## Why this is vendored

`libloot-nodejs` lives in the libloot repository under `nodejs/` and declares napi targets
for both `x86_64-pc-windows-msvc` and `x86_64-unknown-linux-gnu`, but it is **not published
to npm**, so it cannot be depended on normally. Building it requires a Rust toolchain, which
we don't want to add to Vortex's build requirements. Vendoring the prebuilt artifact keeps
the Linux build working with no extra prerequisites.

Replace this with a normal dependency if libloot ever publishes to npm.

## Contents

Only what is needed to load the module:

- `libloot-nodejs.linux-x64-gnu.node` — the native addon, `strip --strip-unneeded` (33MB -> 5.5MB)
- `libloot-nodejs.js`, `index.d.ts` — the napi-generated loader (renamed from `index.js` so it can
  sit flat in `dist/` beside the bundled `index.cjs`) and typings
- `LICENSE` — libloot is GPL-3.0, as are Vortex and node-loot

Deliberately excluded: Rust sources, `Cargo.*`, `node_modules`, `npm/` platform stubs, tests,
and the Windows binding.

## Provenance

- libloot `0.29.6`, revision `38610e7b`
- Built with `LIBLOOT_REVISION=38610e7b napi build --platform --release` in `nodejs/`
- Fork used: https://github.com/Starkka15/libloot

## Verified

Sorted 94 real Skyrim Special Edition plugins into correct LOOT order on Linux.

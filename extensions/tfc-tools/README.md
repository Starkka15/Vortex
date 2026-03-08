# tfc-tools — TFC Texture Mod Patcher for Vortex

Cross-platform Node.js/TypeScript rewrite of [TFC Installer](https://www.nexusmods.com/bioshockinfinite/mods/30) for use as a bundled Vortex extension. Automatically patches UE3 game packages with TFC texture mods after deployment.

## Status

**Work in progress** — this extension may not work correctly for all mods or configurations. Large HD texture packs can cause out-of-memory crashes on 32-bit UE3 games (e.g. Dishonored) when running under Wine/DXVK due to address space limitations.

If you encounter issues, use [TFC Installer](https://www.nexusmods.com/bioshockinfinite/mods/30) through Wine as a reliable alternative.

## Supported Games

- BioShock Remastered
- BioShock 2 Remastered
- BioShock Infinite
- Dishonored

## Features

- Hooks into Vortex deploy/purge lifecycle — patches on deploy, restores backups on purge
- UPK/XXX/BSM package texture replacement via TFC mapping files
- BulkContent (.blk) storage updates for BioShock 1/2
- UPK recompression (LZO/ZLIB) to preserve compressed package format
- TFC archive copying with TOC patching
- Game executable hash-check bypass
- INI file patching
- Built-in GameProfile fallback for mods that don't include their own
- File backup and restore

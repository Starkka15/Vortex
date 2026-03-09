# Vortex for Linux

A fork of [Nexus Mods' Vortex](https://github.com/Nexus-Mods/Vortex) mod manager ported to run natively on Linux. This project aims to bring full Vortex functionality to Linux users, including Proton/Wine-aware game discovery, save management, and mod deployment for Steam games running through Proton. At least while we wait for an official Vortex Linux Build.

> **This is an experimental build.** It has been tested on a single system (Ubuntu Linux) with a limited set of games. What works for me may not work for you — different distros, desktop environments, filesystem layouts, and Proton versions can all introduce issues. Bug reports are welcome, but please go in with the expectation that things may break.

## What's Different from Upstream

### Linux Native Support
- Runs natively on Linux via Electron (no Wine/Proton wrapper needed for Vortex itself)
- Proton-aware path resolution for save games, INI files, and settings — correctly resolves paths inside `steamapps/compatdata/<appid>/pfx/` prefixes
- Case-sensitive filesystem handling for game data folders
- Fixed native module compatibility (`unsigned long` → `uint32_t` for 64-bit Linux)
- Pure JS INI parser replaces Windows-only `winapi-bindings` for reading/writing game INI files
- LOOT plugin sorting gracefully skipped on Linux (native Windows module)
- Windows API calls (`GetVolumePathName`, etc.) guarded with platform checks throughout

### Heroic Games Launcher Integration
- New `gamestore-heroic` extension for discovering games installed via [Heroic Games Launcher](https://heroicgameslauncher.com/)
- Supports Epic (Legendary), GOG, and Amazon (Nile) game stores
- Reads Wine/Proton prefix paths from Heroic's per-game configuration
- Supports Flatpak, native, and Snap Heroic installations

### TFC Texture Mod Patching (tfc-tools)
- Bundled extension that automatically patches UE3 game packages with TFC texture mods on deploy
- Supports BioShock Remastered, BioShock 2, BioShock Infinite, and Dishonored
- Block-level selective compression: only decompresses/recompresses chunks containing modified textures, reducing memory usage for 32-bit UE3 games
- TFC archive copying, TOC patching, game executable hash-check bypass, INI patching
- **Status**: Works for BioShock, Dishonored support is experimental (game crashes in some configurations). Needs more testing.

### Witcher 3 Script Merger (Linux)
- Bundles [tw3-script-merger](https://github.com/Aelto/tw3-script-merger) by [Aelto](https://github.com/Aelto) — a Rust-based CLI 3-way script merger for The Witcher 3, replacing the Windows-only WitcherScriptMerger.exe
- Conflict resolution GUI built into Vortex: auto-resolves simple conflicts, shows A/B/C selection dialog for true conflicts
- Automatically installed alongside the game extension — no manual setup required

### Bug Fixes
- **Game discovery**: Fixed `GameStoreHelper.find()` silently dropping Steam game results due to a `priority` check that excluded entries without an explicit priority field
- **Save game parser**: Fixed `unsigned long` type mismatch in the Gamebryo save parser C++ module — on 64-bit Linux, `unsigned long` is 8 bytes (vs 4 on Windows), causing all saves to appear as corrupted
- **Save/INI paths**: Multiple Gamebryo extensions (savegame management, test settings, archive invalidation) now resolve paths from the Proton prefix instead of defaulting to `~/Documents`
- **BSA archive version check**: Replaced unreliable stream-based reader with direct file read, fixing false "incompatible archive" warnings
- **Horizon Zero Dawn extension**: Fixed crash caused by removed `electron.remote` API, bundled as a built-in extension
- **Staging directory**: Auto-creates missing staging folders on Linux instead of showing confusing error dialogs
- **Case-insensitive path resolution**: Gracefully handles non-existent paths (e.g. staging folders not yet created) instead of throwing errors

### Supported Games (Tested)
- Skyrim Special Edition (Steam/Proton)
- Fallout 4 (Steam/Proton)
- Fallout New Vegas (Steam/Proton)
- Cyberpunk 2077 (Steam/Proton)
- Baldur's Gate 3 (Steam/Proton)
- Prey 2017 (Steam/Proton)
- Horizon Zero Dawn (Steam/Proton)
- BioShock Remastered (Steam/Proton) — texture mods via tfc-tools
- Dishonored (Heroic/Wine) — texture mods experimental (NOT WORKING RELIABLY)
- The Witcher 3 (Steam/Proton) — script merging via tw3-script-merger
- A Hat in Time (Steam/Proton)

## Installation

### Quick Install (Recommended)
```bash
git clone --recurse-submodules https://github.com/Starkka15/Vortex.git
cd Vortex
./install.sh
```

The installer handles everything: prerequisites, dependencies, native modules, build, and desktop shortcut. Requires Ubuntu 22.04+ (or similar Debian-based distro), Node.js 22+ (via [nvm](https://github.com/nvm-sh/nvm)), and `git`.

### Manual Build
If you prefer to build manually:
```bash
git clone --recurse-submodules https://github.com/Starkka15/Vortex.git
cd Vortex
pnpm run build:fomod && pnpm install
pnpm run build
pnpm run build:assets
pnpm run build:extensions
pnpm run start
```

### Prerequisites (installed automatically by `install.sh`)
- Node.js 22+ (via [nvm](https://github.com/nvm-sh/nvm))
- pnpm, yarn
- build-essential, python3, python3-setuptools
- liblz4-dev, zlib1g-dev, libx11-dev, libxkbfile-dev

## Contributing

Fixes and contributions are welcome! If you run into issues, please open an issue and include your `vortex.log` file (found in `~/.config/@vortex/main/vortex.log`). I'm open to having an AppImage created for it (would make modding games on SteamOS easier, but I'm running into issues of using WebPack vs TSC... TSC (running it thorugh pnpm run start) works fine... Lot of bugs when trying to create an AppImage.

## Acknowledgements

- [Nexus Mods](https://github.com/Nexus-Mods) — Vortex mod manager (upstream)
- [Aelto](https://github.com/Aelto) — [tw3-script-merger](https://github.com/Aelto/tw3-script-merger), the Rust-based CLI script merger for The Witcher 3 bundled in this fork
- [Heroic Games Launcher](https://heroicgameslauncher.com/) — Linux game launcher whose configuration is read by the Heroic game store extension

## Upstream

Based on [Nexus-Mods/Vortex](https://github.com/Nexus-Mods/Vortex). See upstream README and [Vortex Wiki](https://github.com/Nexus-Mods/Vortex/wiki) for general Vortex documentation.

## License

[GPL-3.0](LICENSE.md)

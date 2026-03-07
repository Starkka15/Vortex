# Vortex for Linux

A fork of [Nexus Mods' Vortex](https://github.com/Nexus-Mods/Vortex) mod manager ported to run natively on Linux. This project aims to bring full Vortex functionality to Linux users, including Proton/Wine-aware game discovery, save management, and mod deployment for Steam games running through Proton.

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
- BioShock Remastered (Steam/Proton)
- A Hat in Time (Steam/Proton)

## Building

### Prerequisites
- Node.js 22.x (via [Volta](https://volta.sh/) or nvm)
- PNPM
- Development libraries: `liblz4-dev`, `zlib1g-dev` (for native save parser)

### Setup & Run
```bash
pnpm run build:fomod && pnpm install
pnpm run build
pnpm run assets:out
pnpm run subprojects:out
pnpm run start
```

### Rebuilding Native Modules
The Gamebryo save parser needs to be compiled for Linux:
```bash
cd node_modules/.pnpm/gamebryo-savegame@*/node_modules/gamebryo-savegame
npx node-gyp rebuild
cd -
pnpm run subprojects:out  # copies the .node file to the right place
```

## Contributing

Fixes and contributions are welcome! If you run into issues, please open an issue and include your `vortex.log` file (found in `~/.config/@vortex/main/vortex.log`). I'm open to having an AppImage created for it (would make modding games on SteamOS easier, but I'm running into issues of using WebPack vs TSC... TSC (running it thorugh pnpm run start) works fine... Lot of bugs when trying to create an AppImage.

## Upstream

Based on [Nexus-Mods/Vortex](https://github.com/Nexus-Mods/Vortex). See upstream README and [Vortex Wiki](https://github.com/Nexus-Mods/Vortex/wiki) for general Vortex documentation.

## License

[GPL-3.0](LICENSE.md)

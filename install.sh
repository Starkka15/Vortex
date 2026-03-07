#!/bin/bash
set -e

# Vortex for Linux — Installer
# Builds from source and creates a desktop shortcut.
# Run from the cloned repo directory: ./install.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[*]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[!]${NC} $1"; exit 1; }

# --- Check prerequisites ---

info "Checking prerequisites..."

# Source nvm if available (might not be on PATH in all environments)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

if ! command -v git &>/dev/null; then
    error "git is not installed. Install it with: sudo apt install git"
fi

# Check for Node.js 22+
if command -v node &>/dev/null; then
    NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VER" -lt 22 ]; then
        error "Node.js 22+ required (found $(node -v)). Install via nvm: nvm install 22"
    fi
    info "Node.js $(node -v) found"
else
    error "Node.js is not installed. Install via nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install 22"
fi

# Check for pnpm
if ! command -v pnpm &>/dev/null; then
    warn "pnpm not found, installing..."
    npm install -g pnpm
fi
info "pnpm $(pnpm -v) found"

# Check for yarn (needed by fomod-installer build)
if ! command -v yarn &>/dev/null; then
    warn "yarn not found, installing..."
    npm install -g yarn
fi

# Check for build essentials
if ! dpkg -s build-essential &>/dev/null 2>&1; then
    warn "build-essential not found, installing..."
    sudo apt-get update && sudo apt-get install -y build-essential
fi

# Check for native module dependencies
MISSING_PKGS=""
for pkg in liblz4-dev zlib1g-dev libx11-dev libxkbfile-dev python3 python3-setuptools; do
    if ! dpkg -s "$pkg" &>/dev/null 2>&1; then
        MISSING_PKGS="$MISSING_PKGS $pkg"
    fi
done

if [ -n "$MISSING_PKGS" ]; then
    warn "Installing missing packages:$MISSING_PKGS"
    sudo apt-get update && sudo apt-get install -y $MISSING_PKGS
fi

info "All prerequisites met"

# --- Initialize submodules ---

info "Initializing submodules..."
git submodule update --init --recursive

# --- Build ---

# fomod-installer-native requires C#/.NET build not available on Linux.
# Create minimal stubs so pnpm can link it and tsc can compile.
info "Creating stubs for Windows-only native modules..."
FOMOD_NATIVE_DIST="extensions/fomod-installer/src/ModInstaller.Native.TypeScript/dist"
if [ ! -f "$FOMOD_NATIVE_DIST/ModInstaller.d.ts" ]; then
    mkdir -p "$FOMOD_NATIVE_DIST/types"

    # types/SupportedResult.d.ts
    cat > "$FOMOD_NATIVE_DIST/types/SupportedResult.d.ts" <<'STUBEOF'
export interface SupportedResult { supported: boolean; requiredFiles: string[]; }
STUBEOF

    # types/InstallResult.d.ts
    cat > "$FOMOD_NATIVE_DIST/types/InstallResult.d.ts" <<'STUBEOF'
export interface InstallInstruction { type: string; source: string; destination: string; section: string; key: string; value: string; data: Uint8Array; priority: string; }
export interface InstallResult { message: string; instructions: InstallInstruction[]; }
STUBEOF

    # types/FileSystem.d.ts
    cat > "$FOMOD_NATIVE_DIST/types/FileSystem.d.ts" <<'STUBEOF'
export interface FileSystemConstructor { new (readFileContent: Function, readDirectoryFileList: Function, readDirectoryList: Function): FileSystem; setDefaultCallbacks(): void; }
export interface FileSystem { setCallbacks(): void; }
export interface IFileSystemExtension { FileSystem: FileSystemConstructor; }
STUBEOF

    # types/Logger.d.ts
    cat > "$FOMOD_NATIVE_DIST/types/Logger.d.ts" <<'STUBEOF'
export interface LoggerConstructor { new (log: (level: number, message: string) => void): Logger; setDefaultCallbacks(): void; }
export interface Logger { setCallbacks(): void; disposeDefaultLogger(): void; }
export interface ILoggerExtension { Logger: LoggerConstructor; }
STUBEOF

    # types/ModInstaller.d.ts
    cat > "$FOMOD_NATIVE_DIST/types/ModInstaller.d.ts" <<'STUBEOF'
import { SupportedResult, InstallResult, IHeaderImage, SelectCallback, ContinueCallback, CancelCallback, IInstallStep } from ".";
export interface ModInstallerConstructor { new (...args: any[]): ModInstaller; testSupported(files: string[], allowedTypes: string[]): SupportedResult; }
export interface ModInstaller { install(files: string[], stopPatterns: string[], pluginPath: string, scriptPath: string, preset: any, validate: boolean): Promise<InstallResult | null>; }
export interface IModInstallerExtension { ModInstaller: ModInstallerConstructor; }
STUBEOF

    # types/index.d.ts
    cat > "$FOMOD_NATIVE_DIST/types/index.d.ts" <<'STUBEOF'
export * from './ModInstaller';
export * from './FileSystem';
export * from './Logger';
export * from './SupportedResult';
export * from './InstallResult';
export type OrderType = 'AlphaAsc' | 'AlphaDesc' | 'Explicit';
export type GroupType = 'SelectAtLeastOne' | 'SelectAtMostOne' | 'SelectExactlyOne' | 'SelectAll' | 'SelectAny';
export type PluginType = 'Required' | 'Optional' | 'Recommended' | 'NotUsable' | 'CouldBeUsable';
export interface IPlugin { id: number; selected: boolean; preset: boolean; name: string; description: string; image: string; type: PluginType; conditionMsg?: string; }
export interface IGroup { id: number; name: string; type: GroupType; options: IPlugin[]; }
export interface IGroupList { group: IGroup[]; order: OrderType; }
export interface IInstallStep { id: number; name: string; visible: boolean; optionalFileGroups?: IGroupList; }
export interface IHeaderImage { path: string; showFade: boolean; height: number; }
export type SelectCallback = (stepId: number, groupId: number, optionId: number[]) => void;
export type ContinueCallback = (forward: boolean, currentStepId: number) => void;
export type CancelCallback = () => void;
export interface IExtension { allocWithOwnership(length: number): Buffer | null; allocWithoutOwnership(length: number): Buffer | null; allocAliveCount(): number; }
STUBEOF

    # Common.d.ts
    cat > "$FOMOD_NATIVE_DIST/Common.d.ts" <<'STUBEOF'
export declare const allocWithOwnership: (length: number) => Uint8Array | null;
export declare const allocWithoutOwnership: (length: number) => Uint8Array | null;
export declare const allocAliveCount: () => number;
STUBEOF

    # Logger.d.ts
    cat > "$FOMOD_NATIVE_DIST/Logger.d.ts" <<'STUBEOF'
import * as types from './types';
export declare class NativeLogger implements types.Logger { private manager; constructor(log: (level: number, message: string) => void); setCallbacks(): void; disposeDefaultLogger(): void; static setDefaultCallbacks: () => void; }
STUBEOF

    # ModInstaller.d.ts
    cat > "$FOMOD_NATIVE_DIST/ModInstaller.d.ts" <<'STUBEOF'
import * as types from './types';
export declare class NativeModInstaller implements types.ModInstaller { private manager; constructor(...args: any[]); install(files: string[], stopPatterns: string[], pluginPath: string, scriptPath: string, preset: any, validate: boolean): Promise<types.InstallResult | null>; static testSupported: (files: string[], allowedTypes: string[]) => types.SupportedResult; }
STUBEOF

    # FileSystem.d.ts
    cat > "$FOMOD_NATIVE_DIST/FileSystem.d.ts" <<'STUBEOF'
import * as types from './types';
export declare class NativeFileSystem implements types.FileSystem { private manager; constructor(readFileContent: Function, readDirectoryFileList: Function, readDirectoryList: Function); setCallbacks(): void; static setDefaultCallbacks: () => void; }
STUBEOF

    # index.d.ts
    cat > "$FOMOD_NATIVE_DIST/index.d.ts" <<'STUBEOF'
import * as types from './types';
export * from './Common';
export * from './Logger';
export * from './ModInstaller';
export * from './FileSystem';
export { types };
STUBEOF

    # index.js — runtime stub (native addon won't work on Linux anyway)
    cat > "$FOMOD_NATIVE_DIST/index.js" <<'STUBEOF'
module.exports = {};
STUBEOF

    info "Created fomod-installer-native type stubs"
fi

info "Building FOMOD installer..."
pnpm run build:fomod || warn "FOMOD build had errors (non-fatal, continuing)"

info "Installing dependencies..."
# Some native modules (winapi-bindings, fomod-installer-native, loot) are
# Windows-only and will fail to compile on Linux. Use --ignore-scripts to
# install everything, then rebuild. Native module failures are non-fatal.
pnpm install --ignore-scripts

info "Installing Electron binary..."
ELECTRON_INSTALL=$(find node_modules/.pnpm -path '*/electron/install.js' 2>/dev/null | head -1)
if [ -n "$ELECTRON_INSTALL" ]; then
    node "$ELECTRON_INSTALL"
else
    warn "Electron install script not found"
fi

info "Building native modules (Windows-only modules will be skipped)..."
pnpm rebuild 2>&1 | tee /tmp/pnpm-rebuild.log || true

info "Building Vortex..."
pnpm run build

info "Building assets..."
pnpm run build:assets

# --- Build native modules that extensions depend on ---

SAVEGAME_DIR=$(find node_modules/.pnpm -path '*/gamebryo-savegame/binding.gyp' -exec dirname {} \; 2>/dev/null | head -1)
if [ -n "$SAVEGAME_DIR" ]; then
    SAVEGAME_NODE="$SAVEGAME_DIR/build/Release/GamebryoSave.node"
    if [ ! -f "$SAVEGAME_NODE" ]; then
        info "Building native save parser..."
        # autogypi files are normally generated during install scripts
        # (which we skip with --ignore-scripts). Create them if missing.
        [ ! -f "$SAVEGAME_DIR/auto-top.gypi" ] && echo '{}' > "$SAVEGAME_DIR/auto-top.gypi"
        [ ! -f "$SAVEGAME_DIR/auto.gypi" ] && printf '{\n\t"includes": []\n}\n' > "$SAVEGAME_DIR/auto.gypi"
        (cd "$SAVEGAME_DIR" && npx node-gyp rebuild) || warn "Save parser build failed (non-fatal)"
    else
        info "Native save parser already built"
    fi
fi

info "Building extensions..."
pnpm --filter "./extensions/**" --no-bail run build 2>&1 || warn "Some extensions failed to build (non-fatal, Windows-only native modules)"

info "Build complete!"

# --- Create desktop shortcut ---

info "Creating desktop shortcut..."

DESKTOP_FILE="$HOME/.local/share/applications/Vortex.desktop"
DESKTOP_LINK="$HOME/Desktop/Vortex.desktop"
ICON_PATH="$SCRIPT_DIR/assets/images/vortex.png"

mkdir -p "$HOME/.local/share/applications"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=Vortex
Comment=Vortex Mod Manager for Linux
Exec=bash -lc "cd $SCRIPT_DIR && pnpm run start"
Icon=$ICON_PATH
Terminal=false
Type=Application
Categories=Game;
StartupNotify=true
EOF

chmod +x "$DESKTOP_FILE"
update-desktop-database "$HOME/.local/share/applications/" 2>/dev/null || true

# Copy to desktop if Desktop directory exists
if [ -d "$HOME/Desktop" ]; then
    cp "$DESKTOP_FILE" "$DESKTOP_LINK"
    chmod +x "$DESKTOP_LINK"
    gio set "$DESKTOP_LINK" metadata::trusted true 2>/dev/null || true
fi

echo ""
info "Vortex installed successfully!"
info "Launch from your app menu or desktop shortcut."
info "Or run manually: cd $SCRIPT_DIR && pnpm run start"

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

info "Building FOMOD installer..."
pnpm run build:fomod || warn "FOMOD build had errors (non-fatal, continuing)"

info "Installing dependencies..."
# Some native modules (winapi-bindings, fomod-installer-native, loot) are
# Windows-only and will fail to compile on Linux. Use --ignore-scripts to
# install everything, then rebuild. Native module failures are non-fatal.
pnpm install --ignore-scripts

info "Building native modules (Windows-only modules will be skipped)..."
pnpm rebuild 2>&1 | tee /tmp/pnpm-rebuild.log || true

info "Creating stubs for Windows-only native modules..."
# fomod-installer-native requires C#/.NET build that's not available on Linux.
# Create minimal type stubs so tsc can compile.
FOMOD_NATIVE_DIST="extensions/fomod-installer/src/ModInstaller.Native.TypeScript/dist"
if [ ! -f "$FOMOD_NATIVE_DIST/index.d.ts" ]; then
    mkdir -p "$FOMOD_NATIVE_DIST"
    echo "export {};" > "$FOMOD_NATIVE_DIST/index.d.ts"
    echo "module.exports = {};" > "$FOMOD_NATIVE_DIST/index.js"
    echo '{"name":"fomod-installer-native","version":"0.0.0","main":"./index.js","types":"./index.d.ts"}' > "$FOMOD_NATIVE_DIST/package.json"
fi

info "Building Vortex..."
pnpm run build

info "Building assets..."
pnpm run assets:out

info "Building extensions..."
pnpm run subprojects:out

# --- Rebuild native modules if needed ---

SAVEGAME_DIR=$(find node_modules/.pnpm -path '*/gamebryo-savegame/binding.gyp' -exec dirname {} \; 2>/dev/null | head -1)
if [ -n "$SAVEGAME_DIR" ]; then
    SAVEGAME_NODE="$SAVEGAME_DIR/build/Release/gamebryo-savegame.node"
    if [ ! -f "$SAVEGAME_NODE" ]; then
        info "Building native save parser..."
        (cd "$SAVEGAME_DIR" && npx node-gyp rebuild)
        pnpm run subprojects:out
    else
        info "Native save parser already built"
    fi
fi

info "Build complete!"

# --- Create desktop shortcut ---

info "Creating desktop shortcut..."

DESKTOP_FILE="$HOME/.local/share/applications/Vortex.desktop"
DESKTOP_LINK="$HOME/Desktop/Vortex.desktop"
ICON_PATH="$SCRIPT_DIR/assets/images/vortex.png"

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

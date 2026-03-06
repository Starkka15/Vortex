'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// --- Registry Stubs ---
// On Linux, registry calls return null/throw to indicate "not found".
// Game store extensions guard these with try/catch already.

function RegGetValue(hive, keyPath, valueName) {
  // Special case: Steam path - try Linux filesystem
  if (keyPath.includes('Valve\\Steam') && valueName === 'SteamPath') {
    const steamPaths = [
      path.join(os.homedir(), '.local/share/Steam'),
      path.join(os.homedir(), '.steam/debian-installation'),
      path.join(os.homedir(), '.steam/steam'),
      path.join(os.homedir(), '.var/app/com.valvesoftware.Steam/data/Steam'),
      path.join(os.homedir(), 'snap/steam/common/.local/share/Steam'),
    ];
    for (const p of steamPaths) {
      if (fs.existsSync(path.join(p, 'config/libraryfolders.vdf'))) {
        return { type: 'REG_SZ', value: p };
      }
    }
  }

  // All other registry lookups fail on Linux - callers handle this with try/catch
  const err = new Error(`Registry not available on Linux: ${hive}\\${keyPath}\\${valueName}`);
  err.code = 'ENOENT';
  err.systemCode = 2;
  throw err;
}

function WithRegOpen(hive, keyPath, callback) {
  // Registry doesn't exist on Linux - throw so callers' catch blocks handle it
  const err = new Error('Registry not available on Linux');
  err.code = 'ENOENT';
  err.systemCode = 2;
  throw err;
}

function RegEnumKeys(hkey) {
  return [];
}

function RegEnumValues(hkey) {
  return [];
}

// --- System Information ---

function GetNativeArch() {
  const archMap = {
    'x64': 'x64',
    'arm64': 'ARM64',
    'ia32': 'x86',
    'arm': 'ARM',
  };
  return { nativeArch: archMap[process.arch] || process.arch };
}

function GetDiskFreeSpaceEx(dirPath) {
  try {
    const resolvedPath = fs.existsSync(dirPath) ? dirPath : '/';
    const result = execSync(`df -B1 "${resolvedPath}" 2>/dev/null | tail -1`, { encoding: 'utf8' });
    const parts = result.trim().split(/\s+/);
    // df columns: Filesystem 1B-blocks Used Available Use% Mounted
    const available = parseInt(parts[3], 10) || 0;
    const total = parseInt(parts[1], 10) || 0;
    return {
      freeToCaller: available,
      freeTotal: available,
      total: total,
    };
  } catch (err) {
    return { freeToCaller: 0, freeTotal: 0, total: 0 };
  }
}

function GetVolumePathName(filePath) {
  try {
    const result = execSync(`df "${filePath}" 2>/dev/null | tail -1`, { encoding: 'utf8' });
    const parts = result.trim().split(/\s+/);
    // Last field is mount point
    return parts[parts.length - 1] || '/';
  } catch (err) {
    return path.parse(path.resolve(filePath)).root || '/';
  }
}

// --- Process Management ---

function GetProcessList() {
  try {
    const procDirs = fs.readdirSync('/proc').filter(d => /^\d+$/.test(d));
    const processes = [];
    for (const pid of procDirs) {
      try {
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
        processes.push({
          exeFile: comm,
          processID: parseInt(pid, 10),
        });
      } catch (e) {
        // Process may have exited
      }
    }
    return processes;
  } catch (err) {
    return [];
  }
}

function GetProcessWindowList(processID) {
  // No window management API on Linux without X11/Wayland bindings
  return [];
}

function SetForegroundWindow(windowHandle) {
  // No-op on Linux
}

// --- Wine Detection ---

function IsThisWine() {
  // We're running natively on Linux, not under Wine
  return false;
}

// --- Execution ---

function ShellExecuteEx(options) {
  const { verb, file, parameters, directory, show } = options || {};

  if (verb === 'runas') {
    // Elevated execution on Linux - use pkexec
    const args = parameters ? parameters.split(' ') : [];
    try {
      const child = spawn('pkexec', [file, ...args], {
        cwd: directory || process.cwd(),
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } catch (err) {
      throw new Error(`Failed to execute elevated: ${err.message}`);
    }
  } else {
    // Normal execution
    const args = parameters ? parameters.split(' ') : [];
    try {
      const child = spawn(file, args, {
        cwd: directory || process.cwd(),
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } catch (err) {
      throw new Error(`Failed to execute: ${err.message}`);
    }
  }
}

// --- Privileges & Security ---

function CheckYourPrivilege() {
  // On Linux, return appropriate privilege indicators
  // Root has all privileges, regular users have basic ones
  if (process.getuid && process.getuid() === 0) {
    return ['SeCreateSymbolicLinkPrivilege'];
  }
  // Regular users on Linux can create symlinks without special privileges
  return ['SeCreateSymbolicLinkPrivilege'];
}

function GetUserSID() {
  // Return UID as string (Linux equivalent of SID)
  return String(process.getuid ? process.getuid() : 1000);
}

function SupportsAppContainer() {
  // AppContainer is Windows-only sandbox feature
  return false;
}

// --- UI Language ---

function SetProcessPreferredUILanguages(languages) {
  // No-op on Linux - system locale handles this
}

// --- Module/DLL Listing ---

function GetModuleList(processHandle) {
  // No DLL listing on Linux - return empty
  return [];
}

// --- Windows Task Scheduler ---

function GetTasks() {
  // No Windows Task Scheduler on Linux
  const err = new Error('Task Scheduler not available on Linux');
  err.code = 'ENOENT';
  throw err;
}

function RunTask(taskName) {
  // No-op
  const err = new Error('Task Scheduler not available on Linux');
  err.code = 'ENOENT';
  throw err;
}

// --- File Locking (used by wholocks module) ---

function WhoLocks(filePath) {
  // Use lsof to find processes locking a file on Linux
  try {
    const result = execSync(`lsof -t "${filePath}" 2>/dev/null`, { encoding: 'utf8' });
    const pids = result.trim().split('\n').filter(Boolean);
    return pids.map(pid => {
      try {
        const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
        return { appName: comm, pid: parseInt(pid, 10) };
      } catch (e) {
        return { appName: 'unknown', pid: parseInt(pid, 10) };
      }
    });
  } catch (err) {
    return [];
  }
}

// --- File Version Info (used by exe-version module) ---

function GetFileVersionInfo(filePath) {
  // Parse VS_FIXEDFILEINFO from a Windows PE binary on Linux
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = (size) => { const b = Buffer.alloc(size); return b; };

    // DOS header - get PE offset
    const dosHeader = buf(64);
    fs.readSync(fd, dosHeader, 0, 64, 0);
    if (dosHeader.readUInt16LE(0) !== 0x5A4D) {
      fs.closeSync(fd);
      throw new Error('Not a PE file');
    }
    const peOffset = dosHeader.readUInt32LE(60);

    // PE signature + COFF header
    const peHeader = buf(24);
    fs.readSync(fd, peHeader, 0, 24, peOffset);
    const numSections = peHeader.readUInt16LE(6);
    const optHeaderSize = peHeader.readUInt16LE(20);

    // Optional header - get resource directory RVA
    const optHeader = buf(optHeaderSize);
    fs.readSync(fd, optHeader, 0, optHeaderSize, peOffset + 24);
    const magic = optHeader.readUInt16LE(0);
    // PE32: data dirs at offset 96, PE32+: at offset 112
    const ddOffset = magic === 0x20B ? 112 : 96;
    // Resource table is data directory index 2
    const resourceRVA = optHeader.readUInt32LE(ddOffset + 2 * 8);
    const resourceSize = optHeader.readUInt32LE(ddOffset + 2 * 8 + 4);

    if (resourceRVA === 0) {
      fs.closeSync(fd);
      throw new Error('No resource section');
    }

    // Read section headers to find resource section file offset
    const sectionsOffset = peOffset + 24 + optHeaderSize;
    const sections = buf(numSections * 40);
    fs.readSync(fd, sections, 0, numSections * 40, sectionsOffset);

    let rsrcFileOffset = 0;
    let rsrcVA = 0;
    for (let i = 0; i < numSections; i++) {
      const sVA = sections.readUInt32LE(i * 40 + 12);
      const sSize = sections.readUInt32LE(i * 40 + 16);
      const sRaw = sections.readUInt32LE(i * 40 + 20);
      if (resourceRVA >= sVA && resourceRVA < sVA + sSize) {
        rsrcFileOffset = sRaw;
        rsrcVA = sVA;
        break;
      }
    }

    if (rsrcFileOffset === 0) {
      fs.closeSync(fd);
      throw new Error('Resource section not found');
    }

    const rvaToFile = (rva) => rsrcFileOffset + (rva - rsrcVA);

    // Walk resource directory: Type -> Name -> Language
    // VS_VERSION_INFO type ID = 16 (RT_VERSION)
    function readResDir(filePos) {
      const dir = buf(16);
      fs.readSync(fd, dir, 0, 16, filePos);
      const numNamed = dir.readUInt16LE(12);
      const numId = dir.readUInt16LE(14);
      const entries = [];
      for (let i = 0; i < numNamed + numId; i++) {
        const entry = buf(8);
        fs.readSync(fd, entry, 0, 8, filePos + 16 + i * 8);
        entries.push({
          id: entry.readUInt32LE(0),
          offsetOrData: entry.readUInt32LE(4),
        });
      }
      return entries;
    }

    // Find RT_VERSION (16)
    const rootEntries = readResDir(rsrcFileOffset);
    const versionEntry = rootEntries.find((e) => (e.id & 0xFFFF) === 16);
    if (!versionEntry) {
      fs.closeSync(fd);
      throw new Error('No version resource');
    }

    // Walk to data: level 2
    const l2Entries = readResDir(rsrcFileOffset + (versionEntry.offsetOrData & 0x7FFFFFFF));
    if (l2Entries.length === 0) {
      fs.closeSync(fd);
      throw new Error('No version entries');
    }

    // Level 3 (language)
    const l3Entries = readResDir(rsrcFileOffset + (l2Entries[0].offsetOrData & 0x7FFFFFFF));
    if (l3Entries.length === 0) {
      fs.closeSync(fd);
      throw new Error('No version language entries');
    }

    // Data entry (not a directory)
    const dataEntry = buf(16);
    fs.readSync(fd, dataEntry, 0, 16, rsrcFileOffset + l3Entries[0].offsetOrData);
    const dataRVA = dataEntry.readUInt32LE(0);
    const dataSize = dataEntry.readUInt32LE(4);

    // Read the version resource data
    const versionData = buf(Math.min(dataSize, 4096));
    fs.readSync(fd, versionData, 0, versionData.length, rvaToFile(dataRVA));
    fs.closeSync(fd);

    // Find VS_FIXEDFILEINFO signature (0xFEEF04BD)
    let fixedInfoOffset = -1;
    for (let i = 0; i < versionData.length - 52; i += 4) {
      if (versionData.readUInt32LE(i) === 0xFEEF04BD) {
        fixedInfoOffset = i;
        break;
      }
    }

    if (fixedInfoOffset === -1) {
      throw new Error('VS_FIXEDFILEINFO signature not found');
    }

    const fileVersionMS = versionData.readUInt32LE(fixedInfoOffset + 8);
    const fileVersionLS = versionData.readUInt32LE(fixedInfoOffset + 12);
    const productVersionMS = versionData.readUInt32LE(fixedInfoOffset + 16);
    const productVersionLS = versionData.readUInt32LE(fixedInfoOffset + 20);

    const fileVersion = [
      (fileVersionMS >>> 16) & 0xFFFF,
      fileVersionMS & 0xFFFF,
      (fileVersionLS >>> 16) & 0xFFFF,
      fileVersionLS & 0xFFFF,
    ];
    const productVersion = [
      (productVersionMS >>> 16) & 0xFFFF,
      productVersionMS & 0xFFFF,
      (productVersionLS >>> 16) & 0xFFFF,
      productVersionLS & 0xFFFF,
    ];

    return {
      fileVersion,
      productVersion,
      fileVersionString: fileVersion.join('.'),
      productVersionString: productVersion.join('.'),
    };
  } catch (err) {
    return {
      fileVersion: [0, 0, 0, 0],
      productVersion: [0, 0, 0, 0],
      fileVersionString: '0.0.0.0',
      productVersionString: '0.0.0.0',
    };
  }
}

// --- File ACL (used by permissions module) ---

function AddFileACE(ace, target) {
  // ACLs are Windows-only. On Linux, permissions are handled by chmod/chown
  // The permissions module already falls back to chmod on non-Windows
}

const Access = {
  Grant: function(user, rights) {
    return { type: 'grant', user, rights };
  },
  Deny: function(user, rights) {
    return { type: 'deny', user, rights };
  },
};

// --- System Shutdown ---

function InitiateSystemShutdown(message, timeout, forceClose) {
  try {
    execSync(`shutdown -h +${Math.ceil((timeout || 30) / 60)} "${message || ''}"`, { encoding: 'utf8' });
  } catch (err) {
    // Requires root - ignore
  }
}

function AbortSystemShutdown() {
  try {
    execSync('shutdown -c', { encoding: 'utf8' });
  } catch (err) {
    // Ignore
  }
}

// --- INI File Functions (used by vortex-parse-ini WinapiFormat) ---

function parseIniFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const sections = {};
    let currentSection = '';
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentSection = trimmed.slice(1, -1);
        if (!sections[currentSection]) {
          sections[currentSection] = {};
        }
      } else if (currentSection && trimmed && !trimmed.startsWith(';') && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const value = trimmed.slice(eqIdx + 1).trim();
          sections[currentSection][key] = value;
        }
      }
    }
    return sections;
  } catch (err) {
    return {};
  }
}

function GetPrivateProfileSectionNames(filePath) {
  const sections = parseIniFile(filePath);
  return Object.keys(sections);
}

function GetPrivateProfileSection(section, filePath) {
  const sections = parseIniFile(filePath);
  return sections[section] || {};
}

function WritePrivateProfileString(section, key, value, filePath) {
  let sections = parseIniFile(filePath);
  if (value === null || value === undefined) {
    // Delete the key
    if (sections[section]) {
      delete sections[section][key];
    }
  } else {
    if (!sections[section]) {
      sections[section] = {};
    }
    sections[section][key] = value;
  }
  // Write back
  let output = '';
  for (const [sec, keys] of Object.entries(sections)) {
    output += `[${sec}]\r\n`;
    for (const [k, v] of Object.entries(keys)) {
      output += `${k}=${v}\r\n`;
    }
    output += '\r\n';
  }
  fs.writeFileSync(filePath, output, 'utf8');
}

// --- Exports ---
// Support both: import * as winapi / import winapi from / import { Fn } from / require()

module.exports = {
  RegGetValue,
  WithRegOpen,
  RegEnumKeys,
  RegEnumValues,
  GetNativeArch,
  GetDiskFreeSpaceEx,
  GetVolumePathName,
  GetProcessList,
  GetProcessWindowList,
  SetForegroundWindow,
  IsThisWine,
  ShellExecuteEx,
  CheckYourPrivilege,
  GetUserSID,
  SupportsAppContainer,
  SetProcessPreferredUILanguages,
  GetModuleList,
  GetTasks,
  RunTask,
  InitiateSystemShutdown,
  AbortSystemShutdown,
  WhoLocks,
  GetFileVersionInfo,
  AddFileACE,
  Access,
  GetPrivateProfileSectionNames,
  GetPrivateProfileSection,
  WritePrivateProfileString,
};

// Support ES module default import
module.exports.default = module.exports;

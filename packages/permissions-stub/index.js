'use strict';

const fs = require('fs');
const { execSync } = require('child_process');

function getUserId() {
  return String(process.getuid ? process.getuid() : 1000);
}

function allow(filePath, scope, permissions) {
  // Map scope + permissions to chmod
  try {
    const modeMap = { 'r': 4, 'w': 2, 'x': 1 };
    let mode = 0;
    for (const c of permissions) {
      mode += modeMap[c] || 0;
    }
    // scope: 'user' = owner, 'group' = group, 'everyone' = others
    let chmodStr;
    if (scope === 'group') {
      chmodStr = `g+${permissions}`;
    } else if (scope === 'everyone') {
      chmodStr = `o+${permissions}`;
    } else {
      chmodStr = `u+${permissions}`;
    }
    execSync(`chmod ${chmodStr} "${filePath}"`, { encoding: 'utf8' });
  } catch (err) {
    // Best effort
  }
}

module.exports = { getUserId, allow };
module.exports.default = module.exports;

'use strict';

// Linux stub - games run through Proton, so .exe version detection is less reliable
// Return 0.0.0 which callers handle as "unknown version"
function exeVersion(exePath) {
  return '0.0.0';
}

module.exports = exeVersion;
module.exports.default = exeVersion;

'use strict';

// Linux stub - crash dumps are Windows-only (minidump format)
function crashDump(dumpPath, callback) {
  // Return a deinit function (no-op)
  return function deinit() {};
}

module.exports = crashDump;
module.exports.default = crashDump;

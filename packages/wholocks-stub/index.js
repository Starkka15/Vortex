'use strict';

// Linux stub - returns empty process list for file locks
// On Linux, use lsof or fuser instead (but callers handle empty gracefully)
function wholocks(filePath) {
  return [];
}

module.exports = wholocks;
module.exports.default = wholocks;

'use strict';

// Linux stub - native error hooks are Windows-only
module.exports = {
  InitHook: function() {},
  GetLastError: function() {
    return { code: 0, message: '' };
  },
};

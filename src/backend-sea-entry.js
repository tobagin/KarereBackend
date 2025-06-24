#!/usr/bin/env node
// backend-sea-entry.js
// SEA-specific entry point that uses only SEA-compatible modules

console.log('🚀 Starting Karere Backend as Single Executable Application');
console.log(`📦 Node.js version: ${process.version}`);
console.log(`🏗️  Architecture: ${process.arch}`);
console.log(`💻 Platform: ${process.platform}`);

// Override the database module to use SEA-compatible version
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
    // Redirect database.js to database-sea.js for SEA compatibility
    if (id === './database.js') {
        return originalRequire.call(this, './database-sea.js');
    }
    return originalRequire.call(this, id);
};

// Now require the main backend which will use the SEA-compatible database
require('./backend.js');

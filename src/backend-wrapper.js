#!/usr/bin/env node
// CommonJS wrapper for the ES module backend
// This file is used by pkg to properly handle ES modules

(async function startBackend() {
    try {
        // Set NODE_OPTIONS to enable ES modules
        process.env.NODE_OPTIONS = '--experimental-modules --es-module-specifier-resolution=node';

        // Dynamically import the ES module
        const backend = await import('./backend.js');
        // The backend should auto-initialize when imported
    } catch (error) {
        console.error('Failed to start backend:', error);
        console.error('Error details:', error.message);
        process.exit(1);
    }
})();

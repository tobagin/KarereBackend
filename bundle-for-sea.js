#!/usr/bin/env node
// Bundle script for SEA - creates a single file with all dependencies

import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';

async function bundleForSEA() {
  try {
    console.log('🔨 Bundling application for SEA...');

    // Create a bundled version of the backend (main backend with SEA detection)
    const result = await build({
      entryPoints: ['src/backend.js'],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: 'dist/backend-bundled.js',
      external: [
        // Keep Node.js built-in modules external
        'fs', 'path', 'crypto', 'os', 'util', 'events', 'stream', 'buffer',
        'url', 'querystring', 'zlib', 'http', 'https', 'net', 'tls', 'dns',
        'child_process', 'cluster', 'worker_threads', 'perf_hooks', 'async_hooks',
        'inspector', 'readline', 'repl', 'vm', 'v8', 'timers', 'console',
        'process', 'module', 'assert', 'string_decoder', 'punycode',
        // Exclude problematic native dependencies
        'sharp', 'jimp', 'link-preview-js', 'sqlite3'
      ],
      banner: {
        js: '// Bundled Karere Backend for SEA\n'
      },
      minify: false, // Keep readable for debugging
      sourcemap: false,
      logLevel: 'info'
    });

    if (result.errors.length > 0) {
      console.error('❌ Bundle errors:', result.errors);
      process.exit(1);
    }

    if (result.warnings.length > 0) {
      console.warn('⚠️  Bundle warnings:', result.warnings);
    }

    // Make the bundled file executable
    fs.chmodSync('dist/backend-bundled.js', '755');

    const bundleSize = fs.statSync('dist/backend-bundled.js').size;
    console.log(`✅ Bundle created: dist/backend-bundled.js (${Math.round(bundleSize / 1024)} KB)`);

  } catch (error) {
    console.error('❌ Bundling failed:', error);
    process.exit(1);
  }
}

bundleForSEA();

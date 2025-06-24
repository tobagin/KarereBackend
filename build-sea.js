#!/usr/bin/env node
// Node.js 24.2.0 Single Executable Application (SEA) build script
// Based on official Node.js SEA documentation

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get target architecture from command line or use current
const targetArch = process.argv[2] || process.arch;
// Allow platform override from environment variable (for CI cross-compilation)
const PLATFORM = process.env.PLATFORM || process.platform;

console.log(`🚀 Building SEA for ${PLATFORM}-${targetArch} using Node.js ${process.version}`);

// Function to download Node.js binary for cross-compilation
async function downloadNodeBinary(platform, arch, version) {
  const nodeVersion = version || process.version;
  const fileName = platform === 'win32' ? 'node.exe' : 'node';
  const archMap = { x64: 'x64', arm64: 'arm64' };
  const platformMap = { linux: 'linux', darwin: 'darwin', win32: 'win' };
  
  const mappedPlatform = platformMap[platform];
  const mappedArch = archMap[arch];
  
  if (!mappedPlatform || !mappedArch) {
    throw new Error(`Unsupported platform/arch combination: ${platform}-${arch}`);
  }
  
  const url = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-${mappedPlatform}-${mappedArch}.tar.gz`;
  const downloadPath = `node-${nodeVersion}-${mappedPlatform}-${mappedArch}.tar.gz`;
  const extractPath = `node-${nodeVersion}-${mappedPlatform}-${mappedArch}`;
  const binaryPath = path.join(extractPath, 'bin', fileName);
  
  // Check if we already have the binary
  if (fs.existsSync(binaryPath)) {
    console.log(`✅ Using cached Node.js binary: ${binaryPath}`);
    return binaryPath;
  }
  
  console.log(`📥 Downloading Node.js ${nodeVersion} for ${mappedPlatform}-${mappedArch}...`);
  
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(downloadPath);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`📦 Extracting Node.js binary...`);
        
        try {
          // Extract the tar.gz file
          execSync(`tar -xzf ${downloadPath}`, { stdio: 'inherit' });
          
          // Verify the binary exists
          if (!fs.existsSync(binaryPath)) {
            reject(new Error(`Node.js binary not found at ${binaryPath}`));
            return;
          }
          
          // Make it executable
          fs.chmodSync(binaryPath, '755');
          
          // Cleanup download
          fs.unlinkSync(downloadPath);
          
          console.log(`✅ Node.js binary ready: ${binaryPath}`);
          resolve(binaryPath);
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

async function buildSEA() {
  try {
    // Step 1: Create SEA configuration (using bundled backend)
    const seaConfig = {
      main: 'dist/backend-bundled.js',  // Bundled version
      output: 'sea-prep.blob',
      disableExperimentalSEAWarning: true,
      useSnapshot: false,  // Disable for cross-platform compatibility
      useCodeCache: false  // Disable for cross-platform compatibility
    };

    console.log('📝 Creating SEA configuration...');
    fs.writeFileSync('sea-config.json', JSON.stringify(seaConfig, null, 2));

    // Step 2: Generate the SEA blob
    console.log('🔨 Generating SEA blob...');
    execSync('node --experimental-sea-config sea-config.json', { 
      stdio: 'inherit'
    });

    // Verify blob was created
    if (!fs.existsSync('sea-prep.blob')) {
      throw new Error('SEA blob was not created');
    }

    const blobSize = fs.statSync('sea-prep.blob').size;
    console.log(`✅ SEA blob created (${Math.round(blobSize / 1024 / 1024 * 100) / 100} MB)`);

    // Step 3: Create executable name
    const executableName = `karere-backend-${PLATFORM}-${targetArch}${PLATFORM === 'win32' ? '.exe' : ''}`;
    const outputPath = `dist/${executableName}`;
    
    // Ensure dist directory exists
    if (!fs.existsSync('dist')) {
      fs.mkdirSync('dist', { recursive: true });
    }

    // Step 4: Get appropriate Node.js binary
    console.log('📦 Getting Node.js binary...');
    let nodeBinary;
    
    // Check if we need to download a different architecture binary
    const needsCrossCompile = (targetArch !== process.arch) || (PLATFORM !== process.platform);
    
    if (needsCrossCompile) {
      console.log(`🔄 Cross-compiling from ${process.platform}-${process.arch} to ${PLATFORM}-${targetArch}`);
      nodeBinary = await downloadNodeBinary(PLATFORM, targetArch, process.version);
    } else {
      console.log(`📋 Using current Node.js binary for ${PLATFORM}-${targetArch}`);
      nodeBinary = process.execPath;
    }
    
    console.log(`📦 Copying Node.js binary from: ${nodeBinary}`);
    fs.copyFileSync(nodeBinary, outputPath);

    // Step 5: Remove signature (macOS only)
    if (PLATFORM === 'darwin') {
      console.log('🔓 Removing macOS signature...');
      try {
        execSync(`codesign --remove-signature "${outputPath}"`, { stdio: 'inherit' });
      } catch (error) {
        console.warn('⚠️  Could not remove signature (codesign not available)');
      }
    }

    // Step 6: Inject the SEA blob using postject
    console.log('💉 Injecting SEA blob...');
    
    const postjectCmd = PLATFORM === 'darwin' 
      ? `npx postject "${outputPath}" NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA`
      : `npx postject "${outputPath}" NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`;
    
    execSync(postjectCmd, { stdio: 'inherit' });

    // Step 7: Sign the binary (macOS only)
    if (PLATFORM === 'darwin') {
      console.log('🔐 Signing macOS binary...');
      try {
        execSync(`codesign --sign - "${outputPath}"`, { stdio: 'inherit' });
      } catch (error) {
        console.warn('⚠️  Could not sign binary (codesign not available)');
      }
    }

    // Step 8: Make executable (Unix-like systems)
    if (PLATFORM !== 'win32') {
      fs.chmodSync(outputPath, '755');
    }

    const finalSize = fs.statSync(outputPath).size;
    console.log(`🎉 Build completed successfully!`);
    console.log(`📁 Output: ${outputPath}`);
    console.log(`📏 Size: ${Math.round(finalSize / 1024 / 1024 * 100) / 100} MB`);

    // Step 9: Cleanup
    console.log('🧹 Cleaning up temporary files...');
    ['sea-prep.blob', 'sea-config.json'].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
    
    // Cleanup downloaded Node.js binaries (keep them for future builds)
    // Note: We keep the downloaded binaries to avoid re-downloading for subsequent builds

    console.log('✨ SEA build process completed!');

  } catch (error) {
    console.error('❌ Build failed:', error.message);
    
    // Cleanup on error
    ['sea-prep.blob', 'sea-config.json'].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
    
    // Note: We keep downloaded Node.js binaries even on error for future builds
    
    process.exit(1);
  }
}

// Run the build
buildSEA();

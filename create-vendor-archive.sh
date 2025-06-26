#!/bin/bash

# Script to create a vendored dependencies archive for Flatpak
# This follows the Flathub-approved vendoring approach

set -e

VERSION="v0.2.7"
ARCHIVE_NAME="karere-backend-node-modules-${VERSION}.tar.gz"

echo "🏗️  Creating vendored dependencies archive for ${VERSION}"

# Ensure we have a clean node_modules
if [ ! -d "node_modules" ]; then
    echo "❌ node_modules directory not found. Run 'npm install' first."
    exit 1
fi

# Create the archive
echo "📦 Creating archive: ${ARCHIVE_NAME}"
tar -czf "${ARCHIVE_NAME}" node_modules/ package-lock.json

# Get file size and checksum
FILE_SIZE=$(stat -c%s "${ARCHIVE_NAME}")
SHA256=$(sha256sum "${ARCHIVE_NAME}" | cut -d' ' -f1)

echo "✅ Archive created successfully!"
echo ""
echo "📊 Archive details:"
echo "   File: ${ARCHIVE_NAME}"
echo "   Size: ${FILE_SIZE} bytes"
echo "   SHA256: ${SHA256}"
echo ""
echo "🚀 Next steps:"
echo "1. Upload this archive to a GitHub release or stable hosting"
echo "2. Update the Flatpak manifest to use this archive"
echo "3. Replace the npm install step with archive extraction"
echo ""
echo "📋 Flatpak manifest snippet:"
echo "{"
echo "  \"type\": \"archive\","
echo "  \"url\": \"https://github.com/your-repo/releases/download/${VERSION}/${ARCHIVE_NAME}\","
echo "  \"sha256\": \"${SHA256}\","
echo "  \"dest\": \"KarereBackend\""
echo "}"

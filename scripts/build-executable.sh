#!/bin/bash
# Build executable for current platform

set -e

# Detect platform
ARCH=$(uname -m)
OS=$(uname -s)

case $OS in
    Linux)
        case $ARCH in
            x86_64) TARGET="node18-linux-x64" ;;
            aarch64) TARGET="node18-linux-arm64" ;;
            *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
        esac
        ;;
    Darwin)
        case $ARCH in
            x86_64) TARGET="node18-macos-x64" ;;
            arm64) TARGET="node18-macos-arm64" ;;
            *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
        esac
        ;;
    *)
        echo "Unsupported OS: $OS"
        exit 1
        ;;
esac

echo "Building for target: $TARGET"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Install pkg if not available
if ! command -v pkg &> /dev/null; then
    echo "Installing pkg..."
    npm install -g pkg
fi

# Build executable
echo "Building executable..."
pkg . --target $TARGET --output karere-backend

echo "Build complete: karere-backend"

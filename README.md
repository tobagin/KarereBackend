# Karere Backend

WhatsApp backend for Karere using the Baileys library. This backend provides a standalone executable that can be used by the Karere frontend.

## Features

- Native WhatsApp Web API integration using Baileys
- Standalone executable (no Node.js runtime required)
- Cross-platform support (Linux, Windows, macOS)
- Multiple architectures (x64, ARM64)
- WebSocket API for frontend communication
- SQLite database for message persistence
- QR code authentication

## Building

### Prerequisites

- Node.js 18 or later
- npm

### Build for current platform

```bash
./scripts/build-executable.sh
```

### Build for specific platforms

```bash
# Install dependencies
npm install

# Install pkg
npm install -g pkg

# Build for Linux
npm run build:linux

# Build for Windows
npm run build:windows

# Build for macOS
npm run build:macos

# Build for all platforms
npm run build
```

## Usage

The executable can be run directly:

```bash
./karere-backend
```

It will start a WebSocket server on port 8080 by default and handle WhatsApp connections.

## API

The backend provides a WebSocket API for communication with the frontend. See the main Karere repository for frontend integration details.

## License

MIT License

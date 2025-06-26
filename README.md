# Karere Backend

WhatsApp backend for Karere using the Baileys library. This backend provides a Node.js application that can be used by the Karere frontend.

## Features

- Native WhatsApp Web API integration using Baileys
- Node.js application with vendored dependencies for Flatpak
- Cross-platform support (Linux, Windows, macOS)
- Multiple architectures (x64, ARM64)
- WebSocket API for frontend communication
- SQLite database for message persistence
- QR code authentication
- XDG Base Directory Specification compliance for Flatpak

## Development

### Prerequisites

- Node.js 24.2.0 or later
- npm

### Setup

```bash
# Install dependencies
npm install

# Start the backend
npm start
```

## Usage

The backend can be run directly with Node.js:

```bash
node src/backend.js
```

It will start a WebSocket server on port 8765 by default and handle WhatsApp connections.

## API

The backend provides a WebSocket API for communication with the frontend. See the main Karere repository for frontend integration details.

## License

MIT License

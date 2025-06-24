#!/usr/bin/env node
// backend-cjs.js
// CommonJS version of the Karere backend for pkg compatibility

const { Boom } = require('@hapi/boom');
const baileys = require('@whiskeysockets/baileys');
const P = require('pino');
const { WebSocketServer } = require('ws');
const qrcode = require('qrcode');
const fs = require('fs').promises;

// Import enhanced modules (will need to convert these too)
const { log, errorHandler, performance } = require('./logger-cjs.js');
const database = require('./database-cjs.js');
const serviceManager = require('./service-manager-cjs.js');

const makeWASocket = baileys.default;
const {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers
} = baileys;

// Configuration
const PORT = process.env.PORT || 8765;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000; // 5 seconds

// Global state
let clientSocket = null;
let initialChatsPayload = null;
let baileysConnectionStatus = 'closed';
let sock = null;
let clientIsWaitingForChats = false;
let reconnectAttempts = 0;
let isInitialized = false;

// WebSocket server with enhanced error handling
let wss = null;

// Initialize the backend
async function initializeBackend() {
    if (isInitialized) {
        log.warn('Backend already initialized');
        return;
    }

    try {
        log.info('Starting Karere Backend initialization');

        // Initialize service manager
        await serviceManager.initialize();

        // Initialize database
        await database.initialize();
        serviceManager.registerService('database', database);

        // Initialize WebSocket server
        await initializeWebSocketServer();
        serviceManager.registerService('websocket', { shutdown: closeWebSocketServer });

        // Initialize WhatsApp connection
        await connectToWhatsApp();

        isInitialized = true;
        log.info('Karere Backend initialized successfully');

    } catch (error) {
        log.error('Failed to initialize backend', error);
        process.exit(1);
    }
}

async function initializeWebSocketServer() {
    const timer = performance.start('websocket_server_init');

    try {
        wss = new WebSocketServer({
            port: PORT,
            perMessageDeflate: false // Disable compression for better performance
        });

        wss.on('connection', handleWebSocketConnection);
        wss.on('error', (error) => {
            log.error('WebSocket server error', error);
        });

        timer.end();
        log.info(`WebSocket server started on ws://localhost:${PORT}`);

    } catch (error) {
        timer.end({ error: true });
        throw errorHandler.websocket(error, 'server initialization');
    }
}

async function closeWebSocketServer() {
    if (wss) {
        return new Promise((resolve) => {
            wss.close(() => {
                log.info('WebSocket server closed');
                resolve();
            });
        });
    }
}

function getDisplayMessage(msg) {
    if (!msg) return '';

    // Handle both regular messages and history messages
    // History messages have structure: msg.message.message.conversation
    // Regular messages have structure: msg.message.conversation
    let messageObj = msg.message;

    // If this is a history message, unwrap the nested structure
    if (messageObj && messageObj.message) {
        messageObj = messageObj.message;
    }

    if (!messageObj) return '';

    // Handle different message types
    if (messageObj.conversation) return messageObj.conversation;
    if (messageObj.extendedTextMessage) return messageObj.extendedTextMessage.text;
    if (messageObj.imageMessage) return messageObj.imageMessage.caption || '[Image]';
    if (messageObj.videoMessage) return messageObj.videoMessage.caption || '[Video]';
    if (messageObj.audioMessage) return '[Audio]';
    if (messageObj.documentMessage) return messageObj.documentMessage.title || '[Document]';
    if (messageObj.stickerMessage) return '[Sticker]';
    if (messageObj.locationMessage) return '[Location]';
    if (messageObj.contactMessage) return '[Contact]';

    return '[Unsupported Message]';
}

function handleWebSocketConnection(ws) {
    const timer = performance.start('websocket_connection');

    log.websocket('Frontend client connected');
    clientSocket = ws;

    // Send ready signal if Baileys is already connected
    if (baileysConnectionStatus === 'open') {
        log.websocket('Frontend connected while Baileys is ready. Sending ready signal.');
        sendToFrontend('baileys_ready', {});
    }

    ws.on('message', async (message) => {
        const messageTimer = performance.start('websocket_message_processing');

        try {
            const parsedMessage = JSON.parse(message);
            log.websocket('Received command from frontend', { type: parsedMessage.type });

            await handleFrontendCommand(parsedMessage);

            messageTimer.end({ type: parsedMessage.type });

        } catch (error) {
            messageTimer.end({ error: true });
            const errorResponse = errorHandler.websocket(error, 'message processing');
            sendToFrontend('error', errorResponse);
        }
    });

    ws.on('close', (code, reason) => {
        clientSocket = null;
        clientIsWaitingForChats = false;
        timer.end();
        log.websocket('Frontend client disconnected', { code, reason: reason?.toString() });
    });

    ws.on('error', (error) => {
        const errorResponse = errorHandler.websocket(error, 'connection');
        log.websocket('WebSocket connection error', errorResponse);
    });
}

// Start the backend if this file is run directly
if (require.main === module) {
    initializeBackend().catch(error => {
        console.error('Failed to start backend:', error);
        process.exit(1);
    });
}

// Export for use as a module
module.exports = {
    initializeBackend,
    closeWebSocketServer
};

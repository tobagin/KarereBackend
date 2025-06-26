#!/usr/bin/env node
// backend.js
// Enhanced Karere backend with comprehensive error handling, logging, and persistence

const { Boom } = require('@hapi/boom');
const baileys = require('@whiskeysockets/baileys');
const P = require('pino');
const { WebSocketServer } = require('ws');
const qrcode = require('qrcode');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Import enhanced modules
const { log, errorHandler, performance } = require('./logger.js');
// Use fallback database when SQLite3 is not available (e.g., in Flatpak without native modules)
let database;
try {
    // Try to require sqlite3 to see if it's available
    require('sqlite3');
    database = require('./database.js');
    log.info('Using SQLite database');
} catch (error) {
    // If sqlite3 is not available, use file-based database
    database = require('./database-fallback.js');
    log.info('Using file-based database (SQLite3 not available)');
}
const serviceManager = require('./service-manager.js');

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

// Determine the appropriate auth directory based on environment
function getAuthDirectory() {
    // In Flatpak, use XDG_DATA_HOME for persistent auth data
    if (process.env.FLATPAK_ID) {
        return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share', 'karere'), 'baileys_auth_info');
    }

    // For development/standalone, use local auth directory
    return 'baileys_auth_info';
}

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

async function handleFrontendCommand(parsedMessage) {
    const { type, data } = parsedMessage;

    switch (type) {
        case 'get_initial_chats':
            await handleGetInitialChats();
            break;

        case 'send_message':
            await handleSendMessage(data);
            break;

        case 'get_message_history':
            await handleGetMessageHistory(data);
            break;

        case 'typing_start':
            await handleTypingStart(data);
            break;

        case 'typing_stop':
            await handleTypingStop(data);
            break;

        case 'health_check':
            await handleHealthCheck();
            break;

        case 'sync_contacts':
            await handleSyncContacts();
            break;

        case 'get_contact_info':
            await handleGetContactInfo(data);
            break;

        default:
            log.warn('Unknown command type', { type });
            sendToFrontend('error', {
                type: 'unknown_command',
                message: `Unknown command: ${type}`
            });
    }
}

async function handleGetInitialChats() {
    try {
        if (initialChatsPayload) {
            log.info('Client requested chats. Sending cached list.');
            sendToFrontend('initial_chats', initialChatsPayload);
        } else {
            // Try to load from database
            const dbChats = await database.getChats();
            if (dbChats.length > 0) {
                const chats = dbChats.map(chat => ({
                    jid: chat.jid,
                    name: chat.contact_name || chat.name || chat.jid, // Prefer contact name
                    lastMessage: formatLastMessageContent(chat.last_message_content, chat.last_message_type || 'text'),
                    timestamp: chat.last_message_timestamp,
                    lastMessageType: chat.last_message_type || 'text',
                    lastMessageFrom: chat.last_message_from,
                    unreadCount: chat.unread_count || 0,
                    avatarBase64: chat.contact_avatar_base64, // Contact avatar
                    chatAvatarBase64: chat.avatar_base64, // Chat-specific avatar (for groups)
                    phoneNumber: chat.contact_phone_number
                }));

                sendToFrontend('initial_chats', { chats });
                log.info('Sent chats from database', { count: chats.length });
            } else {
                log.info('Cache is empty, setting client waiting flag to true.');
                clientIsWaitingForChats = true;
            }
        }
    } catch (error) {
        const errorResponse = errorHandler.database(error, 'get initial chats');
        sendToFrontend('error', errorResponse);
    }
}

function sendToFrontend(type, data) {
    try {
        if (clientSocket && clientSocket.readyState === clientSocket.OPEN) {
            const message = JSON.stringify({ type, data });
            clientSocket.send(message);
            log.websocket('Sent message to frontend', { type, dataSize: message.length });
        } else {
            log.warn('Cannot send to frontend: no active connection', { type });
        }
    } catch (error) {
        log.error('Error sending message to frontend', error, { type });
    }
}

async function handleSendMessage(data) {
    const timer = performance.start('send_message');
    const { to, message } = data;

    try {
        // Validate input
        if (!to || !message) {
            throw new Error('Missing required fields: to, message');
        }

        if (!sock || baileysConnectionStatus !== 'open') {
            throw new Error('Not connected to WhatsApp');
        }

        log.message('Sending message', { to, messageLength: message.length });

        // Generate message ID
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Send message via Baileys
        const sentMessage = await sock.sendMessage(to, { text: message });
        const actualMessageId = sentMessage.key.id;

        // Save to database
        await database.saveMessage(
            actualMessageId,
            to,
            true, // fromMe
            message,
            Date.now(),
            'text',
            'sent'
        );

        // Update chat in database with message details
        await database.saveChat(to, null, actualMessageId, Date.now(), null, 'text', 'me');

        // Confirm message sent
        sendToFrontend('message_sent', {
            to,
            message,
            messageId: actualMessageId,
            timestamp: Date.now()
        });

        timer.end({ to, messageLength: message.length });
        log.message('Message sent successfully', { to, messageId: actualMessageId });

    } catch (error) {
        timer.end({ error: true });
        const errorResponse = errorHandler.messaging(error, 'send message');
        sendToFrontend('message_error', errorResponse);

        // Try to save failed message to database for retry
        try {
            await database.saveMessage(
                `failed_${Date.now()}`,
                to,
                true,
                message,
                Date.now(),
                'text',
                'failed'
            );
        } catch (dbError) {
            log.error('Failed to save failed message to database', dbError);
        }
    }
}

async function handleGetMessageHistory(data) {
    const timer = performance.start('get_message_history');
    const { jid, limit = 50, offset = 0 } = data;

    try {
        log.message('Fetching message history', { jid, limit, offset });

        // Get messages from database with enhanced message data
        let messages = await database.getMessagesWithSender(jid, limit, offset);

        if (messages.length === 0 && sock && baileysConnectionStatus === 'open') {
            // If no messages in database, try to fetch from Baileys directly
            try {
                const baileysMessages = await sock.fetchMessageHistory(jid, limit);

                // Save to database and process
                for (const msg of baileysMessages) {
                    const messageContent = getDisplayMessage(msg);
                    const messageType = getMessageType(msg);
                    if (messageContent || messageType !== 'text') {
                        await database.saveMessage(
                            msg.key.id,
                            jid,
                            msg.key.fromMe,
                            messageContent || '',
                            msg.messageTimestamp * 1000, // Convert to milliseconds
                            messageType,
                            'received',
                            msg.pushName || null
                        );
                    }
                }

                // Get the saved messages with enhanced data
                messages = await database.getMessagesWithSender(jid, limit, offset);

            } catch (baileysError) {
                log.warn('Failed to fetch from Baileys, using database only', baileysError);
            }
        }

        // Process messages for frontend with all required fields
        const processedMessages = messages.map(msg => ({
            id: msg.id,
            content: msg.content,
            timestamp: msg.timestamp,
            type: msg.message_type || 'text',
            from: msg.from_me === 1 ? 'me' : msg.chat_jid, // 'me' if from user, sender JID if from contact
            fromMe: msg.from_me === 1,
            status: msg.status,
            senderName: msg.display_sender_name || (msg.from_me === 1 ? 'You' : null),
            senderAvatar: msg.sender_avatar_base64
        }));

        sendToFrontend('message_history', { jid, messages: processedMessages });

        timer.end({ jid, messageCount: processedMessages.length });
        log.message('Message history sent', { jid, count: processedMessages.length });

    } catch (error) {
        timer.end({ error: true });
        const errorResponse = errorHandler.messaging(error, 'get message history');
        sendToFrontend('message_history_error', errorResponse);
    }
}

async function handleTypingStart(data) {
    const { to } = data;

    try {
        if (sock && baileysConnectionStatus === 'open') {
            await sock.sendPresenceUpdate('composing', to);
            log.debug('Typing indicator started', { to });
        }
    } catch (error) {
        log.error('Failed to send typing indicator', error, { to });
    }
}

async function handleTypingStop(data) {
    const { to } = data;

    try {
        if (sock && baileysConnectionStatus === 'open') {
            await sock.sendPresenceUpdate('paused', to);
            log.debug('Typing indicator stopped', { to });
        }
    } catch (error) {
        log.error('Failed to stop typing indicator', error, { to });
    }
}

async function handleHealthCheck() {
    try {
        const health = await serviceManager.runHealthChecks();
        const status = serviceManager.getStatus();

        sendToFrontend('health_status', {
            ...health,
            backend: status,
            baileys: {
                status: baileysConnectionStatus,
                connected: baileysConnectionStatus === 'open'
            }
        });

        log.debug('Health check completed', health);

    } catch (error) {
        const errorResponse = errorHandler.generic(error, 'health check');
        sendToFrontend('health_error', errorResponse);
    }
}

async function handleSyncContacts() {
    const timer = performance.start('sync_contacts_manual');

    try {
        log.info('Manual contact synchronization requested');

        if (!sock || baileysConnectionStatus !== 'open') {
            throw new Error('Not connected to WhatsApp');
        }

        // Get all contacts that need syncing
        const chats = await database.getChats(200);
        let syncedCount = 0;
        let errorCount = 0;

        sendToFrontend('sync_contacts_started', { totalChats: chats.length });

        for (const chat of chats) {
            try {
                const jid = chat.jid;
                // Avatar sync removed - using base64 only now

                // Send progress update every 10 contacts
                if ((syncedCount + errorCount) % 10 === 0) {
                    sendToFrontend('sync_contacts_progress', {
                        processed: syncedCount + errorCount,
                        synced: syncedCount,
                        total: chats.length
                    });
                }

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 200));

            } catch (contactError) {
                errorCount++;
                log.debug('Failed to sync contact', {
                    jid: chat.jid,
                    error: contactError.message
                });
            }
        }

        timer.end({ syncedCount, errorCount });

        sendToFrontend('sync_contacts_completed', {
            syncedCount,
            errorCount,
            totalProcessed: chats.length
        });

        log.info('Manual contact synchronization completed', {
            syncedCount,
            errorCount
        });

    } catch (error) {
        timer.end({ error: true });
        const errorResponse = errorHandler.generic(error, 'sync contacts');
        sendToFrontend('sync_contacts_error', errorResponse);
    }
}

async function handleGetContactInfo(data) {
    const timer = performance.start('get_contact_info');
    const { jid } = data;

    try {
        if (!jid) {
            throw new Error('Missing required field: jid');
        }

        log.debug('Getting contact info', { jid });

        // Get contact from database
        const contact = await database.getContact(jid);

        // Get chat info
        const chat = await database.getChatWithContact(jid);

        // Get avatar base64 data
        let avatarBase64 = contact?.avatar_base64;

        const contactInfo = {
            jid,
            name: contact?.name || chat?.contact_name || chat?.name || jid,
            phoneNumber: contact?.phone_number || chat?.contact_phone_number,
            avatarBase64: avatarBase64,
            isBlocked: contact?.is_blocked || false,
            lastSeen: chat?.last_message_timestamp,
            messageCount: 0 // Could be enhanced to count messages
        };

        sendToFrontend('contact_info', { jid, contactInfo });

        timer.end({ jid, hasAvatar: !!avatarBase64 });
        log.debug('Contact info sent', { jid, hasAvatar: !!avatarBase64 });

    } catch (error) {
        timer.end({ error: true });
        const errorResponse = errorHandler.generic(error, 'get contact info');
        sendToFrontend('contact_info_error', { jid, error: errorResponse });
    }
}

async function connectToWhatsApp() {
    const timer = performance.start('whatsapp_connection');

    try {
        log.baileys('Initializing WhatsApp connection');

        const authDir = getAuthDirectory();
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const { version } = await fetchLatestBaileysVersion();
        log.baileys(`Using WhatsApp version ${version.join('.')}`);

        sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            browser: ['Karere', 'Chrome', '1.0.0'], // Use macOS for better history
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            syncFullHistory: true, // Enable full history sync
            markOnlineOnConnect: false, // Keep notifications on phone
            getMessage: async (key) => {
                // Get message from database for message resending and poll decryption
                try {
                    const message = await database.getMessage(key.id);
                    return message ? {
                        key: key,
                        message: JSON.parse(message.content || '{}'),
                        messageTimestamp: message.timestamp
                    } : undefined;
                } catch (error) {
                    log.debug('Failed to get message for key', { keyId: key.id, error: error.message });
                    return undefined;
                }
            }
        });



        sock.ev.on('connection.update', handleConnectionUpdate);
        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('messages.upsert', handleMessagesUpsert);
        sock.ev.on('presence.update', handlePresenceUpdate);
        sock.ev.on('messaging-history.set', handleHistorySet);

        // Debug all events to see what's happening
        sock.ev.on('*', (event, data) => {
            if (event.includes('history') || event.includes('message') || event.includes('chat')) {
                log.debug(`Baileys event: ${event}`, {
                    component: 'baileys',
                    dataKeys: data ? Object.keys(data) : [],
                    dataSize: data ? JSON.stringify(data).length : 0
                });
            }
        });

        timer.end();
        log.baileys('WhatsApp socket initialized successfully');

        return sock;

    } catch (error) {
        timer.end({ error: true });
        const errorResponse = errorHandler.baileys(error, 'connection initialization');

        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            log.warn(`Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${RECONNECT_DELAY}ms`);
            setTimeout(() => connectToWhatsApp(), RECONNECT_DELAY);
        } else {
            log.error('Max reconnection attempts reached');
            sendToFrontend('connection_failed', errorResponse);
        }
    }
}

async function handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    try {
        if (qr) {
            log.baileys('QR Code received, generating image');
            qrcode.toDataURL(qr, (err, url) => {
                if (err) {
                    log.error('Error generating QR code', err);
                    return;
                }
                sendToFrontend('qr', { url });
                log.baileys('QR code sent to frontend');
            });
        }

        baileysConnectionStatus = connection;

        if (connection === 'close') {
            initialChatsPayload = null;
            const statusCode = (lastDisconnect?.error instanceof Boom) ?
                lastDisconnect.error.output.statusCode : 500;
            const reason = lastDisconnect?.error?.message || 'Unknown reason';

            log.baileys('Connection closed', { statusCode, reason });
            sendToFrontend('connection_status', { status: 'closed', reason });

            if (statusCode === DisconnectReason.loggedOut) {
                log.baileys('User logged out from phone, clearing session data');

                // Notify frontend about logout
                sendToFrontend('session_logout', {
                    message: 'You have been logged out from your phone. Please scan the QR code to reconnect.',
                    reason: 'logged_out'
                });

                try {
                    const authDir = getAuthDirectory();
                    await fs.rm(authDir, { recursive: true, force: true });
                    log.baileys('Authentication credentials deleted');
                } catch (e) {
                    log.error('Error deleting auth credentials', e);
                }
                reconnectAttempts = 0; // Reset for fresh start
                setTimeout(() => connectToWhatsApp(), 2000);

            } else if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                log.baileys(`Scheduling reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

                // Notify frontend about connection loss and reconnection attempt
                sendToFrontend('connection_lost', {
                    message: `Connection lost. Attempting to reconnect... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
                    reason: statusCode,
                    attempt: reconnectAttempts,
                    maxAttempts: MAX_RECONNECT_ATTEMPTS
                });

                setTimeout(() => connectToWhatsApp(), RECONNECT_DELAY);
            } else {
                log.error('Max reconnection attempts reached');
                sendToFrontend('connection_failed', {
                    message: 'Failed to reconnect to WhatsApp. Please restart the application.',
                    reason: 'Max reconnection attempts reached'
                });
            }

        } else if (connection === 'open') {
            reconnectAttempts = 0;
            log.baileys('WhatsApp connection is open');
            sendToFrontend('baileys_ready', {});
            sendToFrontend('connection_status', { status: 'open' });

            // Check if this is first login or if we need comprehensive sync
            const isFirstLogin = await isFirstTimeLogin();
            if (isFirstLogin) {
                log.info('First time login detected, starting comprehensive data download');
                sendToFrontend('initial_download_started', { message: 'Downloading your WhatsApp data...' });

                // Try to get chats directly from the socket store first
                await tryFetchChatsFromStore();

                await performComprehensiveDataDownload();
            } else {
                await loadInitialChats();
                // Sync existing chats to update any missing data
                await syncExistingChats();
                // Perform incremental sync for existing data
                await performIncrementalSync();
            }

        } else if (connection === 'connecting') {
            log.baileys('Connecting to WhatsApp...');
            sendToFrontend('connection_status', { status: 'connecting' });
        }

    } catch (error) {
        log.error('Error in connection update handler', error);
    }
}

async function handleHistorySet(item) {
    const timer = performance.start('messaging_history_set_progressive');

    try {
        // Calculate total messages across all chats
        let totalMessages = 0;
        if (item.chats) {
            for (const chat of item.chats) {
                if (chat.messages) {
                    totalMessages += chat.messages.length;
                }
            }
        }

        const currentTime = Date.now();
        const collectionSession = `progressive-sync-${currentTime}`;

        log.baileys('🚀 PROGRESSIVE HISTORY: Received messaging-history.set event', {
            chatCount: item.chats?.length || 0,
            totalMessagesInAllChats: totalMessages,
            isLatest: item.isLatest,
            collectionSession: collectionSession,
            itemKeys: Object.keys(item)
        });

        const chats = [];
        let newChatsCount = 0;
        let existingChatsCount = 0;
        let totalNewMessages = 0;

        for (const chat of item.chats) {
            try {
                // Check if this chat already has a history baseline
                const historyInfo = await database.getChatHistoryInfo(chat.id);
                const isNewChat = !historyInfo || !historyInfo.history_baseline_timestamp;

                const lastMessage = chat.messages?.[0];
                const lastMessageType = lastMessage ? getMessageType(lastMessage) : 'text';
                const lastMessageContent = lastMessage ? getDisplayMessage(lastMessage) : null;
                const lastMessageFrom = lastMessage ? (lastMessage.key.fromMe ? 'me' : chat.id) : null;
                const lastMessageTimestamp = lastMessage ? getMessageTimestamp(lastMessage) : Date.now();

                const chatData = {
                    jid: chat.id,
                    name: chat.name || chat.id,
                    lastMessage: formatLastMessageContent(lastMessageContent, lastMessageType),
                    timestamp: lastMessageTimestamp,
                    lastMessageType: lastMessageType,
                    lastMessageFrom: lastMessageFrom,
                    unreadCount: chat.unreadCount || 0,
                    avatarBase64: null,
                    chatAvatarBase64: null,
                    phoneNumber: null
                };

                chats.push(chatData);

                // Save/update chat in database
                await database.saveChat(
                    chatData.jid,
                    chatData.name,
                    lastMessage?.key?.id,
                    chatData.timestamp,
                    null,
                    lastMessageType,
                    lastMessageFrom
                );

                // Save contact information if available
                if (chat.name && chat.name !== chat.id) {
                    await database.saveContact(chat.id, chat.name);
                }

                if (isNewChat) {
                    // NEW CHAT: Set baseline and save all messages
                    newChatsCount++;

                    if (chat.messages && chat.messages.length > 0) {
                        const oldestMessage = chat.messages[chat.messages.length - 1];
                        const baselineTimestamp = getMessageTimestamp(oldestMessage);

                        // Set history baseline
                        await database.setChatHistoryBaseline(chat.id, baselineTimestamp);

                        log.baileys(`📱 NEW CHAT: ${chat.id} - Setting baseline at ${new Date(baselineTimestamp).toISOString()}`);

                        // Save all messages with initial-sync session
                        const savedCount = await saveMessagesFromHistory(chat, `initial-sync-${currentTime}`);
                        totalNewMessages += savedCount;

                        log.baileys(`✅ NEW CHAT: Saved ${savedCount} messages for ${chat.id}`);
                    }
                } else {
                    // EXISTING CHAT: Only save messages newer than last sync
                    existingChatsCount++;
                    const lastSyncTime = historyInfo.last_sync_timestamp || historyInfo.history_baseline_timestamp;

                    if (chat.messages && chat.messages.length > 0) {
                        // Filter messages newer than last sync
                        const newMessages = chat.messages.filter(msg => {
                            const msgTimestamp = getMessageTimestamp(msg);
                            return msgTimestamp > lastSyncTime;
                        });

                        if (newMessages.length > 0) {
                            log.baileys(`📈 EXISTING CHAT: ${chat.id} - Found ${newMessages.length} new messages since ${new Date(lastSyncTime).toISOString()}`);

                            // Save only new messages
                            const savedCount = await saveMessagesFromHistory({ ...chat, messages: newMessages }, collectionSession);
                            totalNewMessages += savedCount;

                            log.baileys(`✅ EXISTING CHAT: Saved ${savedCount} new messages for ${chat.id}`);
                        } else {
                            log.debug(`📊 EXISTING CHAT: ${chat.id} - No new messages since last sync`);
                        }
                    }
                }

                // Update last sync timestamp for all chats
                await database.updateChatSyncTimestamp(chat.id, currentTime);

            } catch (chatError) {
                log.error(`❌ Error processing chat ${chat.id}`, chatError);
            }
        }

        log.baileys('📊 PROGRESSIVE HISTORY SUMMARY', {
            totalChats: item.chats?.length || 0,
            newChats: newChatsCount,
            existingChats: existingChatsCount,
            totalNewMessages: totalNewMessages,
            collectionSession: collectionSession
        });

        initialChatsPayload = { chats };

        if (clientIsWaitingForChats) {
            log.baileys('Client was waiting for chats, sending now');
            sendToFrontend('initial_chats', initialChatsPayload);
            clientIsWaitingForChats = false;
        }

        timer.end({
            chatCount: chats.length,
            newChats: newChatsCount,
            existingChats: existingChatsCount,
            totalNewMessages: totalNewMessages
        });

    } catch (error) {
        timer.end({ error: true });
        log.error('Error handling progressive history set', error);
    }
}

// Helper function to save messages from history with session tracking
async function saveMessagesFromHistory(chat, collectionSession) {
    let savedMessageCount = 0;
    let skippedMessageCount = 0;

    if (!chat.messages || chat.messages.length === 0) {
        return 0;
    }

    for (const msg of chat.messages) {
        try {
            const messageContent = getDisplayMessage(msg);
            const messageType = getMessageType(msg);
            const messageKey = getMessageKey(msg);
            const timestamp = getMessageTimestamp(msg);

            if (messageKey?.id) {
                await database.saveMessage(
                    messageKey.id,
                    chat.id,
                    messageKey.fromMe || false,
                    messageContent || '[Message content unavailable]',
                    timestamp,
                    messageType,
                    messageKey.fromMe ? 'sent' : 'received',
                    msg.pushName || msg.participant || chat.name || 'Unknown',
                    collectionSession // Add collection session tracking
                );
                savedMessageCount++;

                if (savedMessageCount <= 3) { // Log first few messages for debugging
                    log.debug(`💾 Saved message ${savedMessageCount}: ${messageKey.id} - "${messageContent?.substring(0, 50)}..." [${collectionSession}]`);
                }
            } else {
                skippedMessageCount++;
                log.debug(`⚠️ Skipped message without valid key in chat ${chat.id}`, {
                    hasMessage: !!msg.message,
                    hasKey: !!messageKey,
                    hasId: !!messageKey?.id
                });
            }
        } catch (msgError) {
            skippedMessageCount++;
            log.error('❌ Failed to save message from history', {
                chatId: chat.id,
                messageId: getMessageKey(msg)?.id,
                error: msgError.message,
                collectionSession: collectionSession
            });
        }
    }

    if (savedMessageCount > 0) {
        log.debug(`📊 Chat ${chat.id}: ${savedMessageCount} saved, ${skippedMessageCount} skipped [${collectionSession}]`);
    }

    return savedMessageCount;
}

// Add missing message handling functions
async function handleMessagesUpsert(m) {
    const timer = performance.start('message_upsert');

    try {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const messageContent = getDisplayMessage(msg);
            if (messageContent) {
                // Get contact name from WhatsApp data
                const contactName = msg.pushName || msg.notify || null;
                const jid = msg.key.remoteJid;

                // Save message to database with sender name and real-time session
                await database.saveMessage(
                    msg.key.id,
                    jid,
                    false, // fromMe
                    messageContent,
                    msg.messageTimestamp * 1000,
                    'text',
                    'received',
                    contactName, // Pass sender name
                    'real-time' // Collection session for real-time messages
                );

                // Get updated contact info
                const contact = await database.getContact(jid);

                // Send to frontend with comprehensive message data
                const messageType = getMessageType(msg);
                sendToFrontend('newMessage', {
                    id: msg.key.id,
                    content: messageContent,
                    timestamp: msg.messageTimestamp * 1000,
                    type: messageType,
                    from: msg.key.fromMe ? 'me' : jid,
                    fromMe: msg.key.fromMe,
                    chatJid: jid,
                    contactName: contactName,
                    avatarBase64: contact?.avatar_base64,
                    senderName: contactName
                });

                log.message('New message received', {
                    from: jid,
                    messageLength: messageContent.length,
                    hasAvatar: !!contact?.avatar_base64
                });
            }
        }

        timer.end();

    } catch (error) {
        timer.end({ error: true });
        log.error('Error handling message upsert', error);
    }
}

async function handlePresenceUpdate(update) {
    try {
        const { id, presences } = update;
        for (const [jid, presence] of Object.entries(presences)) {
            if (presence.lastKnownPresence === 'composing') {
                sendToFrontend('typing_start', { from: jid });
            } else if (presence.lastKnownPresence === 'paused') {
                sendToFrontend('typing_stop', { from: jid });
            }
        }
    } catch (error) {
        log.error('Error handling presence update', error);
    }
}

async function loadInitialChats() {
    const timer = performance.start('load_initial_chats');

    try {
        log.baileys('Loading initial chats');

        // Try to get from database first
        const dbChats = await database.getChats();
        if (dbChats.length > 0) {
            const chats = dbChats.map(chat => ({
                jid: chat.jid,
                name: chat.contact_name || chat.name || chat.jid, // Prefer contact name
                lastMessage: formatLastMessageContent(chat.last_message_content, chat.last_message_type || 'text'),
                timestamp: chat.last_message_timestamp,
                lastMessageType: chat.last_message_type || 'text',
                lastMessageFrom: chat.last_message_from,
                unreadCount: chat.unread_count || 0,
                avatarBase64: chat.contact_avatar_base64, // Contact avatar
                chatAvatarBase64: chat.avatar_base64, // Chat-specific avatar (for groups)
                phoneNumber: chat.contact_phone_number
            }));

            initialChatsPayload = { chats };

            if (clientIsWaitingForChats) {
                sendToFrontend('initial_chats', initialChatsPayload);
                clientIsWaitingForChats = false;
            }

            timer.end({ source: 'database', count: chats.length });
            log.baileys('Initial chats loaded from database', { count: chats.length });

            // Start background contact synchronization
            syncContactsInBackground();
        }

    } catch (error) {
        timer.end({ error: true });
        log.error('Error loading initial chats', error);
    }
}

async function syncContactsInBackground() {
    const timer = performance.start('sync_contacts_background');

    try {
        if (!sock || baileysConnectionStatus !== 'open') {
            log.debug('Skipping contact sync - not connected');
            return;
        }

        log.info('Starting background contact synchronization');

        // Sync existing contact avatars to chats table first
        await syncContactAvatarsToChats();

        // Get all chats that need contact info
        const chats = await database.getChats(100);
        let syncedCount = 0;

        for (const chat of chats) {
            try {
                const jid = chat.jid;

                // Always try to save contact info if we have a name
                let contactName = chat.contact_name || chat.name;

                // Save contact if we have a meaningful name (not just the JID)
                if (contactName && contactName !== jid && !contactName.includes('@')) {
                    await database.saveContact(jid, contactName);
                    syncedCount++;
                    log.debug(`Synced contact: ${jid} -> ${contactName}`);
                }

                // Small delay to avoid overwhelming WhatsApp
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (contactError) {
                log.debug('Failed to sync contact', {
                    jid: chat.jid,
                    error: contactError.message
                });
            }
        }

        timer.end({ syncedCount });
        log.info('Background contact synchronization completed', { syncedCount });

    } catch (error) {
        timer.end({ error: true });
        log.error('Error in background contact sync', error);
    }
}

// Sync existing chats to update any missing data
async function syncExistingChats() {
    const timer = performance.start('sync_existing_chats');

    try {
        if (!sock || baileysConnectionStatus !== 'open') {
            log.debug('Skipping existing chat sync - not connected');
            return;
        }

        log.info('Starting sync of existing chats');

        // Get all chats from database
        const chats = await database.getChats(100);
        const chatsNeedingMessages = [];
        let syncedCount = 0;

        for (const chat of chats) {
            try {
                const jid = chat.jid;

                // Check if this chat has any messages
                const existingMessages = await database.getMessages(jid, 1);
                if (existingMessages.length === 0) {
                    // Add to list of chats that need message loading
                    chatsNeedingMessages.push({
                        jid,
                        lastMessageTime: chat.conversationTimestamp || 0,
                        name: chat.name || jid
                    });
                }

                // Small delay to avoid overwhelming WhatsApp
                await new Promise(resolve => setTimeout(resolve, 200));

            } catch (chatError) {
                log.debug('Failed to sync existing chat', {
                    jid: chat.jid,
                    error: chatError.message
                });
            }
        }

        // Now try to load messages for chats that don't have any
        if (chatsNeedingMessages.length > 0) {
            log.info(`Found ${chatsNeedingMessages.length} chats without messages, attempting to load them`);

            // Sort by last message time (most recent first)
            chatsNeedingMessages.sort((a, b) => b.lastMessageTime - a.lastMessageTime);

            // Process up to 10 most recent chats to avoid overwhelming the system
            const chatsToProcess = chatsNeedingMessages.slice(0, 10);

            for (const chat of chatsToProcess) {
                try {
                    log.info(`Attempting to load messages for ${chat.name} (${chat.jid})`);
                    const messageCount = await loadMessagesForChat(chat.jid, 50);
                    if (messageCount > 0) {
                        syncedCount++;
                        log.info(`Successfully loaded ${messageCount} messages for ${chat.name}`);
                    } else {
                        log.debug(`No messages found for ${chat.name}`);
                    }

                    // Small delay between requests
                    await new Promise(resolve => setTimeout(resolve, 1000));

                } catch (loadError) {
                    log.debug(`Failed to load messages for ${chat.name}`, loadError);
                }
            }

            if (chatsNeedingMessages.length > 10) {
                log.info(`Processed 10 of ${chatsNeedingMessages.length} chats. Remaining chats will be processed later.`);
            }
        }

        timer.end({ syncedCount, chatsNeedingMessages: chatsNeedingMessages.length });
        log.info('Existing chat sync completed', { syncedCount, chatsNeedingMessages: chatsNeedingMessages.length });

    } catch (error) {
        timer.end({ error: true });
        log.error('Error syncing existing chats', error);
    }
}

// Try to fetch chats directly from the socket store
async function tryFetchChatsFromStore() {
    const timer = performance.start('fetch_chats_from_store');

    try {
        if (!sock || baileysConnectionStatus !== 'open') {
            log.debug('Cannot fetch chats from store - not connected');
            return false;
        }

        log.info('Attempting to fetch chats from socket store');

        // Get chats from the store
        const storeChats = Object.values(sock.store?.chats || {});
        log.info(`Found ${storeChats.length} chats in socket store`);

        if (storeChats.length === 0) {
            return false;
        }

        const processedChats = [];

        // Process up to 50 chats
        for (const chat of storeChats.slice(0, 50)) {
            try {
                const chatData = {
                    jid: chat.id,
                    name: chat.name || chat.id,
                    lastMessage: 'Loading messages...',
                    timestamp: Date.now(),
                    unreadCount: chat.unreadCount || 0
                };

                processedChats.push(chatData);

                // Save chat to database
                await database.saveChat(
                    chatData.jid,
                    chatData.name,
                    null, // No message ID yet
                    chatData.timestamp
                );

                // Save contact information if available
                if (chat.name && chat.name !== chat.id) {
                    await database.saveContact(chat.id, chat.name);
                    log.debug(`Saved contact from store: ${chat.id} -> ${chat.name}`);
                }

                log.debug(`Processed chat from store: ${chatData.jid}`);

            } catch (chatError) {
                log.debug('Failed to process chat from store', {
                    chatId: chat.id,
                    error: chatError.message
                });
            }
        }

        if (processedChats.length > 0) {
            log.info(`Successfully processed ${processedChats.length} chats from store`);

            // Set the initial chats payload
            initialChatsPayload = { chats: processedChats };

            // Send to frontend if waiting
            if (clientIsWaitingForChats) {
                log.info('Client was waiting for chats, sending store chats now');
                sendToFrontend('initial_chats', initialChatsPayload);
                clientIsWaitingForChats = false;
            }

            timer.end({ success: true, count: processedChats.length });
            return true;
        }

        timer.end({ success: false, count: 0 });
        return false;

    } catch (error) {
        timer.end({ error: true });
        log.error('Error fetching chats from store', error);
        return false;
    }
}

// Check if this is the first time login (no chats in database)
async function isFirstTimeLogin() {
    try {
        const chats = await database.getChats(1);
        return chats.length === 0;
    } catch (error) {
        log.error('Error checking first time login', error);
        return false;
    }
}

// Perform comprehensive data download for first-time login
async function performComprehensiveDataDownload() {
    const timer = performance.start('comprehensive_data_download');

    try {
        log.info('Starting comprehensive data download');
        sendToFrontend('download_progress', {
            stage: 'starting',
            message: 'Initializing data download...',
            progress: 0
        });

        // Wait for WhatsApp to send initial chat history
        await waitForInitialHistory();

        // Get all chats from database
        const chats = await database.getChats(1000);
        log.info(`Found ${chats.length} chats to process`);

        if (chats.length === 0) {
            log.warn('No chats found after waiting for history');
            sendToFrontend('download_complete', {
                message: 'No chats found to download',
                stats: { chats: 0, contacts: 0, messages: 0, avatars: 0 }
            });
            return;
        }

        sendToFrontend('download_progress', {
            stage: 'downloading',
            message: `Downloading data for ${chats.length} chats...`,
            progress: 10,
            totalChats: chats.length
        });

        let processedChats = 0;
        let downloadedMessages = 0;
        let downloadedAvatars = 0;
        let updatedContacts = 0;

        // Process each chat
        for (const chat of chats) {
            try {
                const jid = chat.jid;
                log.debug(`Processing chat: ${jid}`);

                // Message history is automatically synced via messaging-history.set event
                // Check if we have messages for this chat
                const existingMessages = await database.getMessages(jid, 1);
                if (existingMessages.length > 0) {
                    downloadedMessages += existingMessages.length;
                }

                // Download contact info and avatar
                const contactUpdated = await downloadContactInfo(jid);
                if (contactUpdated.nameUpdated) updatedContacts++;
                if (contactUpdated.avatarDownloaded) downloadedAvatars++;

                // Download chat avatar if it's a group
                if (jid.endsWith('@g.us')) {
                    await downloadChatAvatar(jid);
                }

                processedChats++;

                // Send progress update every 5 chats or on last chat
                if (processedChats % 5 === 0 || processedChats === chats.length) {
                    const progress = 10 + (processedChats / chats.length) * 80; // 10-90%
                    sendToFrontend('download_progress', {
                        stage: 'downloading',
                        message: `Processed ${processedChats}/${chats.length} chats`,
                        progress: Math.round(progress),
                        processedChats,
                        totalChats: chats.length,
                        stats: {
                            messages: downloadedMessages,
                            avatars: downloadedAvatars,
                            contacts: updatedContacts
                        }
                    });
                }

                // Small delay to avoid overwhelming WhatsApp
                await new Promise(resolve => setTimeout(resolve, 200));

            } catch (chatError) {
                log.warn(`Failed to process chat ${chat.jid}`, chatError);
                processedChats++;
            }
        }

        // Final statistics
        const finalStats = {
            chats: chats.length,
            messages: downloadedMessages,
            contacts: updatedContacts,
            avatars: downloadedAvatars
        };

        timer.end(finalStats);
        log.info('Comprehensive data download completed', finalStats);

        sendToFrontend('download_progress', {
            stage: 'complete',
            message: 'Download complete!',
            progress: 100,
            stats: finalStats
        });

        sendToFrontend('download_complete', {
            message: 'All your WhatsApp data has been downloaded successfully',
            stats: finalStats
        });

        // Mark first login as complete
        await database.setSetting('first_login_complete', true);

    } catch (error) {
        timer.end({ error: true });
        log.error('Error in comprehensive data download', error);
        sendToFrontend('download_error', {
            message: 'Failed to download data',
            error: error.message
        });
    }
}

// Wait for WhatsApp to send initial chat history
async function waitForInitialHistory() {
    return new Promise(async (resolve) => {
        const maxWaitTime = 30000; // 30 seconds
        const checkInterval = 1000; // 1 second
        let waitTime = 0;

        // Try to actively fetch chat list from WhatsApp
        try {
            if (sock && baileysConnectionStatus === 'open') {
                log.info('Actively fetching chat list from WhatsApp');

                // Try to get chats using the store
                const chats = Object.values(sock.store?.chats || {});
                log.info(`Found ${chats.length} chats in store`);

                if (chats.length > 0) {
                    // Process the chats we found
                    const processedChats = [];

                    for (const chat of chats.slice(0, 50)) { // Limit to first 50 chats
                        try {
                            const chatData = {
                                jid: chat.id,
                                name: chat.name || chat.id,
                                lastMessage: 'Loading...',
                                timestamp: Date.now(),
                                unreadCount: chat.unreadCount || 0
                            };

                            processedChats.push(chatData);

                            // Save to database
                            await database.saveChat(
                                chatData.jid,
                                chatData.name,
                                null, // No message ID yet
                                chatData.timestamp
                            );

                        } catch (chatError) {
                            log.debug('Failed to process chat from store', { chatId: chat.id, error: chatError.message });
                        }
                    }

                    if (processedChats.length > 0) {
                        log.info(`Processed ${processedChats.length} chats from store`);
                        // Trigger the history set handler manually
                        await handleHistorySet({ chats: chats.slice(0, 50), isLatest: true });
                        return; // Exit early since we found chats
                    }
                }
            }
        } catch (error) {
            log.debug('Failed to fetch chats from store', error);
        }

        const checkForHistory = async () => {
            try {
                const chats = await database.getChats(1);
                if (chats.length > 0) {
                    log.info('Initial history received');
                    resolve();
                    return;
                }
            } catch (error) {
                log.debug('Error checking for history', error);
            }

            waitTime += checkInterval;
            if (waitTime >= maxWaitTime) {
                log.warn('Timeout waiting for initial history');
                resolve();
            } else {
                setTimeout(checkForHistory, checkInterval);
            }
        };

        checkForHistory();
    });
}

// Manual message loading for chats that don't have messages
async function loadMessagesForChat(jid, limit = 50) {
    const timer = performance.start('load_messages_for_chat');

    try {
        if (!sock || baileysConnectionStatus !== 'open') {
            return 0;
        }

        log.debug(`Loading messages for chat ${jid}`);

        // Try multiple methods to get message history
        let messages = [];

        // Method 1: Try fetchMessageHistory with correct signature
        try {
            // Get the oldest message key and timestamp for this chat
            const existingMessages = await database.getMessages(jid, 1);
            let oldestMsgKey, oldestMsgTimestamp;

            if (existingMessages.length > 0) {
                // Use existing message as reference point
                const oldestMsg = existingMessages[0];
                oldestMsgKey = {
                    remoteJid: jid,
                    fromMe: false,
                    id: oldestMsg.id
                };
                oldestMsgTimestamp = oldestMsg.timestamp;
            } else {
                // No existing messages, use a recent timestamp to get recent history
                oldestMsgTimestamp = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days ago
                oldestMsgKey = {
                    remoteJid: jid,
                    fromMe: false,
                    id: 'dummy_' + Date.now()
                };
            }

            log.debug(`Requesting ${limit} messages for ${jid} using fetchMessageHistory`);
            const historyId = await sock.fetchMessageHistory(limit, oldestMsgKey, oldestMsgTimestamp);

            if (historyId) {
                log.info(`Successfully requested message history for ${jid}, historyId: ${historyId}`);
                // Messages will be delivered via messaging-history.set event
                // Wait a bit for the messages to arrive
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Check if we received new messages
                const newMessages = await database.getMessages(jid, limit);
                if (newMessages.length > existingMessages.length) {
                    messages = newMessages.slice(existingMessages.length);
                    log.debug(`fetchMessageHistory delivered ${messages.length} new messages for ${jid}`);
                }
            }
        } catch (fetchError) {
            log.debug(`fetchMessageHistory failed for ${jid}: ${fetchError.message}`);
        }

        // Method 2: If no messages from fetchMessageHistory, check what we have in database
        if (messages.length === 0) {
            log.debug(`No new messages from fetchMessageHistory for ${jid}, checking database`);
            const dbMessages = await database.getMessages(jid, limit);
            if (dbMessages.length > 0) {
                log.debug(`Found ${dbMessages.length} existing messages in database for ${jid}`);
                return dbMessages.length; // Return count of existing messages
            }
        }

        if (messages.length === 0) {
            log.debug(`No messages found for ${jid} using any method`);
            return 0;
        }

        let savedCount = 0;

        for (const msg of messages) {
            try {
                // Skip if no message key
                if (!msg.key || !msg.key.id) {
                    continue;
                }

                // Check if message already exists to avoid duplicates
                const existingMessage = await database.getMessage(msg.key.id);
                if (existingMessage) {
                    continue;
                }

                const messageContent = getDisplayMessage(msg);
                const messageType = getMessageType(msg);
                const timestamp = msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now();

                if (messageContent || messageType !== 'text') {
                    await database.saveMessage(
                        msg.key.id,
                        msg.key.remoteJid || jid,
                        msg.key.fromMe || false,
                        messageContent || '',
                        timestamp,
                        messageType,
                        msg.key.fromMe ? 'sent' : 'received',
                        msg.pushName || null
                    );
                    savedCount++;
                }
            } catch (msgError) {
                log.debug('Failed to save message', { jid, messageId: msg.key?.id, error: msgError.message });
            }
        }

        timer.end({ jid, savedCount, totalFound: messages.length });
        log.info(`Loaded ${savedCount} messages for ${jid} (found ${messages.length} total)`);
        return savedCount;

    } catch (error) {
        timer.end({ error: true });
        log.debug(`Failed to load messages for ${jid}`, error);
        return 0;
    }
}

// Get message type from WhatsApp message object
function getMessageType(msg) {
    if (!msg) return 'text';

    // Handle both regular messages and history messages
    // History messages have structure: msg.message.message.conversation
    // Regular messages have structure: msg.message.conversation
    let messageObj = msg.message;

    // If this is a history message, unwrap the nested structure
    if (messageObj && messageObj.message) {
        messageObj = messageObj.message;
    }

    if (!messageObj) return 'text';

    const messageTypes = {
        conversation: 'text',
        extendedTextMessage: 'text',
        imageMessage: 'image',
        videoMessage: 'video',
        audioMessage: 'audio',
        documentMessage: 'document',
        stickerMessage: 'sticker',
        locationMessage: 'location',
        liveLocationMessage: 'live_location',
        contactMessage: 'contact',
        contactsArrayMessage: 'contacts',
        groupInviteMessage: 'group_invite',
        buttonsMessage: 'buttons',
        templateMessage: 'template',
        listMessage: 'list',
        reactionMessage: 'reaction',
        pollCreationMessage: 'poll',
        pollUpdateMessage: 'poll_update'
    };

    for (const [type, displayType] of Object.entries(messageTypes)) {
        if (messageObj[type]) {
            return displayType;
        }
    }

    return 'unknown';
}

// Extract timestamp from message (handles both regular and history message formats)
function getMessageTimestamp(msg) {
    if (!msg) return Date.now();

    // Handle both regular messages and history messages
    let timestamp = msg.messageTimestamp;

    // If this is a history message, get timestamp from nested structure
    if (msg.message && msg.message.messageTimestamp) {
        timestamp = msg.message.messageTimestamp;
    }

    if (!timestamp) return Date.now();

    // Handle Long objects (from protobuf) with low/high/unsigned properties
    if (typeof timestamp === 'object' && timestamp.low !== undefined) {
        // Convert Long object to number
        const low = timestamp.low >>> 0; // Convert to unsigned 32-bit
        const high = timestamp.high >>> 0; // Convert to unsigned 32-bit
        return (high * 0x100000000 + low) * 1000; // Convert to milliseconds
    }

    // Handle regular number timestamps
    if (typeof timestamp === 'number') {
        return timestamp * 1000; // Convert to milliseconds
    }

    // Handle string timestamps
    if (typeof timestamp === 'string') {
        return parseInt(timestamp) * 1000; // Convert to milliseconds
    }

    return Date.now();
}

// Extract message key from message (handles both regular and history message formats)
function getMessageKey(msg) {
    if (!msg) return null;

    // Handle both regular messages and history messages
    if (msg.key) {
        return msg.key;
    }

    // If this is a history message, get key from nested structure
    if (msg.message && msg.message.key) {
        return msg.message.key;
    }

    return null;
}

// Format last message content according to requirements
function formatLastMessageContent(content, messageType) {
    // If message type is text, return the full content
    if (messageType === 'text') {
        return content || 'No messages yet';
    }

    // For non-text messages, return null as per requirements
    return null;
}

// Download media for a message
async function downloadMessageMedia(msg, chatJid) {
    const timer = performance.start('download_message_media');

    try {
        if (!sock || baileysConnectionStatus !== 'open') {
            return false;
        }

        const messageType = getMessageType(msg);
        if (messageType === 'text' || messageType === 'unknown') {
            return false;
        }

        log.debug(`Downloading media for message ${msg.key.id} (type: ${messageType})`);

        // Get the media message object
        let mediaMessage = null;
        if (msg.message.imageMessage) mediaMessage = msg.message.imageMessage;
        else if (msg.message.videoMessage) mediaMessage = msg.message.videoMessage;
        else if (msg.message.audioMessage) mediaMessage = msg.message.audioMessage;
        else if (msg.message.documentMessage) mediaMessage = msg.message.documentMessage;
        else if (msg.message.stickerMessage) mediaMessage = msg.message.stickerMessage;

        if (!mediaMessage) {
            return false;
        }

        // Download the media buffer
        const buffer = await baileys.downloadMediaMessage(msg, 'buffer', {});

        if (buffer && buffer.length > 0) {
            // Save media information to database
            await database.saveMedia(
                `${msg.key.id}_media`,
                msg.key.id,
                null, // file_path - we're not saving to disk
                mediaMessage.fileName || `${messageType}_${msg.key.id}`,
                buffer.length,
                mediaMessage.mimetype || `${messageType}/*`
            );

            log.debug(`Downloaded media for message ${msg.key.id}: ${buffer.length} bytes`);
            timer.end({ messageId: msg.key.id, size: buffer.length });
            return true;
        }

        timer.end({ messageId: msg.key.id, downloaded: false });
        return false;

    } catch (error) {
        timer.end({ error: true });
        log.debug(`Failed to download media for message ${msg.key.id}`, error);
        return false;
    }
}

// Download contact information and avatar for a specific JID
async function downloadContactInfo(jid) {
    const timer = performance.start('download_contact_info');

    try {
        let nameUpdated = false;
        let avatarDownloaded = false;

        if (!sock || baileysConnectionStatus !== 'open') {
            return { nameUpdated, avatarDownloaded };
        }

        // Get existing contact info
        const existingContact = await database.getContact(jid);

        // Try to get contact name from WhatsApp if we don't have it
        if (!existingContact?.name || existingContact.name === jid) {
            try {
                // For group chats, get group metadata
                if (jid.endsWith('@g.us')) {
                    const groupMetadata = await sock.groupMetadata(jid);
                    if (groupMetadata?.subject) {
                        await database.saveContact(jid, groupMetadata.subject);
                        nameUpdated = true;
                        log.debug(`Updated group name: ${jid} -> ${groupMetadata.subject}`);
                    }
                }
                // For individual contacts, we'll rely on message pushName or existing data
            } catch (nameError) {
                log.debug(`Failed to get contact name for ${jid}`, nameError);
            }
        }

        // Download avatar as base64 if we don't have it
        if (!existingContact?.avatar_base64) {
            try {
                const avatarUrl = await sock.profilePictureUrl(jid, 'image');
                if (avatarUrl) {
                    // Download the avatar image
                    const response = await fetch(avatarUrl);
                    if (response.ok) {
                        const buffer = await response.arrayBuffer();
                        const base64Avatar = Buffer.from(buffer).toString('base64');

                        // Only save if we actually got valid avatar data
                        if (base64Avatar && base64Avatar.length > 100) { // Basic validation
                            // Ensure contact exists first, then update avatar
                            await database.saveContact(jid, existingContact?.name || null, null, base64Avatar);

                            // Also update the corresponding chat avatar so frontend can display it
                            await database.updateChatAvatar(jid, base64Avatar);

                            avatarDownloaded = true;
                            log.debug(`Downloaded avatar for ${jid}: ${base64Avatar.length} chars`);
                        }
                    }
                }
            } catch (avatarError) {
                log.debug(`Failed to download avatar for ${jid}`, avatarError);
            }
        } else {
            log.debug(`Skipping avatar download for ${jid} - already exists`);
        }

        timer.end({ jid, nameUpdated, avatarDownloaded });
        return { nameUpdated, avatarDownloaded };

    } catch (error) {
        timer.end({ error: true });
        log.debug(`Failed to download contact info for ${jid}`, error);
        return { nameUpdated: false, avatarDownloaded: false };
    }
}

// Download chat avatar (for groups)
async function downloadChatAvatar(jid) {
    const timer = performance.start('download_chat_avatar');

    try {
        if (!sock || baileysConnectionStatus !== 'open') {
            return false;
        }

        // Check if we already have a chat avatar
        const existingChat = await database.getChatWithContact(jid);
        if (existingChat?.avatar_base64) {
            log.debug(`Skipping chat avatar download for ${jid} - already exists`);
            return false; // Already have avatar
        }

        log.debug(`Downloading chat avatar for ${jid}`);

        try {
            const avatarUrl = await sock.profilePictureUrl(jid, 'image');
            if (avatarUrl) {
                // Download the avatar image
                const response = await fetch(avatarUrl);
                if (response.ok) {
                    const buffer = await response.arrayBuffer();
                    const base64Avatar = Buffer.from(buffer).toString('base64');

                    // Only save if we actually got valid avatar data
                    if (base64Avatar && base64Avatar.length > 100) { // Basic validation
                        // Ensure chat exists first, then update avatar
                        await database.saveChat(jid, existingChat?.name || null, null, null, base64Avatar);
                        log.debug(`Downloaded chat avatar for ${jid}: ${base64Avatar.length} chars`);
                        timer.end({ jid, downloaded: true });
                        return true;
                    }
                }
            }
        } catch (avatarError) {
            log.debug(`Failed to download chat avatar for ${jid}`, avatarError);
        }

        timer.end({ jid, downloaded: false });
        return false;

    } catch (error) {
        timer.end({ error: true });
        log.debug(`Failed to download chat avatar for ${jid}`, error);
        return false;
    }
}

// Perform incremental sync for existing installations
async function performIncrementalSync() {
    const timer = performance.start('incremental_sync');

    try {
        log.info('Starting incremental sync');
        sendToFrontend('sync_started', { message: 'Syncing latest data...' });

        // Load initial chats from database first
        await loadInitialChats();

        // Perform comprehensive sync to catch any changes
        await performComprehensiveSync();

        timer.end();
        log.info('Incremental sync completed');
        sendToFrontend('sync_complete', { message: 'Data sync complete' });

    } catch (error) {
        timer.end({ error: true });
        log.error('Error in incremental sync', error);
        sendToFrontend('sync_error', {
            message: 'Failed to sync data',
            error: error.message
        });
    }
}

// Perform comprehensive sync to update existing data
async function performComprehensiveSync() {
    const timer = performance.start('comprehensive_sync');

    try {
        if (!sock || baileysConnectionStatus !== 'open') {
            log.warn('Cannot perform sync - not connected to WhatsApp');
            return;
        }

        log.info('Starting comprehensive sync');
        sendToFrontend('sync_progress', {
            stage: 'starting',
            message: 'Checking for updates...',
            progress: 0
        });

        // Get last sync timestamp
        const lastSyncTime = await database.getSetting('last_sync_timestamp', 0);
        const currentTime = Date.now();

        log.info(`Last sync: ${new Date(lastSyncTime).toISOString()}, Current: ${new Date(currentTime).toISOString()}`);

        // Get all chats from database
        const chats = await database.getChats(1000);
        log.info(`Syncing ${chats.length} chats`);

        if (chats.length === 0) {
            log.info('No chats to sync');
            return;
        }

        sendToFrontend('sync_progress', {
            stage: 'syncing',
            message: `Syncing ${chats.length} chats...`,
            progress: 10,
            totalChats: chats.length
        });

        let processedChats = 0;
        let updatedChats = 0;
        let newMessages = 0;
        let updatedContacts = 0;
        let downloadedAvatars = 0;

        // Process each chat for updates
        for (const chat of chats) {
            try {
                const jid = chat.jid;
                log.debug(`Syncing chat: ${jid}`);

                // Check for new messages since last sync
                const messageUpdates = await syncChatMessages(jid, lastSyncTime);
                newMessages += messageUpdates;

                // Update contact information
                const contactUpdates = await syncContactData(jid);
                if (contactUpdates.nameUpdated) updatedContacts++;
                if (contactUpdates.avatarDownloaded) downloadedAvatars++;

                if (messageUpdates > 0 || contactUpdates.nameUpdated || contactUpdates.avatarDownloaded) {
                    updatedChats++;
                }

                processedChats++;

                // Send progress update every 10 chats or on last chat
                if (processedChats % 10 === 0 || processedChats === chats.length) {
                    const progress = 10 + (processedChats / chats.length) * 80; // 10-90%
                    sendToFrontend('sync_progress', {
                        stage: 'syncing',
                        message: `Synced ${processedChats}/${chats.length} chats`,
                        progress: Math.round(progress),
                        processedChats,
                        totalChats: chats.length,
                        stats: {
                            updatedChats,
                            newMessages,
                            updatedContacts,
                            downloadedAvatars
                        }
                    });
                }

                // Small delay to avoid overwhelming WhatsApp
                await new Promise(resolve => setTimeout(resolve, 150));

            } catch (chatError) {
                log.warn(`Failed to sync chat ${chat.jid}`, chatError);
                processedChats++;
            }
        }

        // Update last sync timestamp
        await database.setSetting('last_sync_timestamp', currentTime);

        // Final statistics
        const syncStats = {
            totalChats: chats.length,
            updatedChats,
            newMessages,
            updatedContacts,
            downloadedAvatars,
            syncDuration: Date.now() - currentTime
        };

        timer.end(syncStats);
        log.info('Comprehensive sync completed', syncStats);

        sendToFrontend('sync_progress', {
            stage: 'complete',
            message: 'Sync complete!',
            progress: 100,
            stats: syncStats
        });

        // If there were significant updates, refresh the chat list
        if (updatedChats > 0 || newMessages > 0) {
            await refreshChatList();
        }

    } catch (error) {
        timer.end({ error: true });
        log.error('Error in comprehensive sync', error);
        sendToFrontend('sync_error', {
            message: 'Failed to sync data',
            error: error.message
        });
    }
}

// Sync messages for a specific chat since last sync time
async function syncChatMessages(jid, lastSyncTime) {
    const timer = performance.start('sync_chat_messages');

    try {
        if (!sock || baileysConnectionStatus !== 'open') {
            return 0;
        }

        // Get the most recent message timestamp from database
        const recentMessages = await database.getMessages(jid, 1);
        const lastMessageTime = recentMessages.length > 0 ? recentMessages[0].timestamp : lastSyncTime;

        // Only fetch if we haven't checked recently (avoid too frequent checks)
        // BUT if we have no messages at all, always try to download
        const timeSinceLastCheck = Date.now() - lastMessageTime;
        if (timeSinceLastCheck < 300000 && recentMessages.length > 0) { // Less than 5 minutes AND we have messages
            log.debug(`Skipping message sync for ${jid} - checked recently`);
            return 0;
        }

        log.debug(`Checking for new messages in ${jid} since ${new Date(lastMessageTime).toISOString()}`);

        // Messages are automatically synced via messaging-history.set events
        // Just check if we have any new messages since last sync
        const allMessages = await database.getMessages(jid, 50);
        const newMessages = allMessages.filter(msg => msg.timestamp > lastMessageTime);
        let newMessageCount = newMessages.length;

        timer.end({ jid, newMessageCount });
        if (newMessageCount > 0) {
            log.info(`Synced ${newMessageCount} new messages for ${jid}`);
        }
        return newMessageCount;

    } catch (error) {
        timer.end({ error: true });
        log.debug(`Failed to sync messages for ${jid}`, error);
        return 0;
    }
}

// Sync existing contact avatars to chats table
async function syncContactAvatarsToChats() {
    const timer = performance.start('sync_contact_avatars_to_chats');

    try {
        // Get all contacts that have avatars but corresponding chats don't
        const sql = `
            SELECT c.jid, c.avatar_base64
            FROM contacts c
            JOIN chats ch ON c.jid = ch.jid
            WHERE c.avatar_base64 IS NOT NULL
            AND ch.avatar_base64 IS NULL
        `;

        const contactsWithAvatars = await database.all(sql);
        let syncedCount = 0;

        for (const contact of contactsWithAvatars) {
            try {
                await database.updateChatAvatar(contact.jid, contact.avatar_base64);
                syncedCount++;
                log.debug(`Synced avatar from contact to chat: ${contact.jid}`);
            } catch (error) {
                log.debug(`Failed to sync avatar for ${contact.jid}`, error);
            }
        }

        timer.end({ syncedCount });
        log.info(`Synced ${syncedCount} contact avatars to chats table`);

        return syncedCount;
    } catch (error) {
        timer.end({ error: true });
        log.debug('Failed to sync contact avatars to chats', error);
        return 0;
    }
}

// Sync contact data for a specific JID
async function syncContactData(jid) {
    const timer = performance.start('sync_contact_data');

    try {
        let nameUpdated = false;
        let avatarDownloaded = false;

        if (!sock || baileysConnectionStatus !== 'open') {
            return { nameUpdated, avatarDownloaded };
        }

        // Get existing contact info
        const existingContact = await database.getContact(jid);

        // Check if we've synced this contact recently (within last hour)
        const lastSyncTime = existingContact?.updated_at || 0;
        const timeSinceLastSync = Date.now() - (lastSyncTime * 1000);
        const oneHour = 60 * 60 * 1000;

        // Skip if synced recently and we already have both name and avatar
        if (timeSinceLastSync < oneHour &&
            existingContact?.name &&
            existingContact?.avatar_base64) {
            log.debug(`Skipping sync for ${jid} - recently synced and complete`);
            return { nameUpdated, avatarDownloaded };
        }

        // Check if we need to update group metadata
        if (jid.endsWith('@g.us')) {
            try {
                const groupMetadata = await sock.groupMetadata(jid);
                // Only update if we have a new name and it's different from what we have
                if (groupMetadata?.subject &&
                    groupMetadata.subject.trim() !== '' &&
                    groupMetadata.subject !== existingContact?.name) {
                    await database.saveContact(jid, groupMetadata.subject);
                    nameUpdated = true;
                    log.debug(`Updated group name: ${jid} -> ${groupMetadata.subject}`);
                }
            } catch (groupError) {
                log.debug(`Failed to get group metadata for ${jid}`, groupError);
            }
        }

        // Download avatar if we don't have one
        if (jid.endsWith('@g.us')) {
            // For groups, download chat avatar
            avatarDownloaded = await downloadChatAvatar(jid);
        } else {
            // For individual contacts, download contact avatar
            const contactInfo = await downloadContactInfo(jid);
            avatarDownloaded = contactInfo.avatarDownloaded;
        }

        timer.end({ jid, nameUpdated, avatarDownloaded });
        return { nameUpdated, avatarDownloaded };

    } catch (error) {
        timer.end({ error: true });
        log.debug(`Failed to sync contact data for ${jid}`, error);
        return { nameUpdated: false, avatarDownloaded: false };
    }
}

// Refresh the chat list and send to frontend
async function refreshChatList() {
    try {
        log.info('Refreshing chat list');

        const dbChats = await database.getChats();
        const chats = dbChats.map(chat => ({
            jid: chat.jid,
            name: chat.contact_name || chat.name || chat.jid,
            lastMessage: formatLastMessageContent(chat.last_message_content, chat.last_message_type || 'text'),
            timestamp: chat.last_message_timestamp,
            lastMessageType: chat.last_message_type || 'text',
            lastMessageFrom: chat.last_message_from,
            unreadCount: chat.unread_count || 0,
            avatarBase64: chat.contact_avatar_base64, // Contact avatar
            chatAvatarBase64: chat.avatar_base64, // Chat-specific avatar (for groups)
            phoneNumber: chat.contact_phone_number
        }));

        initialChatsPayload = { chats };
        sendToFrontend('chats_updated', initialChatsPayload);

        log.info(`Refreshed chat list with ${chats.length} chats`);

    } catch (error) {
        log.error('Failed to refresh chat list', error);
    }
}



// Main initialization
async function main() {
    try {
        await initializeBackend();

    } catch (error) {
        log.error('FATAL ERROR in main execution', error);
        process.exit(1);
    }
}



// Start the application
main().catch((error) => {
    console.error('Failed to start application:', error);
    process.exit(1);
});

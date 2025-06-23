#!/usr/bin/env node

import baileys from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import fs from 'fs';

const makeWASocket = baileys.default;
const { DisconnectReason, useMultiFileAuthState, Browsers } = baileys;

// Create a simple logger
const logger = {
    level: 'silent',
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
    trace: () => {},
    child: () => logger
};

console.log('🚀 Starting WhatsApp Message History Test');
console.log('📱 This will show QR code and capture ALL message history during initial sync');
console.log('⚠️  IMPORTANT: This is our ONLY chance to get message history!');
console.log('');

let sock;
let isConnected = false;

// Import our improved message parsing functions from backend
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

function getMessageType(msg) {
    if (!msg) return 'text';

    // Handle both regular messages and history messages
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
let totalChatsReceived = 0;
let totalMessagesReceived = 0;

async function startWhatsApp() {
    // Use a clean auth state for testing
    const { state, saveCreds } = await useMultiFileAuthState('./test_auth');
    
    sock = makeWASocket({
        auth: state,
        syncFullHistory: true,
        browser: ['Karere', 'Chrome', '1.0.0'],
        logger: logger
    });

    // Handle QR code display
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('📱 QR Code generated! Scan with your phone:');
            console.log('');
            qrcode.generate(qr, { small: true });
            console.log('');
            console.log('⏳ Waiting for phone to scan QR code...');
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Connection closed due to', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
            
            if (shouldReconnect) {
                startWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Connected to WhatsApp!');
            console.log('🔄 Now waiting for message history...');
            isConnected = true;
        }
    });

    // Save credentials
    sock.ev.on('creds.update', saveCreds);

    // THIS IS THE CRITICAL EVENT - message history
    sock.ev.on('messaging-history.set', (item) => {
        console.log('');
        console.log('🔥🔥🔥 MESSAGING HISTORY RECEIVED! 🔥🔥🔥');

        // SAVE RAW HISTORY TO FILE FOR ANALYSIS
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `history-${timestamp}-${item.isLatest ? 'FINAL' : 'BATCH'}.json`;

        try {
            fs.writeFileSync(filename, JSON.stringify(item, null, 2));
            console.log(`💾 RAW HISTORY SAVED TO: ${filename}`);

            // Also save a structure analysis
            const structureFilename = `structure-${timestamp}-${item.isLatest ? 'FINAL' : 'BATCH'}.json`;
            const structure = analyzeStructure(item);
            fs.writeFileSync(structureFilename, JSON.stringify(structure, null, 2));
            console.log(`🔍 STRUCTURE ANALYSIS SAVED TO: ${structureFilename}`);
        } catch (error) {
            console.log(`❌ Failed to save history: ${error.message}`);
        }

        console.log('📊 Summary:');
        console.log(`   - Chats: ${item.chats?.length || 0}`);
        console.log(`   - Is Latest: ${item.isLatest}`);
        console.log(`   - Has Messages: ${!!item.messages}`);

        if (item.chats) {
            totalChatsReceived += item.chats.length;
            
            console.log('');
            console.log('📋 Chat Details:');
            
            item.chats.forEach((chat, index) => {
                const messageCount = chat.messages?.length || 0;
                totalMessagesReceived += messageCount;
                
                console.log(`   ${index + 1}. ${chat.name || chat.id}`);
                console.log(`      - JID: ${chat.id}`);
                console.log(`      - Messages: ${messageCount}`);
                console.log(`      - Unread: ${chat.unreadCount || 0}`);
                
                if (chat.messages && chat.messages.length > 0) {
                    console.log(`      - Latest message: "${getMessagePreview(chat.messages[0])}"`);
                    console.log(`      - Message timestamps range: ${getMessageTimeRange(chat.messages)}`);

                    // Debug: Show the actual message structure for the first few chats
                    if (index < 3) {
                        console.log(`      - DEBUG: Message structure:`, JSON.stringify(chat.messages[0], null, 2));
                    }
                }
                console.log('');
            });
        }
        
        console.log('📈 TOTALS SO FAR:');
        console.log(`   - Total Chats: ${totalChatsReceived}`);
        console.log(`   - Total Messages: ${totalMessagesReceived}`);
        console.log('');
        
        if (item.isLatest) {
            console.log('✅ This was the FINAL history batch!');
            console.log('');
            console.log('🎯 FINAL RESULTS:');
            console.log(`   - Total Chats Received: ${totalChatsReceived}`);
            console.log(`   - Total Messages Received: ${totalMessagesReceived}`);
            console.log('');
            console.log('💡 This is ALL the message history WhatsApp will ever send us!');
            console.log('   If we missed saving any of this, it\'s gone forever.');
            console.log('');

            // Test readMessages() API
            testReadMessagesAPI(item);
        }
    });

    // Handle new incoming messages (after initial sync)
    sock.ev.on('messages.upsert', (m) => {
        if (isConnected) {
            const msg = m.messages[0];
            if (!msg.key.fromMe && m.type === 'notify') {
                console.log('📨 New message received:', getMessagePreview(msg));
            }
        }
    });

    // Debug: Log ALL events to see what else we might be missing
    sock.ev.on('*', (event, data) => {
        if (event.includes('history') || event.includes('message') || event.includes('chat')) {
            if (event !== 'messaging-history.set') { // We already handle this one
                console.log(`🔍 Event: ${event}`, {
                    hasChats: !!data?.chats,
                    chatCount: data?.chats?.length || 0,
                    hasMessages: !!data?.messages,
                    messageCount: data?.messages?.length || 0
                });
            }
        }
    });
}

// Helper function to get message preview (using our improved parsing)
function getMessagePreview(msg) {
    const content = getDisplayMessage(msg);
    if (content && content !== '[Unsupported Message]' && content.length > 50) {
        return content.substring(0, 50) + '...';
    }
    return content || '[No message content]';
}

// Helper function to get message time range (using our improved parsing)
function getMessageTimeRange(messages) {
    if (!messages || messages.length === 0) return 'No messages';

    const timestamps = messages.map(msg => getMessageTimestamp(msg));

    const oldest = new Date(Math.min(...timestamps));
    const newest = new Date(Math.max(...timestamps));

    return `${oldest.toLocaleDateString()} to ${newest.toLocaleDateString()}`;
}

// Test the readMessages() API
async function testReadMessagesAPI(historyItem) {
    console.log('🧪 Testing readMessages() API...');

    try {
        // Collect message keys from the first few chats
        const messageKeys = [];
        let keyCount = 0;

        for (const chat of historyItem.chats || []) {
            if (keyCount >= 10) break; // Limit to 10 messages for testing

            for (const msg of chat.messages || []) {
                if (keyCount >= 10) break;

                const messageKey = getMessageKey(msg);
                if (messageKey && messageKey.id) {
                    messageKeys.push(messageKey);
                    keyCount++;
                }
            }
        }

        if (messageKeys.length === 0) {
            console.log('   ⚠️ No message keys found to test readMessages()');
            return;
        }

        console.log(`   📋 Testing with ${messageKeys.length} message keys...`);

        // Test readMessages() API
        const startTime = Date.now();
        await sock.readMessages(messageKeys);
        const duration = Date.now() - startTime;

        console.log(`   ✅ readMessages() completed successfully in ${duration}ms`);
        console.log(`   📨 Marked ${messageKeys.length} messages as read`);

        // Show sample of what we marked as read
        console.log('   📋 Sample messages marked as read:');
        messageKeys.slice(0, 3).forEach((key, index) => {
            console.log(`      ${index + 1}. ${key.id} from ${key.remoteJid} (fromMe: ${key.fromMe})`);
        });

    } catch (error) {
        console.log(`   ❌ readMessages() failed: ${error.message}`);
        console.log(`   🔍 Error details:`, error);
    }

    console.log('');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('');
    console.log('👋 Shutting down...');
    console.log('');
    console.log('📊 FINAL SUMMARY:');
    console.log(`   - Total Chats: ${totalChatsReceived}`);
    console.log(`   - Total Messages: ${totalMessagesReceived}`);
    console.log('');
    process.exit(0);
});

// Analyze the structure of the history data
function analyzeStructure(item) {
    const analysis = {
        topLevel: Object.keys(item),
        chatCount: item.chats?.length || 0,
        chats: []
    };

    if (item.chats && item.chats.length > 0) {
        // Analyze first few chats
        for (let i = 0; i < Math.min(3, item.chats.length); i++) {
            const chat = item.chats[i];
            const chatAnalysis = {
                index: i,
                jid: chat.id,
                name: chat.name,
                keys: Object.keys(chat),
                messageCount: chat.messages?.length || 0,
                messages: []
            };

            // Analyze first few messages in this chat
            if (chat.messages && chat.messages.length > 0) {
                for (let j = 0; j < Math.min(2, chat.messages.length); j++) {
                    const msg = chat.messages[j];
                    const msgAnalysis = {
                        index: j,
                        keys: Object.keys(msg),
                        hasKey: !!msg.key,
                        keyKeys: msg.key ? Object.keys(msg.key) : [],
                        hasMessage: !!msg.message,
                        messageKeys: msg.message ? Object.keys(msg.message) : [],
                        messageTimestamp: msg.messageTimestamp,
                        pushName: msg.pushName,
                        // Sample of actual message content structure
                        messageStructure: msg.message ? getMessageStructure(msg.message) : null
                    };
                    chatAnalysis.messages.push(msgAnalysis);
                }
            }

            analysis.chats.push(chatAnalysis);
        }
    }

    return analysis;
}

// Get the structure of a message object
function getMessageStructure(messageObj) {
    const structure = {};
    for (const [key, value] of Object.entries(messageObj)) {
        if (typeof value === 'object' && value !== null) {
            structure[key] = {
                type: 'object',
                keys: Object.keys(value),
                sample: typeof value === 'string' ? value.substring(0, 50) : '[object]'
            };
        } else {
            structure[key] = {
                type: typeof value,
                sample: typeof value === 'string' ? value.substring(0, 50) : value
            };
        }
    }
    return structure;
}

// Start the test
startWhatsApp().catch(console.error);

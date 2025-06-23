#!/usr/bin/env node

import baileys from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import fs from 'fs';

const makeWASocket = baileys.default;
const { DisconnectReason, useMultiFileAuthState } = baileys;

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

console.log('🧪 Testing readMessages() API with Specific Chats');
console.log('📋 This test will:');
console.log('   1. Connect to WhatsApp');
console.log('   2. Wait for message history');
console.log('   3. Pick one group and one contact');
console.log('   4. Test readMessages() on their messages');
console.log('   5. Save detailed results to JSON files');
console.log('');

let sock;
let isConnected = false;
let selectedGroup = null;
let selectedContact = null;

// Import our improved message parsing functions
function getDisplayMessage(msg) {
    if (!msg) return '';
    
    let messageObj = msg.message;
    if (messageObj && messageObj.message) {
        messageObj = messageObj.message;
    }
    
    if (!messageObj) return '';
    
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

function getMessageKey(msg) {
    if (!msg) return null;
    
    if (msg.key) {
        return msg.key;
    }
    
    if (msg.message && msg.message.key) {
        return msg.message.key;
    }
    
    return null;
}

function getMessageTimestamp(msg) {
    if (!msg) return Date.now();
    
    let timestamp = msg.messageTimestamp;
    
    if (msg.message && msg.message.messageTimestamp) {
        timestamp = msg.message.messageTimestamp;
    }
    
    if (!timestamp) return Date.now();
    
    if (typeof timestamp === 'object' && timestamp.low !== undefined) {
        const low = timestamp.low >>> 0;
        const high = timestamp.high >>> 0;
        return (high * 0x100000000 + low) * 1000;
    }
    
    if (typeof timestamp === 'number') {
        return timestamp * 1000;
    }
    
    if (typeof timestamp === 'string') {
        return parseInt(timestamp) * 1000;
    }
    
    return Date.now();
}

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./test_readmessages_auth');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: logger,
        syncFullHistory: true,
        markOnlineOnConnect: false
    });

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
            console.log('⏳ Waiting for message history...');
            isConnected = true;
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Handle message history
    sock.ev.on('messaging-history.set', async (item) => {
        console.log('');
        console.log('🔥 MESSAGING HISTORY RECEIVED!');
        console.log(`📊 Chats: ${item.chats?.length || 0}, Is Latest: ${item.isLatest}`);
        
        if (item.chats && item.chats.length > 0) {
            // Find one group and one contact
            for (const chat of item.chats) {
                if (chat.id.endsWith('@g.us') && !selectedGroup && chat.messages?.length > 0) {
                    selectedGroup = chat;
                    console.log(`📱 Selected GROUP: ${chat.name || chat.id} (${chat.messages.length} messages)`);
                }
                
                if (chat.id.endsWith('@s.whatsapp.net') && !selectedContact && chat.messages?.length > 0) {
                    selectedContact = chat;
                    console.log(`👤 Selected CONTACT: ${chat.name || chat.id} (${chat.messages.length} messages)`);
                }
                
                if (selectedGroup && selectedContact) break;
            }
        }
        
        if (item.isLatest) {
            console.log('');
            console.log('✅ Final history batch received!');
            
            if (selectedGroup || selectedContact) {
                await testReadMessagesOnSelectedChats();
            } else {
                console.log('❌ No suitable group or contact found for testing');
            }
        }
    });
}

async function testReadMessagesOnSelectedChats() {
    console.log('');
    console.log('🧪 TESTING readMessages() API');
    console.log('');
    
    const results = {
        timestamp: new Date().toISOString(),
        group: null,
        contact: null,
        readMessagesResults: {
            group: null,
            contact: null
        }
    };
    
    // Test with group
    if (selectedGroup) {
        console.log(`📱 Testing readMessages() with GROUP: ${selectedGroup.name || selectedGroup.id}`);
        results.group = await testReadMessagesForChat(selectedGroup, 'group');
    }
    
    // Test with contact
    if (selectedContact) {
        console.log(`👤 Testing readMessages() with CONTACT: ${selectedContact.name || selectedContact.id}`);
        results.contact = await testReadMessagesForChat(selectedContact, 'contact');
    }
    
    // Save comprehensive results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsFile = `readMessages-test-results-${timestamp}.json`;
    
    try {
        fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
        console.log('');
        console.log(`💾 COMPREHENSIVE RESULTS SAVED TO: ${resultsFile}`);
        console.log('');
        console.log('📊 SUMMARY:');
        console.log(`   - Group tested: ${results.group ? 'YES' : 'NO'}`);
        console.log(`   - Contact tested: ${results.contact ? 'YES' : 'NO'}`);
        console.log(`   - Group readMessages success: ${results.readMessagesResults.group?.success || 'N/A'}`);
        console.log(`   - Contact readMessages success: ${results.readMessagesResults.contact?.success || 'N/A'}`);
        
    } catch (error) {
        console.log(`❌ Failed to save results: ${error.message}`);
    }
}

async function testReadMessagesForChat(chat, chatType) {
    const chatInfo = {
        jid: chat.id,
        name: chat.name,
        type: chatType,
        messageCount: chat.messages?.length || 0,
        messages: [],
        messageKeys: [],
        readMessagesTest: null
    };
    
    console.log(`   📋 Analyzing ${chat.messages?.length || 0} messages...`);
    
    // Analyze messages and collect keys
    for (let i = 0; i < Math.min(10, chat.messages?.length || 0); i++) {
        const msg = chat.messages[i];
        const messageKey = getMessageKey(msg);
        const content = getDisplayMessage(msg);
        const timestamp = getMessageTimestamp(msg);
        
        const messageInfo = {
            index: i,
            key: messageKey,
            content: content?.substring(0, 100) + (content?.length > 100 ? '...' : ''),
            timestamp: timestamp,
            timestampFormatted: new Date(timestamp).toISOString(),
            fromMe: messageKey?.fromMe || false,
            rawStructure: {
                topLevelKeys: Object.keys(msg),
                hasKey: !!msg.key,
                hasMessage: !!msg.message,
                messageKeys: msg.message ? Object.keys(msg.message) : []
            }
        };
        
        chatInfo.messages.push(messageInfo);
        
        if (messageKey && messageKey.id) {
            chatInfo.messageKeys.push(messageKey);
        }
    }
    
    console.log(`   🔑 Found ${chatInfo.messageKeys.length} valid message keys`);
    
    // Test readMessages() API
    if (chatInfo.messageKeys.length > 0) {
        console.log(`   🧪 Testing readMessages() with ${chatInfo.messageKeys.length} keys...`);
        
        try {
            const startTime = Date.now();
            await sock.readMessages(chatInfo.messageKeys);
            const duration = Date.now() - startTime;
            
            chatInfo.readMessagesTest = {
                success: true,
                duration: duration,
                keyCount: chatInfo.messageKeys.length,
                error: null
            };
            
            console.log(`   ✅ readMessages() SUCCESS in ${duration}ms`);
            
        } catch (error) {
            chatInfo.readMessagesTest = {
                success: false,
                duration: null,
                keyCount: chatInfo.messageKeys.length,
                error: {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                }
            };
            
            console.log(`   ❌ readMessages() FAILED: ${error.message}`);
        }
    } else {
        console.log(`   ⚠️ No valid message keys found for readMessages() test`);
        chatInfo.readMessagesTest = {
            success: false,
            duration: null,
            keyCount: 0,
            error: { message: 'No valid message keys found' }
        };
    }
    
    // Save individual chat results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `readMessages-${chatType}-${timestamp}.json`;
    
    try {
        fs.writeFileSync(filename, JSON.stringify(chatInfo, null, 2));
        console.log(`   💾 ${chatType.toUpperCase()} results saved to: ${filename}`);
    } catch (error) {
        console.log(`   ❌ Failed to save ${chatType} results: ${error.message}`);
    }
    
    return chatInfo;
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('');
    console.log('👋 Shutting down...');
    console.log('');
    process.exit(0);
});

// Start the test
startWhatsApp().catch(console.error);

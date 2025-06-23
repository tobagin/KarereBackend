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

console.log('🧪 Testing fetchMessageHistory() + readMessages() API');
console.log('📋 This test will:');
console.log('   1. Connect to WhatsApp');
console.log('   2. Wait for initial message history (1 message per chat)');
console.log('   3. Pick one group and one contact');
console.log('   4. Use fetchMessageHistory() to get MORE messages');
console.log('   5. Test readMessages() on the fetched messages');
console.log('   6. Save detailed results to JSON files');
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
    const { state, saveCreds } = await useMultiFileAuthState('./test_fetch_history_auth');
    
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
            console.log('⏳ Waiting for initial message history...');
            isConnected = true;
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Handle initial message history (1 message per chat)
    sock.ev.on('messaging-history.set', async (item) => {
        console.log('');
        console.log('🔥 INITIAL MESSAGING HISTORY RECEIVED!');
        console.log(`📊 Chats: ${item.chats?.length || 0}, Is Latest: ${item.isLatest}`);
        
        if (item.chats && item.chats.length > 0) {
            // Find one group and one contact
            for (const chat of item.chats) {
                if (chat.id.endsWith('@g.us') && !selectedGroup && chat.messages?.length > 0) {
                    selectedGroup = chat;
                    console.log(`📱 Selected GROUP: ${chat.name || chat.id} (${chat.messages.length} initial messages)`);
                }
                
                if (chat.id.endsWith('@s.whatsapp.net') && !selectedContact && chat.messages?.length > 0) {
                    selectedContact = chat;
                    console.log(`👤 Selected CONTACT: ${chat.name || chat.id} (${chat.messages.length} initial messages)`);
                }
                
                if (selectedGroup && selectedContact) break;
            }
        }
        
        if (item.isLatest) {
            console.log('');
            console.log('✅ Initial history sync complete!');
            
            if (selectedGroup || selectedContact) {
                await testFetchMessageHistory();
            } else {
                console.log('❌ No suitable group or contact found for testing');
            }
        }
    });
}

async function testFetchMessageHistory() {
    console.log('');
    console.log('🧪 TESTING fetchMessageHistory() + readMessages()');
    console.log('');
    
    const results = {
        timestamp: new Date().toISOString(),
        group: null,
        contact: null
    };
    
    // Test with group
    if (selectedGroup) {
        console.log(`📱 Testing fetchMessageHistory() with GROUP: ${selectedGroup.name || selectedGroup.id}`);
        results.group = await fetchAndTestMessages(selectedGroup, 'group');
    }
    
    // Test with contact
    if (selectedContact) {
        console.log(`👤 Testing fetchMessageHistory() with CONTACT: ${selectedContact.name || selectedContact.id}`);
        results.contact = await fetchAndTestMessages(selectedContact, 'contact');
    }
    
    // Save comprehensive results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsFile = `fetchHistory-test-results-${timestamp}.json`;
    
    try {
        fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
        console.log('');
        console.log(`💾 COMPREHENSIVE RESULTS SAVED TO: ${resultsFile}`);
        console.log('');
        console.log('📊 SUMMARY:');
        console.log(`   - Group tested: ${results.group ? 'YES' : 'NO'}`);
        console.log(`   - Contact tested: ${results.contact ? 'YES' : 'NO'}`);
        console.log(`   - Group fetchHistory success: ${results.group?.fetchHistoryTest?.success || 'N/A'}`);
        console.log(`   - Contact fetchHistory success: ${results.contact?.fetchHistoryTest?.success || 'N/A'}`);
        console.log(`   - Group readMessages success: ${results.group?.readMessagesTest?.success || 'N/A'}`);
        console.log(`   - Contact readMessages success: ${results.contact?.readMessagesTest?.success || 'N/A'}`);
        
    } catch (error) {
        console.log(`❌ Failed to save results: ${error.message}`);
    }
}

async function fetchAndTestMessages(chat, chatType) {
    const chatInfo = {
        jid: chat.id,
        name: chat.name,
        type: chatType,
        initialMessageCount: chat.messages?.length || 0,
        initialMessages: [],
        fetchedMessages: [],
        fetchHistoryTest: null,
        readMessagesTest: null
    };
    
    // Analyze initial messages
    console.log(`   📋 Initial messages: ${chat.messages?.length || 0}`);
    for (let i = 0; i < (chat.messages?.length || 0); i++) {
        const msg = chat.messages[i];
        const messageKey = getMessageKey(msg);
        const content = getDisplayMessage(msg);
        const timestamp = getMessageTimestamp(msg);
        
        chatInfo.initialMessages.push({
            index: i,
            key: messageKey,
            content: content?.substring(0, 100) + (content?.length > 100 ? '...' : ''),
            timestamp: timestamp,
            timestampFormatted: new Date(timestamp).toISOString(),
            fromMe: messageKey?.fromMe || false
        });
    }
    
    // Test fetchMessageHistory()
    console.log(`   🔍 Fetching more messages with fetchMessageHistory()...`);
    
    try {
        const startTime = Date.now();
        const fetchedMessages = await sock.fetchMessageHistory(chat.id, 20); // Try to get 20 messages
        const duration = Date.now() - startTime;
        
        chatInfo.fetchHistoryTest = {
            success: true,
            duration: duration,
            requestedCount: 20,
            receivedCount: fetchedMessages?.length || 0,
            error: null
        };
        
        console.log(`   ✅ fetchMessageHistory() SUCCESS in ${duration}ms`);
        console.log(`   📨 Received ${fetchedMessages?.length || 0} messages`);
        
        // Analyze fetched messages
        if (fetchedMessages && fetchedMessages.length > 0) {
            for (let i = 0; i < Math.min(10, fetchedMessages.length); i++) {
                const msg = fetchedMessages[i];
                const messageKey = getMessageKey(msg);
                const content = getDisplayMessage(msg);
                const timestamp = getMessageTimestamp(msg);
                
                chatInfo.fetchedMessages.push({
                    index: i,
                    key: messageKey,
                    content: content?.substring(0, 100) + (content?.length > 100 ? '...' : ''),
                    timestamp: timestamp,
                    timestampFormatted: new Date(timestamp).toISOString(),
                    fromMe: messageKey?.fromMe || false
                });
            }
            
            // Test readMessages() on fetched messages
            await testReadMessagesOnFetched(chatInfo, fetchedMessages);
        }
        
    } catch (error) {
        chatInfo.fetchHistoryTest = {
            success: false,
            duration: null,
            requestedCount: 20,
            receivedCount: 0,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            }
        };
        
        console.log(`   ❌ fetchMessageHistory() FAILED: ${error.message}`);
    }
    
    // Save individual chat results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `fetchHistory-${chatType}-${timestamp}.json`;
    
    try {
        fs.writeFileSync(filename, JSON.stringify(chatInfo, null, 2));
        console.log(`   💾 ${chatType.toUpperCase()} results saved to: ${filename}`);
    } catch (error) {
        console.log(`   ❌ Failed to save ${chatType} results: ${error.message}`);
    }
    
    return chatInfo;
}

async function testReadMessagesOnFetched(chatInfo, fetchedMessages) {
    console.log(`   🧪 Testing readMessages() on fetched messages...`);
    
    // Collect message keys from fetched messages
    const messageKeys = [];
    for (let i = 0; i < Math.min(5, fetchedMessages.length); i++) {
        const messageKey = getMessageKey(fetchedMessages[i]);
        if (messageKey && messageKey.id) {
            messageKeys.push(messageKey);
        }
    }
    
    if (messageKeys.length > 0) {
        try {
            const startTime = Date.now();
            await sock.readMessages(messageKeys);
            const duration = Date.now() - startTime;
            
            chatInfo.readMessagesTest = {
                success: true,
                duration: duration,
                keyCount: messageKeys.length,
                error: null
            };
            
            console.log(`   ✅ readMessages() SUCCESS in ${duration}ms on ${messageKeys.length} messages`);
            
        } catch (error) {
            chatInfo.readMessagesTest = {
                success: false,
                duration: null,
                keyCount: messageKeys.length,
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

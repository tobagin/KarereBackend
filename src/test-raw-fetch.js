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

console.log('🔍 RAW fetchMessageHistory() Analysis');
console.log('📋 This test will examine the raw structure of fetched messages');
console.log('');

let sock;
let selectedGroup = null;
let selectedContact = null;

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./test_raw_fetch_auth');
    
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
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Handle initial message history
    sock.ev.on('messaging-history.set', async (item) => {
        console.log('');
        console.log('🔥 MESSAGING HISTORY RECEIVED!');
        console.log(`📊 Chats: ${item.chats?.length || 0}, Is Latest: ${item.isLatest}`);
        
        if (item.chats && item.chats.length > 0) {
            // Find one group and one contact
            for (const chat of item.chats) {
                if (chat.id.endsWith('@g.us') && !selectedGroup && chat.messages?.length > 0) {
                    selectedGroup = chat;
                    console.log(`📱 Selected GROUP: ${chat.name || chat.id}`);
                }
                
                if (chat.id.endsWith('@s.whatsapp.net') && !selectedContact && chat.messages?.length > 0) {
                    selectedContact = chat;
                    console.log(`👤 Selected CONTACT: ${chat.name || chat.id}`);
                }
                
                if (selectedGroup && selectedContact) break;
            }
        }
        
        if (item.isLatest) {
            console.log('');
            console.log('✅ Initial history sync complete!');
            
            if (selectedGroup) {
                await analyzeRawFetchedMessages(selectedGroup, 'group');
            }
            
            if (selectedContact) {
                await analyzeRawFetchedMessages(selectedContact, 'contact');
            }
        }
    });
}

async function analyzeRawFetchedMessages(chat, chatType) {
    console.log('');
    console.log(`🔍 ANALYZING RAW FETCHED MESSAGES FOR ${chatType.toUpperCase()}: ${chat.name || chat.id}`);
    
    try {
        console.log('   📡 Calling fetchMessageHistory()...');
        const fetchedMessages = await sock.fetchMessageHistory(chat.id, 10);
        
        console.log(`   ✅ Received ${fetchedMessages?.length || 0} messages`);
        
        if (fetchedMessages && fetchedMessages.length > 0) {
            // Save raw structure of first few messages
            const rawAnalysis = {
                chatId: chat.id,
                chatName: chat.name,
                chatType: chatType,
                totalFetched: fetchedMessages.length,
                rawMessages: []
            };
            
            // Analyze first 5 messages in detail
            for (let i = 0; i < Math.min(5, fetchedMessages.length); i++) {
                const msg = fetchedMessages[i];
                
                console.log(`   📨 Message ${i + 1}:`);
                console.log(`      - Type: ${typeof msg}`);
                console.log(`      - Top-level keys: ${Object.keys(msg || {})}`);
                
                const messageAnalysis = {
                    index: i,
                    type: typeof msg,
                    topLevelKeys: Object.keys(msg || {}),
                    rawMessage: msg,
                    hasKey: !!msg?.key,
                    hasMessage: !!msg?.message,
                    hasMessageTimestamp: !!msg?.messageTimestamp,
                    keyStructure: msg?.key ? Object.keys(msg.key) : null,
                    messageStructure: msg?.message ? Object.keys(msg.message) : null
                };
                
                if (msg?.key) {
                    console.log(`      - Key: ${JSON.stringify(msg.key)}`);
                }
                
                if (msg?.message) {
                    console.log(`      - Message keys: ${Object.keys(msg.message)}`);
                    
                    // Check for nested message structure
                    if (msg.message.message) {
                        console.log(`      - Nested message keys: ${Object.keys(msg.message.message)}`);
                    }
                    
                    // Check for conversation
                    if (msg.message.conversation) {
                        console.log(`      - Conversation: "${msg.message.conversation}"`);
                    } else if (msg.message.message?.conversation) {
                        console.log(`      - Nested conversation: "${msg.message.message.conversation}"`);
                    }
                }
                
                if (msg?.messageTimestamp) {
                    console.log(`      - Timestamp: ${msg.messageTimestamp} (${typeof msg.messageTimestamp})`);
                }
                
                rawAnalysis.rawMessages.push(messageAnalysis);
                console.log('');
            }
            
            // Save detailed analysis
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `raw-fetch-analysis-${chatType}-${timestamp}.json`;
            
            try {
                fs.writeFileSync(filename, JSON.stringify(rawAnalysis, null, 2));
                console.log(`   💾 Raw analysis saved to: ${filename}`);
            } catch (error) {
                console.log(`   ❌ Failed to save analysis: ${error.message}`);
            }
            
            // Test readMessages with proper key extraction
            await testReadMessagesWithRawData(fetchedMessages, chat.id, chatType);
            
        } else {
            console.log('   ⚠️ No messages fetched');
        }
        
    } catch (error) {
        console.log(`   ❌ fetchMessageHistory() failed: ${error.message}`);
        console.log(`   🔍 Error details:`, error);
    }
}

async function testReadMessagesWithRawData(fetchedMessages, chatId, chatType) {
    console.log(`   🧪 Testing readMessages() with raw data analysis...`);
    
    const messageKeys = [];
    
    // Extract keys more carefully
    for (let i = 0; i < Math.min(3, fetchedMessages.length); i++) {
        const msg = fetchedMessages[i];
        
        let messageKey = null;
        
        // Try different key extraction methods
        if (msg?.key) {
            messageKey = msg.key;
        } else if (msg?.message?.key) {
            messageKey = msg.message.key;
        }
        
        if (messageKey && messageKey.id) {
            messageKeys.push(messageKey);
            console.log(`      ✅ Found valid key: ${messageKey.id} (fromMe: ${messageKey.fromMe})`);
        } else {
            console.log(`      ❌ No valid key found in message ${i + 1}`);
        }
    }
    
    if (messageKeys.length > 0) {
        try {
            console.log(`   📨 Testing readMessages() with ${messageKeys.length} keys...`);
            
            const startTime = Date.now();
            await sock.readMessages(messageKeys);
            const duration = Date.now() - startTime;
            
            console.log(`   ✅ readMessages() SUCCESS in ${duration}ms`);
            
            // Save readMessages test results
            const readTestResults = {
                chatId: chatId,
                chatType: chatType,
                success: true,
                duration: duration,
                keyCount: messageKeys.length,
                testedKeys: messageKeys
            };
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `readMessages-test-${chatType}-${timestamp}.json`;
            
            fs.writeFileSync(filename, JSON.stringify(readTestResults, null, 2));
            console.log(`   💾 readMessages test results saved to: ${filename}`);
            
        } catch (error) {
            console.log(`   ❌ readMessages() FAILED: ${error.message}`);
        }
    } else {
        console.log(`   ⚠️ No valid message keys found for readMessages() test`);
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

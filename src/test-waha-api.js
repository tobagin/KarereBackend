#!/usr/bin/env node

import axios from 'axios';
import fs from 'fs';

console.log('🧪 Testing WAHA API for Message History');
console.log('📋 This test will:');
console.log('   1. Start WAHA with Baileys engine');
console.log('   2. Create a WhatsApp session');
console.log('   3. Get chat list');
console.log('   4. Test message history for group and contact');
console.log('   5. Test readMessages functionality');
console.log('   6. Compare with our current Baileys implementation');
console.log('');

const WAHA_URL = 'http://localhost:3000';
const SESSION_NAME = 'karere-test';

// Test configuration
const config = {
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json'
    }
};

async function testWAHA() {
    try {
        console.log('🚀 Starting WAHA API Tests...');
        console.log('');
        
        // Step 1: Check WAHA status
        await checkWAHAStatus();
        
        // Step 2: Start session
        await startSession();
        
        // Step 3: Wait for QR code and connection
        await waitForConnection();
        
        // Step 4: Get chats
        const chats = await getChats();
        
        // Step 5: Test message history
        await testMessageHistory(chats);
        
        // Step 6: Test readMessages
        await testReadMessages(chats);
        
        console.log('');
        console.log('✅ WAHA API tests completed!');
        
    } catch (error) {
        console.error('❌ WAHA test failed:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
    }
}

async function checkWAHAStatus() {
    console.log('🔍 Checking WAHA status...');
    
    try {
        const response = await axios.get(`${WAHA_URL}/api/health`, config);
        console.log('✅ WAHA is running:', response.data);
    } catch (error) {
        console.log('❌ WAHA is not running. Please start it with:');
        console.log('   docker run -it -p 3000:3000 devlikeapro/waha:latest');
        throw error;
    }
}

async function startSession() {
    console.log('🔄 Starting WhatsApp session...');
    
    const sessionConfig = {
        name: SESSION_NAME,
        config: {
            engine: 'BAILEYS', // Use Baileys engine (no Chromium)
            webhooks: []
        }
    };
    
    try {
        const response = await axios.post(`${WAHA_URL}/api/sessions/start`, sessionConfig, config);
        console.log('✅ Session started:', response.data);
        return response.data;
    } catch (error) {
        if (error.response?.status === 409) {
            console.log('ℹ️ Session already exists, continuing...');
            return;
        }
        throw error;
    }
}

async function waitForConnection() {
    console.log('⏳ Waiting for WhatsApp connection...');
    console.log('📱 Please scan QR code if prompted...');
    
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes
    
    while (attempts < maxAttempts) {
        try {
            const response = await axios.get(`${WAHA_URL}/api/sessions/${SESSION_NAME}`, config);
            const status = response.data.status;
            
            console.log(`   Status: ${status} (attempt ${attempts + 1}/${maxAttempts})`);
            
            if (status === 'WORKING') {
                console.log('✅ WhatsApp connected successfully!');
                return;
            }
            
            if (status === 'SCAN_QR_CODE') {
                // Get QR code
                try {
                    const qrResponse = await axios.get(`${WAHA_URL}/api/sessions/${SESSION_NAME}/auth/qr`, config);
                    console.log('📱 QR Code available at:', `${WAHA_URL}/api/sessions/${SESSION_NAME}/auth/qr`);
                } catch (qrError) {
                    // QR might not be ready yet
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            attempts++;
            
        } catch (error) {
            console.log(`   Connection check failed: ${error.message}`);
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    
    throw new Error('Failed to connect to WhatsApp within timeout');
}

async function getChats() {
    console.log('📋 Getting chat list...');
    
    try {
        const response = await axios.get(`${WAHA_URL}/api/sessions/${SESSION_NAME}/chats`, config);
        const chats = response.data;
        
        console.log(`✅ Found ${chats.length} chats`);
        
        // Find a group and a contact
        const group = chats.find(chat => chat.id.endsWith('@g.us'));
        const contact = chats.find(chat => chat.id.endsWith('@s.whatsapp.net'));
        
        if (group) {
            console.log(`📱 Found group: ${group.name || group.id}`);
        }
        
        if (contact) {
            console.log(`👤 Found contact: ${contact.name || contact.id}`);
        }
        
        // Save chat list for analysis
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.writeFileSync(`waha-chats-${timestamp}.json`, JSON.stringify(chats, null, 2));
        console.log(`💾 Chat list saved to: waha-chats-${timestamp}.json`);
        
        return { chats, group, contact };
        
    } catch (error) {
        console.error('❌ Failed to get chats:', error.message);
        throw error;
    }
}

async function testMessageHistory(chatData) {
    console.log('');
    console.log('🔍 Testing message history...');
    
    const { group, contact } = chatData;
    const results = {
        timestamp: new Date().toISOString(),
        group: null,
        contact: null
    };
    
    // Test group messages
    if (group) {
        console.log(`📱 Testing message history for group: ${group.name || group.id}`);
        results.group = await getMessagesForChat(group, 'group');
    }
    
    // Test contact messages
    if (contact) {
        console.log(`👤 Testing message history for contact: ${contact.name || contact.id}`);
        results.contact = await getMessagesForChat(contact, 'contact');
    }
    
    // Save results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(`waha-message-history-${timestamp}.json`, JSON.stringify(results, null, 2));
    console.log(`💾 Message history results saved to: waha-message-history-${timestamp}.json`);
    
    return results;
}

async function getMessagesForChat(chat, chatType) {
    try {
        console.log(`   📨 Fetching messages for ${chatType}...`);
        
        // Test different limits to see how many messages we can get
        const limits = [10, 20, 50];
        const results = {};
        
        for (const limit of limits) {
            try {
                const response = await axios.get(
                    `${WAHA_URL}/api/sessions/${SESSION_NAME}/chats/${encodeURIComponent(chat.id)}/messages`,
                    {
                        ...config,
                        params: { limit }
                    }
                );
                
                const messages = response.data;
                results[`limit_${limit}`] = {
                    requested: limit,
                    received: messages.length,
                    messages: messages.slice(0, 3).map(msg => ({
                        id: msg.id,
                        body: msg.body?.substring(0, 100) || '[No body]',
                        timestamp: msg.timestamp,
                        fromMe: msg.fromMe,
                        type: msg.type
                    }))
                };
                
                console.log(`      Limit ${limit}: Got ${messages.length} messages`);
                
            } catch (error) {
                console.log(`      Limit ${limit}: Failed - ${error.message}`);
                results[`limit_${limit}`] = { error: error.message };
            }
        }
        
        return {
            chatId: chat.id,
            chatName: chat.name,
            chatType: chatType,
            results: results
        };
        
    } catch (error) {
        console.error(`   ❌ Failed to get messages for ${chatType}:`, error.message);
        return {
            chatId: chat.id,
            chatName: chat.name,
            chatType: chatType,
            error: error.message
        };
    }
}

async function testReadMessages(chatData) {
    console.log('');
    console.log('🧪 Testing readMessages functionality...');
    
    const { group, contact } = chatData;
    
    // Test with group
    if (group) {
        await testReadMessagesForChat(group, 'group');
    }
    
    // Test with contact
    if (contact) {
        await testReadMessagesForChat(contact, 'contact');
    }
}

async function testReadMessagesForChat(chat, chatType) {
    try {
        console.log(`   📖 Testing readMessages for ${chatType}: ${chat.name || chat.id}`);
        
        // First get some messages
        const response = await axios.get(
            `${WAHA_URL}/api/sessions/${SESSION_NAME}/chats/${encodeURIComponent(chat.id)}/messages`,
            {
                ...config,
                params: { limit: 5 }
            }
        );
        
        const messages = response.data;
        if (messages.length === 0) {
            console.log(`      ⚠️ No messages found for ${chatType}`);
            return;
        }
        
        // Try to mark messages as read
        const readResponse = await axios.post(
            `${WAHA_URL}/api/sessions/${SESSION_NAME}/chats/${encodeURIComponent(chat.id)}/messages/read`,
            {},
            config
        );
        
        console.log(`      ✅ readMessages successful for ${chatType}:`, readResponse.data);
        
    } catch (error) {
        console.log(`      ❌ readMessages failed for ${chatType}:`, error.message);
    }
}

// Start the test
console.log('🚀 Make sure WAHA is running with:');
console.log('   docker run -it -p 3000:3000 devlikeapro/waha:latest');
console.log('');

testWAHA().catch(console.error);

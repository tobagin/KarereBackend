#!/usr/bin/env node
// test-websocket-client.js
// Test WebSocket client to verify enhanced backend functionality

import WebSocket from 'ws';

const WS_URL = 'ws://localhost:8765';

class TestClient {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.responses = new Map();
    }

    async connect() {
        return new Promise((resolve, reject) => {
            console.log('🔌 Connecting to backend...');
            
            this.ws = new WebSocket(WS_URL);
            
            this.ws.on('open', () => {
                console.log('✅ Connected to backend WebSocket');
                this.connected = true;
                resolve();
            });
            
            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(message);
                } catch (error) {
                    console.error('❌ Error parsing message:', error);
                }
            });
            
            this.ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
                reject(error);
            });
            
            this.ws.on('close', () => {
                console.log('🔌 WebSocket connection closed');
                this.connected = false;
            });
        });
    }

    handleMessage(message) {
        const { type, data } = message;
        
        console.log(`📨 Received: ${type}`);
        
        switch (type) {
            case 'initial_chats':
                this.handleInitialChats(data);
                break;
            case 'contact_info':
                this.handleContactInfo(data);
                break;
            case 'sync_contacts_started':
                console.log('🔄 Contact sync started:', data);
                break;
            case 'sync_contacts_progress':
                console.log('📊 Contact sync progress:', data);
                break;
            case 'sync_contacts_completed':
                console.log('✅ Contact sync completed:', data);
                break;
            case 'message_history':
                this.handleMessageHistory(data);
                break;
            case 'health_status':
                this.handleHealthStatus(data);
                break;
            case 'error':
                console.error('❌ Backend error:', data);
                break;
            default:
                console.log(`📋 ${type}:`, data);
        }
    }

    handleInitialChats(data) {
        console.log('\n📋 Initial Chats Received:');
        console.log(`   Total chats: ${data.chats?.length || 0}`);
        
        if (data.chats && data.chats.length > 0) {
            console.log('\n   Sample chats with enhanced data:');
            
            // Show first 5 chats with detailed info
            data.chats.slice(0, 5).forEach((chat, index) => {
                console.log(`   ${index + 1}. ${chat.name || chat.jid}`);
                console.log(`      JID: ${chat.jid}`);
                console.log(`      Contact Name: ${chat.contactName || 'N/A'}`);
                console.log(`      Phone: ${chat.phoneNumber || 'N/A'}`);
                console.log(`      Avatar: ${chat.avatarPath ? '✅ Available' : '❌ Missing'}`);
                console.log(`      Last Message: ${chat.lastMessage || 'N/A'}`);
                console.log(`      Timestamp: ${chat.timestamp ? new Date(chat.timestamp).toLocaleString() : 'N/A'}`);
                console.log('');
            });
        }
    }

    handleContactInfo(data) {
        console.log('\n👤 Contact Info Received:');
        console.log(`   JID: ${data.jid}`);
        console.log(`   Contact Info:`, data.contactInfo);
    }

    handleMessageHistory(data) {
        console.log('\n💬 Message History Received:');
        console.log(`   JID: ${data.jid}`);
        console.log(`   Messages: ${data.messages?.length || 0}`);
        
        if (data.messages && data.messages.length > 0) {
            console.log('\n   Recent messages:');
            data.messages.slice(-3).forEach((msg, index) => {
                const sender = msg.fromMe ? 'You' : 'Contact';
                const time = new Date(msg.timestamp).toLocaleTimeString();
                console.log(`   ${sender} (${time}): ${msg.text}`);
            });
        }
    }

    handleHealthStatus(data) {
        console.log('\n🏥 Health Status:');
        console.log(`   Backend: ${data.backend?.status || 'unknown'}`);
        console.log(`   Baileys: ${data.baileys?.connected ? '✅ Connected' : '❌ Disconnected'}`);
        console.log(`   Database: ${data.database?.healthy ? '✅ Healthy' : '❌ Unhealthy'}`);
    }

    send(type, data = {}) {
        if (!this.connected) {
            console.error('❌ Not connected to backend');
            return;
        }
        
        const message = JSON.stringify({ type, data });
        this.ws.send(message);
        console.log(`📤 Sent: ${type}`);
    }

    async runTests() {
        console.log('\n🧪 Running Enhanced Backend Tests...\n');
        
        try {
            // Test 1: Get initial chats with enhanced data
            console.log('📋 Test 1: Getting initial chats with enhanced contact data');
            this.send('get_initial_chats');
            
            // Wait a bit for response
            await this.wait(2000);
            
            // Test 2: Health check
            console.log('\n🏥 Test 2: Health check');
            this.send('health_check');
            
            await this.wait(1000);
            
            // Test 3: Manual contact sync
            console.log('\n🔄 Test 3: Manual contact synchronization');
            this.send('sync_contacts');
            
            await this.wait(5000);
            
            // Test 4: Get contact info for a specific contact
            console.log('\n👤 Test 4: Getting specific contact info');
            // Use a JID from the chats if available
            this.send('get_contact_info', { jid: '5511985477737@s.whatsapp.net' });
            
            await this.wait(2000);
            
            // Test 5: Get message history with enhanced data
            console.log('\n💬 Test 5: Getting message history');
            this.send('get_message_history', { 
                jid: '5511985477737@s.whatsapp.net', 
                limit: 10 
            });
            
            await this.wait(2000);
            
            console.log('\n✅ All tests completed!');
            
        } catch (error) {
            console.error('❌ Test failed:', error);
        }
    }

    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

// Run the test client
async function main() {
    const client = new TestClient();
    
    try {
        await client.connect();
        await client.runTests();
        
        // Keep connection open for a bit to see any additional messages
        console.log('\n⏳ Waiting for any additional messages...');
        await client.wait(3000);
        
    } catch (error) {
        console.error('❌ Test client failed:', error);
    } finally {
        client.disconnect();
        console.log('\n👋 Test client finished');
        process.exit(0);
    }
}

// Run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export default TestClient;

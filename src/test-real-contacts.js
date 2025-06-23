#!/usr/bin/env node
// test-real-contacts.js
// Test with real contact data from your WhatsApp

import WebSocket from 'ws';
import database from './database.js';

const WS_URL = 'ws://localhost:8765';

class RealContactTester {
    constructor() {
        this.ws = null;
        this.connected = false;
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
                console.log('📊 Contact sync progress:', `${data.processed}/${data.total} (${data.synced} synced)`);
                break;
            case 'sync_contacts_completed':
                console.log('✅ Contact sync completed:', data);
                break;
            default:
                console.log(`📋 ${type}:`, data);
        }
    }

    handleInitialChats(data) {
        console.log('\n📋 Real Chats Data:');
        console.log(`   Total chats: ${data.chats?.length || 0}`);
        
        if (data.chats && data.chats.length > 0) {
            console.log('\n   Real contacts with enhanced data:');
            
            // Show first 5 real chats
            data.chats.slice(0, 5).forEach((chat, index) => {
                console.log(`   ${index + 1}. ${chat.name || chat.jid}`);
                console.log(`      JID: ${chat.jid}`);
                console.log(`      Contact Name: ${chat.contact_name || 'N/A'}`);
                console.log(`      Phone: ${chat.phoneNumber || 'N/A'}`);
                console.log(`      Avatar: ${chat.avatarPath ? '✅ Available' : '❌ Missing'}`);
                console.log(`      Last Message: ${(chat.lastMessage || 'N/A').substring(0, 50)}${chat.lastMessage?.length > 50 ? '...' : ''}`);
                console.log(`      Timestamp: ${chat.timestamp ? new Date(chat.timestamp).toLocaleString() : 'N/A'}`);
                console.log('');
            });
        }
    }

    handleContactInfo(data) {
        console.log('\n👤 Real Contact Info:');
        console.log(`   JID: ${data.jid}`);
        console.log(`   Name: ${data.contactInfo?.name || 'N/A'}`);
        console.log(`   Phone: ${data.contactInfo?.phoneNumber || 'N/A'}`);
        console.log(`   Avatar: ${data.contactInfo?.avatarPath ? '✅ Available' : '❌ Missing'}`);
        console.log(`   Avatar Path: ${data.contactInfo?.avatarPath || 'N/A'}`);
        console.log(`   Blocked: ${data.contactInfo?.isBlocked ? 'Yes' : 'No'}`);
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

    async testRealContacts() {
        console.log('\n🧪 Testing with Real Contact Data...\n');
        
        try {
            // First, let's check what real contacts we have in the database
            await database.initialize();
            
            console.log('📋 Checking real chats in database:');
            const chats = await database.getChats(10);
            
            if (chats.length > 0) {
                console.log(`   Found ${chats.length} chats`);
                
                // Show first few real contacts
                chats.slice(0, 3).forEach((chat, index) => {
                    console.log(`   ${index + 1}. ${chat.name || chat.jid}`);
                    console.log(`      JID: ${chat.jid}`);
                    console.log(`      Contact Name: ${chat.contact_name || 'N/A'}`);
                    console.log(`      Avatar Path: ${chat.contact_avatar_path || 'N/A'}`);
                    console.log('');
                });
            }
            
            await database.close();
            
            // Test 1: Get initial chats with real data
            console.log('\n📋 Test 1: Getting real chats via WebSocket');
            this.send('get_initial_chats');
            
            await this.wait(3000);
            
            // Test 2: Test with a real contact - Ricardo Passos
            console.log('\n👤 Test 2: Getting info for real contact - Ricardo Passos');
            this.send('get_contact_info', { jid: '557188526333@s.whatsapp.net' });
            
            await this.wait(2000);
            
            // Test 3: Test with another real contact - Karl
            console.log('\n👤 Test 3: Getting info for real contact - Karl');
            this.send('get_contact_info', { jid: '353861675210@s.whatsapp.net' });
            
            await this.wait(2000);
            
            // Test 4: Manual sync to ensure all real contacts get processed
            console.log('\n🔄 Test 4: Manual sync of real contacts');
            this.send('sync_contacts');
            
            await this.wait(10000); // Wait longer for sync to complete
            
            // Test 5: Check results after sync
            console.log('\n📊 Test 5: Checking results after sync');
            this.send('get_contact_info', { jid: '557188526333@s.whatsapp.net' });
            
            await this.wait(2000);
            
            console.log('\n✅ Real contact tests completed!');
            
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

// Run the real contact test
async function main() {
    const tester = new RealContactTester();
    
    try {
        await tester.connect();
        await tester.testRealContacts();
        
        console.log('\n⏳ Waiting for any additional messages...');
        await tester.wait(3000);
        
    } catch (error) {
        console.error('❌ Real contact test failed:', error);
    } finally {
        tester.disconnect();
        console.log('\n👋 Real contact test finished');
        process.exit(0);
    }
}

// Run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export default RealContactTester;

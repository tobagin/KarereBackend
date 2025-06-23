#!/usr/bin/env node
// download-all-contact-data.js
// Comprehensive download of all contact data with base64 avatars

import WebSocket from 'ws';
import database from './database.js';

const WS_URL = 'ws://localhost:8765';

class ComprehensiveDownloader {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.totalChats = 0;
        this.processedChats = 0;
        this.successfulDownloads = 0;
        this.errors = 0;
        this.startTime = Date.now();
    }

    async connect() {
        return new Promise((resolve, reject) => {
            console.log('🔌 Connecting to backend for comprehensive download...');
            
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
        
        switch (type) {
            case 'sync_started':
                console.log('🚀 Contact synchronization started');
                break;
                
            case 'sync_progress':
                this.processedChats = data.processed || 0;
                this.totalChats = data.total || 0;
                this.successfulDownloads = data.successful || 0;
                this.errors = data.errors || 0;
                
                const progress = this.totalChats > 0 ? (this.processedChats / this.totalChats * 100).toFixed(1) : 0;
                console.log(`📊 Progress: ${this.processedChats}/${this.totalChats} (${progress}%) - ✅ ${this.successfulDownloads} successful, ❌ ${this.errors} errors`);
                break;
                
            case 'sync_complete':
                console.log('✅ Contact synchronization completed');
                this.showFinalResults();
                break;
                
            case 'sync_error':
                console.error('❌ Synchronization error:', data.message || 'Unknown error');
                break;
                
            default:
                // Ignore other message types
                break;
        }
    }

    send(type, data = {}) {
        if (this.connected && this.ws) {
            this.ws.send(JSON.stringify({ type, data }));
        }
    }

    async run() {
        console.log('🎯 Karere Contact Data Downloader');
        console.log('📥 This will download comprehensive contact information with base64 avatars');
        console.log('');
        
        try {
            // Step 1: Check current database state
            await database.initialize();
            
            console.log('📋 Current database state:');
            const chats = await database.getChats(1000);
            const contacts = await database.getAllContacts(1000);
            
            console.log(`   💬 Chats in database: ${chats.length}`);
            console.log(`   👤 Contacts in database: ${contacts.length}`);
            
            // Count contacts with base64 avatars
            const contactsWithAvatars = contacts.filter(c => c.avatar_base64);
            console.log(`   🖼️ Contacts with avatars: ${contactsWithAvatars.length}`);
            
            await database.close();
            
            // Step 2: Connect to backend
            await this.connect();
            
            // Step 3: Trigger comprehensive sync via WebSocket
            console.log('\n🚀 Triggering comprehensive contact synchronization...');
            this.send('sync_contacts');
            
            // Wait for completion
            await this.waitForCompletion();
            
        } catch (error) {
            console.error('❌ Error during download:', error);
            process.exit(1);
        }
    }

    async waitForCompletion() {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (!this.connected) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 1000);
            
            // Also listen for sync_complete message
            const originalHandleMessage = this.handleMessage.bind(this);
            this.handleMessage = (message) => {
                originalHandleMessage(message);
                if (message.type === 'sync_complete' || message.type === 'sync_error') {
                    setTimeout(() => {
                        clearInterval(checkInterval);
                        resolve();
                    }, 2000); // Wait a bit for final stats
                }
            };
        });
    }

    async showFinalResults() {
        console.log('\n📊 Final Results Summary');
        console.log('========================');
        
        try {
            await database.initialize();
            
            // Get updated stats
            const chats = await database.getChats(1000);
            const contacts = await database.getAllContacts(1000);
            const contactsWithAvatars = contacts.filter(c => c.avatar_base64);
            
            console.log(`   💬 Total chats: ${chats.length}`);
            console.log(`   👤 Total contacts: ${contacts.length}`);
            console.log(`   🖼️ Contacts with base64 avatars: ${contactsWithAvatars.length}`);
            
            const duration = (Date.now() - this.startTime) / 1000;
            console.log(`   ⏱️ Total time: ${duration.toFixed(1)} seconds`);
            
            // Show sample of successfully downloaded contacts
            if (contactsWithAvatars.length > 0) {
                console.log('\n✅ Sample of contacts with complete data:');
                const sampleContacts = contactsWithAvatars.slice(0, 5);
                
                sampleContacts.forEach((contact, index) => {
                    console.log(`   ${index + 1}. ${contact.name || contact.jid}`);
                    console.log(`      JID: ${contact.jid}`);
                    console.log(`      Avatar: ✅ (base64 data)`);
                    console.log(`      Updated: ${new Date(contact.updated_at * 1000).toLocaleString()}`);
                    console.log('');
                });
            }
            
            // Show chats with enhanced data
            console.log('💬 Sample of chats with contact integration:');
            const enhancedChats = chats.filter(c => c.contact_name || c.contact_avatar_base64).slice(0, 5);
            
            enhancedChats.forEach((chat, index) => {
                console.log(`   ${index + 1}. ${chat.contact_name || chat.name || chat.jid}`);
                console.log(`      JID: ${chat.jid}`);
                console.log(`      Contact Name: ${chat.contact_name || 'N/A'}`);
                console.log(`      Avatar: ${chat.contact_avatar_base64 ? '✅' : '❌'}`);
                console.log(`      Last Message: ${(chat.last_message_content || 'N/A').substring(0, 50)}${chat.last_message_content?.length > 50 ? '...' : ''}`);
                console.log('');
            });
            
            await database.close();
            
        } catch (error) {
            console.error('❌ Error showing final results:', error);
        }
        
        console.log('🎉 Contact data download completed!');
        console.log('💡 All avatars are now stored as base64 data in the database.');
        
        if (this.ws) {
            this.ws.close();
        }
        
        process.exit(0);
    }
}

// Run the downloader
const downloader = new ComprehensiveDownloader();
downloader.run().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});

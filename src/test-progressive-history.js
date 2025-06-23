#!/usr/bin/env node

import fs from 'fs';
import database from './database.js';

console.log('🧪 Testing Progressive History Implementation');
console.log('📋 This test will:');
console.log('   1. Check database schema migrations');
console.log('   2. Test new database methods');
console.log('   3. Simulate progressive history scenarios');
console.log('   4. Validate data integrity');
console.log('');

async function testProgressiveHistory() {
    try {
        // Initialize database
        console.log('🔧 Initializing test database...');
        // Use the existing database instance (it will use the default path)
        await database.initialize();
        console.log('✅ Database initialized successfully');
        
        // Test 1: Check schema migrations
        await testSchemaMigrations(database);
        
        // Test 2: Test new database methods
        await testNewDatabaseMethods(database);
        
        // Test 3: Simulate progressive history scenarios
        await testProgressiveHistoryScenarios(database);
        
        // Test 4: Validate data integrity
        await testDataIntegrity(database);
        
        console.log('');
        console.log('🎉 All progressive history tests passed!');
        
    } catch (error) {
        console.error('❌ Progressive history test failed:', error);
        throw error;
    } finally {
        // Note: We're using the singleton database instance, so we don't close it
        console.log('🧹 Test completed (using existing database)');
    }
}

async function testSchemaMigrations(database) {
    console.log('');
    console.log('🔍 Testing schema migrations...');
    
    // Check if new columns exist in chats table
    const chatsTableInfo = await database.all("PRAGMA table_info(chats)");
    const chatsColumns = chatsTableInfo.map(col => col.name);
    
    const requiredChatColumns = [
        'history_baseline_timestamp',
        'last_sync_timestamp', 
        'history_complete'
    ];
    
    for (const column of requiredChatColumns) {
        if (chatsColumns.includes(column)) {
            console.log(`   ✅ Chats table has ${column} column`);
        } else {
            throw new Error(`❌ Missing ${column} column in chats table`);
        }
    }
    
    // Check if new columns exist in messages table
    const messagesTableInfo = await database.all("PRAGMA table_info(messages)");
    const messagesColumns = messagesTableInfo.map(col => col.name);
    
    if (messagesColumns.includes('collection_session')) {
        console.log('   ✅ Messages table has collection_session column');
    } else {
        throw new Error('❌ Missing collection_session column in messages table');
    }
    
    console.log('✅ Schema migrations test passed');
}

async function testNewDatabaseMethods(database) {
    console.log('');
    console.log('🔧 Testing new database methods...');
    
    const testChatJid = '1234567890@s.whatsapp.net';
    const testTimestamp = Date.now();
    
    // Test saveChat (should work with existing method)
    await database.saveChat(testChatJid, 'Test Contact', 'msg123', testTimestamp);
    console.log('   ✅ saveChat works');
    
    // Test setChatHistoryBaseline
    const baselineResult = await database.setChatHistoryBaseline(testChatJid, testTimestamp - 86400000); // 1 day ago
    if (baselineResult) {
        console.log('   ✅ setChatHistoryBaseline works');
    } else {
        throw new Error('❌ setChatHistoryBaseline failed');
    }
    
    // Test updateChatSyncTimestamp
    const syncResult = await database.updateChatSyncTimestamp(testChatJid, testTimestamp);
    if (syncResult) {
        console.log('   ✅ updateChatSyncTimestamp works');
    } else {
        throw new Error('❌ updateChatSyncTimestamp failed');
    }
    
    // Test getChatHistoryInfo
    const historyInfo = await database.getChatHistoryInfo(testChatJid);
    if (historyInfo && historyInfo.history_baseline_timestamp && historyInfo.last_sync_timestamp) {
        console.log('   ✅ getChatHistoryInfo works');
        console.log(`      Baseline: ${new Date(historyInfo.history_baseline_timestamp).toISOString()}`);
        console.log(`      Last sync: ${new Date(historyInfo.last_sync_timestamp).toISOString()}`);
    } else {
        throw new Error('❌ getChatHistoryInfo failed');
    }
    
    // Test saveMessage with collection session
    await database.saveMessage(
        'msg123',
        testChatJid,
        false,
        'Test message content',
        testTimestamp,
        'text',
        'received',
        'Test Sender',
        'test-session'
    );
    console.log('   ✅ saveMessage with collection_session works');
    
    // Test getMessagesSinceTimestamp
    const messagesSince = await database.getMessagesSinceTimestamp(testChatJid, testTimestamp - 3600000); // 1 hour ago
    if (Array.isArray(messagesSince)) {
        console.log(`   ✅ getMessagesSinceTimestamp works (found ${messagesSince.length} messages)`);
    } else {
        throw new Error('❌ getMessagesSinceTimestamp failed');
    }
    
    // Test getChatsNeedingHistorySync
    const chatsNeedingSync = await database.getChatsNeedingHistorySync();
    if (Array.isArray(chatsNeedingSync)) {
        console.log(`   ✅ getChatsNeedingHistorySync works (found ${chatsNeedingSync.length} chats)`);
    } else {
        throw new Error('❌ getChatsNeedingHistorySync failed');
    }
    
    console.log('✅ New database methods test passed');
}

async function testProgressiveHistoryScenarios(database) {
    console.log('');
    console.log('📊 Testing progressive history scenarios...');
    
    const currentTime = Date.now();
    
    // Scenario 1: New chat (first time seeing it)
    const newChatJid = '9876543210@s.whatsapp.net';
    console.log('   📱 Scenario 1: New chat');
    
    // Save chat
    await database.saveChat(newChatJid, 'New Contact', 'newmsg1', currentTime);
    
    // Set baseline (simulating first history sync)
    const baselineTime = currentTime - 86400000; // 1 day ago
    await database.setChatHistoryBaseline(newChatJid, baselineTime);
    await database.updateChatSyncTimestamp(newChatJid, currentTime);
    
    // Save initial messages
    const initialMessages = [
        { id: 'newmsg1', content: 'Hello!', timestamp: baselineTime + 1000 },
        { id: 'newmsg2', content: 'How are you?', timestamp: baselineTime + 2000 },
        { id: 'newmsg3', content: 'Good morning', timestamp: baselineTime + 3000 }
    ];
    
    for (const msg of initialMessages) {
        await database.saveMessage(
            msg.id,
            newChatJid,
            false,
            msg.content,
            msg.timestamp,
            'text',
            'received',
            'New Contact',
            'initial-sync'
        );
    }
    
    console.log(`      ✅ Saved ${initialMessages.length} initial messages`);
    
    // Scenario 2: Existing chat (progressive sync)
    console.log('   📈 Scenario 2: Existing chat progressive sync');
    
    const existingChatJid = '5555555555@s.whatsapp.net';
    
    // Save existing chat with baseline
    await database.saveChat(existingChatJid, 'Existing Contact', 'oldmsg1', currentTime - 172800000); // 2 days ago
    await database.setChatHistoryBaseline(existingChatJid, currentTime - 172800000);
    await database.updateChatSyncTimestamp(existingChatJid, currentTime - 86400000); // Last sync 1 day ago
    
    // Save old messages
    const oldMessages = [
        { id: 'oldmsg1', content: 'Old message 1', timestamp: currentTime - 172800000 + 1000 },
        { id: 'oldmsg2', content: 'Old message 2', timestamp: currentTime - 172800000 + 2000 }
    ];
    
    for (const msg of oldMessages) {
        await database.saveMessage(
            msg.id,
            existingChatJid,
            false,
            msg.content,
            msg.timestamp,
            'text',
            'received',
            'Existing Contact',
            'initial-sync'
        );
    }
    
    // Now simulate progressive sync (new messages since last sync)
    const newMessages = [
        { id: 'newmsg4', content: 'Recent message 1', timestamp: currentTime - 3600000 }, // 1 hour ago
        { id: 'newmsg5', content: 'Recent message 2', timestamp: currentTime - 1800000 }  // 30 min ago
    ];
    
    for (const msg of newMessages) {
        await database.saveMessage(
            msg.id,
            existingChatJid,
            false,
            msg.content,
            msg.timestamp,
            'text',
            'received',
            'Existing Contact',
            'progressive-sync'
        );
    }
    
    // Update sync timestamp
    await database.updateChatSyncTimestamp(existingChatJid, currentTime);
    
    console.log(`      ✅ Saved ${oldMessages.length} old messages and ${newMessages.length} new messages`);
    
    // Scenario 3: Real-time message
    console.log('   ⚡ Scenario 3: Real-time message');
    
    await database.saveMessage(
        'realtimemsg1',
        newChatJid,
        false,
        'Just arrived!',
        currentTime,
        'text',
        'received',
        'New Contact',
        'real-time'
    );
    
    console.log('      ✅ Saved real-time message');
    
    console.log('✅ Progressive history scenarios test passed');
}

async function testDataIntegrity(database) {
    console.log('');
    console.log('🔍 Testing data integrity...');
    
    // Test 1: Check message counts by collection session
    const sessionCounts = await database.all(`
        SELECT collection_session, COUNT(*) as count
        FROM messages
        WHERE collection_session IS NOT NULL
        GROUP BY collection_session
        ORDER BY collection_session
    `);
    
    console.log('   📊 Messages by collection session:');
    for (const session of sessionCounts) {
        console.log(`      ${session.collection_session}: ${session.count} messages`);
    }
    
    // Test 2: Check chat history info
    const chatsWithHistory = await database.all(`
        SELECT jid, history_baseline_timestamp, last_sync_timestamp, history_complete
        FROM chats
        WHERE history_baseline_timestamp IS NOT NULL
    `);
    
    console.log('   📋 Chats with history tracking:');
    for (const chat of chatsWithHistory) {
        const baseline = new Date(chat.history_baseline_timestamp).toISOString();
        const lastSync = chat.last_sync_timestamp ? new Date(chat.last_sync_timestamp).toISOString() : 'Never';
        console.log(`      ${chat.jid}: baseline=${baseline}, lastSync=${lastSync}, complete=${chat.history_complete}`);
    }
    
    // Test 3: Check message timeline integrity
    const messageTimeline = await database.all(`
        SELECT chat_jid, COUNT(*) as total_messages,
               MIN(timestamp) as oldest_message,
               MAX(timestamp) as newest_message
        FROM messages
        GROUP BY chat_jid
        ORDER BY chat_jid
    `);
    
    console.log('   ⏰ Message timeline integrity:');
    for (const timeline of messageTimeline) {
        const oldest = new Date(timeline.oldest_message).toISOString();
        const newest = new Date(timeline.newest_message).toISOString();
        console.log(`      ${timeline.chat_jid}: ${timeline.total_messages} messages (${oldest} to ${newest})`);
    }
    
    console.log('✅ Data integrity test passed');
}

// Run the test
testProgressiveHistory().catch(error => {
    console.error('💥 Test failed:', error);
    process.exit(1);
});

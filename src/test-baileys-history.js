#!/usr/bin/env node

import baileys from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import fs from 'fs';

const makeWASocket = baileys.default;
const { 
    DisconnectReason, 
    useMultiFileAuthState,
    downloadHistory,
    getHistoryMsg,
    downloadAndProcessHistorySyncNotification,
    processHistoryMessage,
    Browsers
} = baileys;

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

console.log('🚀 Testing Baileys History Download Functions');
console.log('📚 Functions to test:');
console.log('   - downloadHistory()');
console.log('   - getHistoryMsg()');
console.log('   - downloadAndProcessHistorySyncNotification()');
console.log('   - processHistoryMessage()');
console.log('');

let sock;
let isConnected = false;
let historyTestResults = {
    downloadHistory: null,
    getHistoryMsg: null,
    downloadAndProcessHistorySyncNotification: null,
    processHistoryMessage: null
};

async function startWhatsApp() {
    // Use a clean auth state for testing
    const { state, saveCreds } = await useMultiFileAuthState('./test_baileys_history_auth');
    
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
            console.log('🔄 Starting history function tests...');
            isConnected = true;
            
            // Start testing the history functions
            await testHistoryFunctions();
        }
    });

    // Save credentials
    sock.ev.on('creds.update', saveCreds);

    // Monitor history events
    sock.ev.on('messaging-history.set', (item) => {
        console.log('📥 messaging-history.set event received');
        console.log(`   - Chats: ${item.chats?.length || 0}`);
        console.log(`   - Is Latest: ${item.isLatest}`);
        
        // Save the raw history data
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `baileys-history-event-${timestamp}.json`;
        try {
            fs.writeFileSync(filename, JSON.stringify(item, null, 2));
            console.log(`   - Saved to: ${filename}`);
        } catch (error) {
            console.log(`   - Failed to save: ${error.message}`);
        }
    });

    // Monitor other relevant events
    sock.ev.on('*', (event, data) => {
        if (event.includes('history') && event !== 'messaging-history.set') {
            console.log(`🔍 History-related event: ${event}`);
            
            // Save event data
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `baileys-event-${event}-${timestamp}.json`;
            try {
                fs.writeFileSync(filename, JSON.stringify({ event, data }, null, 2));
                console.log(`   - Saved to: ${filename}`);
            } catch (error) {
                console.log(`   - Failed to save: ${error.message}`);
            }
        }
    });
}

async function testHistoryFunctions() {
    console.log('');
    console.log('🧪 Testing Baileys History Functions');
    console.log('');

    // Test 1: downloadHistory()
    console.log('1️⃣ Testing downloadHistory()...');
    try {
        const historyResult = await downloadHistory(sock, 50); // Download last 50 messages
        historyTestResults.downloadHistory = historyResult;
        
        console.log('✅ downloadHistory() completed');
        console.log(`   - Type: ${typeof historyResult}`);
        console.log(`   - Keys: ${historyResult ? Object.keys(historyResult) : 'null'}`);
        
        // Save result
        const filename = `downloadHistory-result-${Date.now()}.json`;
        fs.writeFileSync(filename, JSON.stringify(historyResult, null, 2));
        console.log(`   - Saved to: ${filename}`);
        
    } catch (error) {
        console.log('❌ downloadHistory() failed:', error.message);
        historyTestResults.downloadHistory = { error: error.message };
    }

    // Test 2: getHistoryMsg()
    console.log('');
    console.log('2️⃣ Testing getHistoryMsg()...');
    try {
        const historyMsg = await getHistoryMsg(sock, 'recent', 50); // Get recent messages
        historyTestResults.getHistoryMsg = historyMsg;
        
        console.log('✅ getHistoryMsg() completed');
        console.log(`   - Type: ${typeof historyMsg}`);
        console.log(`   - Keys: ${historyMsg ? Object.keys(historyMsg) : 'null'}`);
        
        // Save result
        const filename = `getHistoryMsg-result-${Date.now()}.json`;
        fs.writeFileSync(filename, JSON.stringify(historyMsg, null, 2));
        console.log(`   - Saved to: ${filename}`);
        
    } catch (error) {
        console.log('❌ getHistoryMsg() failed:', error.message);
        historyTestResults.getHistoryMsg = { error: error.message };
    }

    // Test 3: downloadAndProcessHistorySyncNotification()
    console.log('');
    console.log('3️⃣ Testing downloadAndProcessHistorySyncNotification()...');
    try {
        // This function typically requires a notification object
        // We'll try with a mock notification or see what happens
        const syncResult = await downloadAndProcessHistorySyncNotification(sock, {});
        historyTestResults.downloadAndProcessHistorySyncNotification = syncResult;
        
        console.log('✅ downloadAndProcessHistorySyncNotification() completed');
        console.log(`   - Type: ${typeof syncResult}`);
        console.log(`   - Keys: ${syncResult ? Object.keys(syncResult) : 'null'}`);
        
        // Save result
        const filename = `downloadAndProcessHistorySyncNotification-result-${Date.now()}.json`;
        fs.writeFileSync(filename, JSON.stringify(syncResult, null, 2));
        console.log(`   - Saved to: ${filename}`);
        
    } catch (error) {
        console.log('❌ downloadAndProcessHistorySyncNotification() failed:', error.message);
        historyTestResults.downloadAndProcessHistorySyncNotification = { error: error.message };
    }

    // Test 4: processHistoryMessage()
    console.log('');
    console.log('4️⃣ Testing processHistoryMessage()...');
    try {
        // This function typically requires a history message object
        // We'll try with a mock message or see what happens
        const processResult = await processHistoryMessage(sock, {});
        historyTestResults.processHistoryMessage = processResult;
        
        console.log('✅ processHistoryMessage() completed');
        console.log(`   - Type: ${typeof processResult}`);
        console.log(`   - Keys: ${processResult ? Object.keys(processResult) : 'null'}`);
        
        // Save result
        const filename = `processHistoryMessage-result-${Date.now()}.json`;
        fs.writeFileSync(filename, JSON.stringify(processResult, null, 2));
        console.log(`   - Saved to: ${filename}`);
        
    } catch (error) {
        console.log('❌ processHistoryMessage() failed:', error.message);
        historyTestResults.processHistoryMessage = { error: error.message };
    }

    // Save comprehensive test results
    console.log('');
    console.log('📊 Saving comprehensive test results...');
    const finalResults = {
        timestamp: new Date().toISOString(),
        testResults: historyTestResults,
        summary: {
            downloadHistory: historyTestResults.downloadHistory ? 'SUCCESS' : 'FAILED',
            getHistoryMsg: historyTestResults.getHistoryMsg ? 'SUCCESS' : 'FAILED',
            downloadAndProcessHistorySyncNotification: historyTestResults.downloadAndProcessHistorySyncNotification ? 'SUCCESS' : 'FAILED',
            processHistoryMessage: historyTestResults.processHistoryMessage ? 'SUCCESS' : 'FAILED'
        }
    };
    
    const finalFilename = `baileys-history-functions-test-results-${Date.now()}.json`;
    fs.writeFileSync(finalFilename, JSON.stringify(finalResults, null, 2));
    console.log(`✅ Final results saved to: ${finalFilename}`);
    
    console.log('');
    console.log('🎯 Test Summary:');
    Object.entries(finalResults.summary).forEach(([func, status]) => {
        const icon = status === 'SUCCESS' ? '✅' : '❌';
        console.log(`   ${icon} ${func}: ${status}`);
    });
    
    console.log('');
    console.log('💡 Keep the connection open to monitor for additional history events...');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('');
    console.log('👋 Shutting down...');
    console.log('');
    console.log('📊 Final Test Results:');
    Object.entries(historyTestResults).forEach(([func, result]) => {
        const status = result ? (result.error ? 'FAILED' : 'SUCCESS') : 'NOT_TESTED';
        const icon = status === 'SUCCESS' ? '✅' : status === 'FAILED' ? '❌' : '⏸️';
        console.log(`   ${icon} ${func}: ${status}`);
        if (result?.error) {
            console.log(`      Error: ${result.error}`);
        }
    });
    console.log('');
    process.exit(0);
});

// Start the test
startWhatsApp().catch(console.error);

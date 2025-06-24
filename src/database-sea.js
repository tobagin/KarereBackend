// database-sea.js
// File-based database for SEA compatibility (no native dependencies)

const fs = require('fs').promises;
const path = require('path');
const { log, errorHandler, performance } = require('./logger.js');

// Database configuration
const DB_DIR = path.join(process.cwd(), 'data');
const MESSAGES_FILE = path.join(DB_DIR, 'messages.json');
const CHATS_FILE = path.join(DB_DIR, 'chats.json');
const METADATA_FILE = path.join(DB_DIR, 'metadata.json');

// In-memory cache for better performance
let messagesCache = new Map();
let chatsCache = new Map();
let isInitialized = false;

const database = {
  async initialize() {
    const timer = performance.start('database_init');
    
    try {
      log.database('Initializing file-based database...');
      
      // Create data directory if it doesn't exist
      try {
        await fs.mkdir(DB_DIR, { recursive: true });
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
      
      // Load existing data
      await this.loadData();
      
      isInitialized = true;
      timer.end();
      log.database('File-based database initialized successfully');
      
    } catch (error) {
      timer.end({ error: true });
      throw errorHandler.database(error, 'initialization');
    }
  },

  async loadData() {
    try {
      // Load messages
      try {
        const messagesData = await fs.readFile(MESSAGES_FILE, 'utf8');
        const messages = JSON.parse(messagesData);
        messagesCache.clear();
        messages.forEach(msg => {
          messagesCache.set(msg.id, msg);
        });
        log.database(`Loaded ${messages.length} messages from file`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        log.database('No existing messages file found, starting fresh');
      }

      // Load chats
      try {
        const chatsData = await fs.readFile(CHATS_FILE, 'utf8');
        const chats = JSON.parse(chatsData);
        chatsCache.clear();
        chats.forEach(chat => {
          chatsCache.set(chat.id, chat);
        });
        log.database(`Loaded ${chats.length} chats from file`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        log.database('No existing chats file found, starting fresh');
      }

    } catch (error) {
      throw errorHandler.database(error, 'data loading');
    }
  },

  async saveData() {
    try {
      // Save messages
      const messages = Array.from(messagesCache.values());
      await fs.writeFile(MESSAGES_FILE, JSON.stringify(messages, null, 2));
      
      // Save chats
      const chats = Array.from(chatsCache.values());
      await fs.writeFile(CHATS_FILE, JSON.stringify(chats, null, 2));
      
      log.database(`Saved ${messages.length} messages and ${chats.length} chats to files`);
      
    } catch (error) {
      throw errorHandler.database(error, 'data saving');
    }
  },

  async saveMessage(messageData) {
    const timer = performance.start('save_message');
    
    try {
      if (!isInitialized) {
        throw new Error('Database not initialized');
      }

      const messageId = `${messageData.chatId}_${messageData.messageId}_${Date.now()}`;
      const message = {
        id: messageId,
        chatId: messageData.chatId,
        messageId: messageData.messageId,
        fromMe: messageData.fromMe,
        message: messageData.message,
        timestamp: messageData.timestamp || Date.now(),
        createdAt: new Date().toISOString()
      };

      messagesCache.set(messageId, message);
      
      // Save to file periodically (every 10 messages)
      if (messagesCache.size % 10 === 0) {
        await this.saveData();
      }

      timer.end();
      log.database('Message saved successfully', { messageId, chatId: messageData.chatId });
      
      return messageId;
      
    } catch (error) {
      timer.end({ error: true });
      throw errorHandler.database(error, 'message saving');
    }
  },

  async getMessages(chatId, limit = 50, offset = 0) {
    const timer = performance.start('get_messages');
    
    try {
      if (!isInitialized) {
        throw new Error('Database not initialized');
      }

      const messages = Array.from(messagesCache.values())
        .filter(msg => msg.chatId === chatId)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(offset, offset + limit);

      timer.end();
      log.database('Messages retrieved', { chatId, count: messages.length });
      
      return messages;
      
    } catch (error) {
      timer.end({ error: true });
      throw errorHandler.database(error, 'message retrieval');
    }
  },

  async getChatList() {
    const timer = performance.start('get_chat_list');
    
    try {
      if (!isInitialized) {
        throw new Error('Database not initialized');
      }

      const chats = Array.from(chatsCache.values())
        .sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));

      timer.end();
      log.database('Chat list retrieved', { count: chats.length });
      
      return chats;
      
    } catch (error) {
      timer.end({ error: true });
      throw errorHandler.database(error, 'chat list retrieval');
    }
  },

  async updateChatLastMessage(chatId, messageData) {
    const timer = performance.start('update_chat_last_message');
    
    try {
      if (!isInitialized) {
        throw new Error('Database not initialized');
      }

      const existingChat = chatsCache.get(chatId) || {
        id: chatId,
        name: messageData.chatName || chatId,
        createdAt: new Date().toISOString()
      };

      const updatedChat = {
        ...existingChat,
        lastMessage: messageData.message,
        lastMessageTime: messageData.timestamp || Date.now(),
        lastMessageFromMe: messageData.fromMe,
        updatedAt: new Date().toISOString()
      };

      chatsCache.set(chatId, updatedChat);
      
      // Save to file periodically
      if (chatsCache.size % 5 === 0) {
        await this.saveData();
      }

      timer.end();
      log.database('Chat last message updated', { chatId });
      
    } catch (error) {
      timer.end({ error: true });
      throw errorHandler.database(error, 'chat update');
    }
  },

  async close() {
    const timer = performance.start('database_close');
    
    try {
      if (isInitialized) {
        // Save all data before closing
        await this.saveData();
        
        // Clear caches
        messagesCache.clear();
        chatsCache.clear();
        
        isInitialized = false;
        timer.end();
        log.database('File-based database closed successfully');
      }
      
    } catch (error) {
      timer.end({ error: true });
      throw errorHandler.database(error, 'database closing');
    }
  }
};

module.exports = database;

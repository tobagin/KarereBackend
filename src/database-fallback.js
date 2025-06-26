// database-fallback.js
// File-based database for environments without SQLite3 native modules (e.g., Flatpak)

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { log, errorHandler, performance } = require('./logger.js');

// Determine the appropriate data directory based on environment
function getDataDirectory() {
    // In Flatpak, use XDG_DATA_HOME for persistent data
    if (process.env.FLATPAK_ID) {
        return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share', 'karere');
    }
    
    // For development/standalone, use local data directory
    return path.join(process.cwd(), 'data');
}

// Database configuration
const DB_DIR = getDataDirectory();
const MESSAGES_FILE = path.join(DB_DIR, 'messages.json');
const CHATS_FILE = path.join(DB_DIR, 'chats.json');
const CONTACTS_FILE = path.join(DB_DIR, 'contacts.json');
const METADATA_FILE = path.join(DB_DIR, 'metadata.json');

// In-memory cache for better performance
let messagesCache = new Map();
let chatsCache = new Map();
let contactsCache = new Map();
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
        messages.forEach(msg => messagesCache.set(msg.id, msg));
        log.database(`Loaded ${messages.length} messages from file`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          log.warn('Failed to load messages file', { error: error.message });
        }
      }

      // Load chats
      try {
        const chatsData = await fs.readFile(CHATS_FILE, 'utf8');
        const chats = JSON.parse(chatsData);
        chatsCache.clear();
        chats.forEach(chat => chatsCache.set(chat.id, chat));
        log.database(`Loaded ${chats.length} chats from file`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          log.warn('Failed to load chats file', { error: error.message });
        }
      }

      // Load contacts
      try {
        const contactsData = await fs.readFile(CONTACTS_FILE, 'utf8');
        const contacts = JSON.parse(contactsData);
        contactsCache.clear();
        contacts.forEach(contact => contactsCache.set(contact.id, contact));
        log.database(`Loaded ${contacts.length} contacts from file`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          log.warn('Failed to load contacts file', { error: error.message });
        }
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

      // Save contacts
      const contacts = Array.from(contactsCache.values());
      await fs.writeFile(CONTACTS_FILE, JSON.stringify(contacts, null, 2));

      log.database('Data saved to files successfully');
    } catch (error) {
      throw errorHandler.database(error, 'data saving');
    }
  },

  // Message operations
  async saveMessage(messageData) {
    try {
      const message = {
        id: messageData.id,
        chat_id: messageData.chat_id,
        from_me: messageData.from_me ? 1 : 0,
        content: messageData.content,
        message_type: messageData.message_type,
        timestamp: messageData.timestamp,
        status: messageData.status || 'sent',
        created_at: Date.now()
      };

      messagesCache.set(message.id, message);
      await this.saveData();
      
      log.database('Message saved', { messageId: message.id });
      return message;
    } catch (error) {
      throw errorHandler.database(error, 'message saving');
    }
  },

  async getMessage(messageId) {
    try {
      return messagesCache.get(messageId) || null;
    } catch (error) {
      throw errorHandler.database(error, 'message retrieval');
    }
  },

  async getMessages(chatId, limit = 50, offset = 0) {
    try {
      const messages = Array.from(messagesCache.values())
        .filter(msg => msg.chat_id === chatId)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(offset, offset + limit);
      
      return messages;
    } catch (error) {
      throw errorHandler.database(error, 'messages retrieval');
    }
  },

  // Chat operations
  async saveChat(chatData) {
    try {
      const chat = {
        id: chatData.id,
        name: chatData.name,
        is_group: chatData.is_group ? 1 : 0,
        last_message: chatData.last_message,
        last_message_time: chatData.last_message_time,
        unread_count: chatData.unread_count || 0,
        created_at: Date.now()
      };

      chatsCache.set(chat.id, chat);
      await this.saveData();
      
      log.database('Chat saved', { chatId: chat.id });
      return chat;
    } catch (error) {
      throw errorHandler.database(error, 'chat saving');
    }
  },

  async getChat(chatId) {
    try {
      return chatsCache.get(chatId) || null;
    } catch (error) {
      throw errorHandler.database(error, 'chat retrieval');
    }
  },

  async getAllChats() {
    try {
      return Array.from(chatsCache.values())
        .sort((a, b) => (b.last_message_time || 0) - (a.last_message_time || 0));
    } catch (error) {
      throw errorHandler.database(error, 'chats retrieval');
    }
  },

  // Contact operations
  async saveContact(contactData) {
    try {
      const contact = {
        id: contactData.id,
        name: contactData.name,
        phone: contactData.phone,
        avatar_url: contactData.avatar_url,
        created_at: Date.now()
      };

      contactsCache.set(contact.id, contact);
      await this.saveData();
      
      log.database('Contact saved', { contactId: contact.id });
      return contact;
    } catch (error) {
      throw errorHandler.database(error, 'contact saving');
    }
  },

  async getContact(contactId) {
    try {
      return contactsCache.get(contactId) || null;
    } catch (error) {
      throw errorHandler.database(error, 'contact retrieval');
    }
  },

  async getAllContacts() {
    try {
      return Array.from(contactsCache.values())
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } catch (error) {
      throw errorHandler.database(error, 'contacts retrieval');
    }
  },

  // Utility methods
  async cleanup() {
    try {
      // Remove old messages (older than 6 months)
      const sixMonthsAgo = Date.now() - (6 * 30 * 24 * 60 * 60 * 1000);
      let deletedCount = 0;
      
      for (const [id, message] of messagesCache.entries()) {
        if (message.timestamp < sixMonthsAgo) {
          messagesCache.delete(id);
          deletedCount++;
        }
      }
      
      if (deletedCount > 0) {
        await this.saveData();
        log.info('Cleaned up old messages', { deletedCount });
      }
    } catch (error) {
      throw errorHandler.database(error, 'cleanup');
    }
  },

  async close() {
    try {
      await this.saveData();
      log.info('File-based database closed');
    } catch (error) {
      log.error('Error closing file-based database', error);
    }
  }
};

module.exports = database;

// database.js
// SQLite database for message persistence and chat history

import sqlite3 from 'sqlite3';
import { log, errorHandler, performance } from './logger.js';
import fs from 'fs';
import path from 'path';

// Create data directory if it doesn't exist
const dataDir = 'data';
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

const dbPath = path.join(dataDir, 'karere.db');

class Database {
    constructor() {
        this.db = null;
        this.isInitialized = false;
    }

    async initialize() {
        const timer = performance.start('database_initialization');
        
        try {
            log.info('Initializing database', { path: dbPath });
            
            this.db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    throw err;
                }
            });

            // Enable foreign keys and WAL mode for better performance
            await this.run('PRAGMA foreign_keys = ON');
            await this.run('PRAGMA journal_mode = WAL');
            await this.run('PRAGMA synchronous = NORMAL');
            await this.run('PRAGMA cache_size = 1000');
            await this.run('PRAGMA temp_store = memory');

            await this.createTables();
            this.isInitialized = true;
            
            timer.end();
            log.info('Database initialized successfully');
            
        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'initialization');
        }
    }

    async createTables() {
        const tables = [
            // Chats table
            `CREATE TABLE IF NOT EXISTS chats (
                jid TEXT PRIMARY KEY,
                name TEXT,
                avatar_base64 TEXT,
                last_message_id TEXT,
                last_message_timestamp INTEGER,
                last_message_type TEXT DEFAULT 'text',
                last_message_from TEXT,
                unread_count INTEGER DEFAULT 0,
                is_archived BOOLEAN DEFAULT FALSE,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )`,

            // Messages table
            `CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                chat_jid TEXT NOT NULL,
                from_me BOOLEAN NOT NULL,
                message_type TEXT DEFAULT 'text',
                content TEXT,
                timestamp INTEGER NOT NULL,
                status TEXT DEFAULT 'sent',
                reply_to_id TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (chat_jid) REFERENCES chats (jid) ON DELETE CASCADE,
                FOREIGN KEY (reply_to_id) REFERENCES messages (id) ON DELETE SET NULL
            )`,

            // Media table for file attachments
            `CREATE TABLE IF NOT EXISTS media (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                file_path TEXT,
                file_name TEXT,
                file_size INTEGER,
                mime_type TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
            )`,

            // Contacts table
            `CREATE TABLE IF NOT EXISTS contacts (
                jid TEXT PRIMARY KEY,
                name TEXT,
                phone_number TEXT,
                avatar_base64 TEXT,
                is_blocked BOOLEAN DEFAULT FALSE,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )`,

            // Settings table
            `CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )`
        ];

        for (const table of tables) {
            await this.run(table);
        }

        // Create indexes for better performance
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_messages_chat_jid ON messages (chat_jid)',
            'CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_messages_from_me ON messages (from_me)',
            'CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats (updated_at)',
            'CREATE INDEX IF NOT EXISTS idx_media_message_id ON media (message_id)'
        ];

        for (const index of indexes) {
            await this.run(index);
        }

        // Run migrations for existing databases
        await this.runMigrations();

        log.info('Database tables and indexes created successfully');
    }

    async runMigrations() {
        try {
            // Check if avatar_base64 column exists in contacts table
            const contactsTableInfo = await this.all("PRAGMA table_info(contacts)");
            const contactsHasAvatarBase64 = contactsTableInfo.some(column => column.name === 'avatar_base64');

            if (!contactsHasAvatarBase64) {
                log.info('Adding avatar_base64 column to contacts table');
                await this.run('ALTER TABLE contacts ADD COLUMN avatar_base64 TEXT');
                log.info('Migration completed: avatar_base64 column added to contacts');
            }

            // Check if avatar_base64 column exists in chats table
            const chatsTableInfo = await this.all("PRAGMA table_info(chats)");
            const chatsHasAvatarBase64 = chatsTableInfo.some(column => column.name === 'avatar_base64');
            const chatsHasLastMessageType = chatsTableInfo.some(column => column.name === 'last_message_type');
            const chatsHasLastMessageFrom = chatsTableInfo.some(column => column.name === 'last_message_from');

            if (!chatsHasAvatarBase64) {
                log.info('Adding avatar_base64 column to chats table');
                await this.run('ALTER TABLE chats ADD COLUMN avatar_base64 TEXT');
                log.info('Migration completed: avatar_base64 column added to chats');
            }

            if (!chatsHasLastMessageType) {
                log.info('Adding last_message_type column to chats table');
                await this.run('ALTER TABLE chats ADD COLUMN last_message_type TEXT DEFAULT \'text\'');
                log.info('Migration completed: last_message_type column added to chats');
            }

            if (!chatsHasLastMessageFrom) {
                log.info('Adding last_message_from column to chats table');
                await this.run('ALTER TABLE chats ADD COLUMN last_message_from TEXT');
                log.info('Migration completed: last_message_from column added to chats');
            }

            // Progressive history tracking columns
            const chatsHasHistoryBaseline = chatsTableInfo.some(column => column.name === 'history_baseline_timestamp');
            const chatsHasLastSync = chatsTableInfo.some(column => column.name === 'last_sync_timestamp');
            const chatsHasHistoryComplete = chatsTableInfo.some(column => column.name === 'history_complete');

            if (!chatsHasHistoryBaseline) {
                log.info('Adding history_baseline_timestamp column to chats table');
                await this.run('ALTER TABLE chats ADD COLUMN history_baseline_timestamp INTEGER');
                log.info('Migration completed: history_baseline_timestamp column added to chats');
            }

            if (!chatsHasLastSync) {
                log.info('Adding last_sync_timestamp column to chats table');
                await this.run('ALTER TABLE chats ADD COLUMN last_sync_timestamp INTEGER');
                log.info('Migration completed: last_sync_timestamp column added to chats');
            }

            if (!chatsHasHistoryComplete) {
                log.info('Adding history_complete column to chats table');
                await this.run('ALTER TABLE chats ADD COLUMN history_complete BOOLEAN DEFAULT 0');
                log.info('Migration completed: history_complete column added to chats');
            }

            // Check if collection_session column exists in messages table
            const messagesTableInfo = await this.all("PRAGMA table_info(messages)");
            const messagesHasCollectionSession = messagesTableInfo.some(column => column.name === 'collection_session');

            if (!messagesHasCollectionSession) {
                log.info('Adding collection_session column to messages table');
                await this.run('ALTER TABLE messages ADD COLUMN collection_session TEXT');
                log.info('Migration completed: collection_session column added to messages');
            }
        } catch (error) {
            log.warn('Migration failed', { error: error.message });
            // Don't throw - migrations should be non-fatal
        }
    }

    // Promisify database operations
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Chat operations
    async saveChat(jid, name = null, lastMessageId = null, timestamp = null, avatarBase64 = null, lastMessageType = 'text', lastMessageFrom = null) {
        const timer = performance.start('save_chat');

        try {
            const sql = `
                INSERT OR REPLACE INTO chats (jid, name, avatar_base64, last_message_id, last_message_timestamp, last_message_type, last_message_from, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
            `;

            await this.run(sql, [jid, name, avatarBase64, lastMessageId, timestamp, lastMessageType, lastMessageFrom]);
            timer.end();

            log.debug('Chat saved', { jid, name, hasAvatarBase64: !!avatarBase64, lastMessageType, lastMessageFrom });

        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'saveChat');
        }
    }

    async getChats(limit = 50) {
        const timer = performance.start('get_chats');

        try {
            const sql = `
                SELECT c.*,
                       m.content as last_message_content,
                       m.message_type as last_message_type_from_message,
                       m.from_me as last_message_from_me,
                       cont.name as contact_name,
                       cont.avatar_base64 as contact_avatar_base64,
                       cont.phone_number as contact_phone_number
                FROM chats c
                LEFT JOIN messages m ON c.last_message_id = m.id
                LEFT JOIN contacts cont ON c.jid = cont.jid
                WHERE c.is_archived = FALSE
                ORDER BY c.last_message_timestamp DESC
                LIMIT ?
            `;

            const chats = await this.all(sql, [limit]);
            timer.end({ count: chats.length });

            return chats;

        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getChats');
        }
    }

    async getChatWithContact(jid) {
        const timer = performance.start('get_chat_with_contact');

        try {
            const sql = `
                SELECT c.*,
                       m.content as last_message_content,
                       m.message_type as last_message_type_from_message,
                       m.from_me as last_message_from_me,
                       cont.name as contact_name,
                       cont.avatar_base64 as contact_avatar_base64,
                       cont.phone_number as contact_phone_number
                FROM chats c
                LEFT JOIN messages m ON c.last_message_id = m.id
                LEFT JOIN contacts cont ON c.jid = cont.jid
                WHERE c.jid = ?
            `;

            const chat = await this.get(sql, [jid]);
            timer.end({ found: !!chat });

            return chat;

        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getChatWithContact');
        }
    }

    async updateChatAvatar(jid, avatarBase64) {
        const timer = performance.start('update_chat_avatar');

        try {
            const sql = `
                UPDATE chats
                SET avatar_base64 = ?, updated_at = strftime('%s', 'now')
                WHERE jid = ?
            `;

            const result = await this.run(sql, [avatarBase64, jid]);
            timer.end({ updated: result.changes > 0 });

            if (result.changes > 0) {
                log.debug('Chat avatar updated', { jid, hasAvatarBase64: !!avatarBase64 });
            }

            return result.changes > 0;
        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'updateChatAvatar');
        }
    }

    // Progressive history tracking methods
    async setChatHistoryBaseline(jid, timestamp) {
        const timer = performance.start('set_chat_history_baseline');

        try {
            const sql = `
                UPDATE chats
                SET history_baseline_timestamp = ?, updated_at = strftime('%s', 'now')
                WHERE jid = ?
            `;

            const result = await this.run(sql, [timestamp, jid]);
            timer.end({ updated: result.changes > 0 });

            if (result.changes > 0) {
                log.debug('Chat history baseline set', { jid, timestamp });
            }

            return result.changes > 0;
        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'setChatHistoryBaseline');
        }
    }

    async updateChatSyncTimestamp(jid, timestamp) {
        const timer = performance.start('update_chat_sync_timestamp');

        try {
            const sql = `
                UPDATE chats
                SET last_sync_timestamp = ?, updated_at = strftime('%s', 'now')
                WHERE jid = ?
            `;

            const result = await this.run(sql, [timestamp, jid]);
            timer.end({ updated: result.changes > 0 });

            if (result.changes > 0) {
                log.debug('Chat sync timestamp updated', { jid, timestamp });
            }

            return result.changes > 0;
        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'updateChatSyncTimestamp');
        }
    }

    async getChatHistoryInfo(jid) {
        const timer = performance.start('get_chat_history_info');

        try {
            const sql = `
                SELECT jid, history_baseline_timestamp, last_sync_timestamp, history_complete
                FROM chats
                WHERE jid = ?
            `;

            const info = await this.get(sql, [jid]);
            timer.end({ found: !!info });

            return info;
        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getChatHistoryInfo');
        }
    }

    async getChatsNeedingHistorySync() {
        const timer = performance.start('get_chats_needing_history_sync');

        try {
            const sql = `
                SELECT jid, name, history_baseline_timestamp, last_sync_timestamp
                FROM chats
                WHERE history_baseline_timestamp IS NOT NULL
                  AND (last_sync_timestamp IS NULL OR last_sync_timestamp < strftime('%s', 'now') - 300)
                  AND history_complete = 0
                ORDER BY last_message_timestamp DESC
                LIMIT 10
            `;

            const chats = await this.all(sql);
            timer.end({ count: chats.length });

            return chats;
        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getChatsNeedingHistorySync');
        }
    }

    // Message operations
    async saveMessage(id, chatJid, fromMe, content, timestamp, messageType = 'text', status = 'sent', senderName = null, collectionSession = null) {
        const timer = performance.start('save_message');

        try {
            const sql = `
                INSERT OR REPLACE INTO messages (id, chat_jid, from_me, message_type, content, timestamp, status, collection_session)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;

            await this.run(sql, [id, chatJid, fromMe, messageType, content, timestamp, status, collectionSession]);

            // If this is an incoming message and we have sender name, save/update contact
            if (!fromMe && senderName) {
                await this.saveContact(chatJid, senderName);
            }

            // Update chat's last message and name if provided
            // For last_message_from: if fromMe is true, use 'me', otherwise use the chatJid (sender's JID)
            const lastMessageFrom = fromMe ? 'me' : chatJid;

            const chatUpdateSql = senderName && !fromMe ? `
                UPDATE chats
                SET last_message_id = ?, last_message_timestamp = ?, last_message_type = ?, last_message_from = ?, name = COALESCE(?, name), updated_at = strftime('%s', 'now')
                WHERE jid = ?
            ` : `
                UPDATE chats
                SET last_message_id = ?, last_message_timestamp = ?, last_message_type = ?, last_message_from = ?, updated_at = strftime('%s', 'now')
                WHERE jid = ?
            `;

            const chatUpdateParams = senderName && !fromMe ?
                [id, timestamp, messageType, lastMessageFrom, senderName, chatJid] :
                [id, timestamp, messageType, lastMessageFrom, chatJid];

            await this.run(chatUpdateSql, chatUpdateParams);

            timer.end();
            log.debug('Message saved', { id, chatJid, fromMe, senderName });

        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'saveMessage');
        }
    }

    async getMessages(chatJid, limit = 50, offset = 0) {
        const timer = performance.start('get_messages');

        try {
            const sql = `
                SELECT m.*,
                       cont.name as sender_name,
                       cont.avatar_base64 as sender_avatar_base64
                FROM messages m
                LEFT JOIN contacts cont ON m.chat_jid = cont.jid
                WHERE m.chat_jid = ?
                ORDER BY m.timestamp DESC
                LIMIT ? OFFSET ?
            `;

            const messages = await this.all(sql, [chatJid, limit, offset]);
            timer.end({ count: messages.length });

            return messages.reverse(); // Return in chronological order

        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getMessages');
        }
    }

    async getMessagesWithSender(chatJid, limit = 50, offset = 0) {
        const timer = performance.start('get_messages_with_sender');

        try {
            const sql = `
                SELECT m.*,
                       CASE
                           WHEN m.from_me = 1 THEN 'You'
                           ELSE COALESCE(cont.name, m.chat_jid)
                       END as display_sender_name,
                       cont.avatar_base64 as sender_avatar_base64
                FROM messages m
                LEFT JOIN contacts cont ON m.chat_jid = cont.jid
                WHERE m.chat_jid = ?
                ORDER BY m.timestamp DESC
                LIMIT ? OFFSET ?
            `;

            const messages = await this.all(sql, [chatJid, limit, offset]);
            timer.end({ count: messages.length });

            return messages.reverse(); // Return in chronological order

        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getMessagesWithSender');
        }
    }

    async getMessagesSinceTimestamp(chatJid, sinceTimestamp, limit = 100) {
        const timer = performance.start('get_messages_since_timestamp');

        try {
            const sql = `
                SELECT m.*,
                       CASE
                           WHEN m.from_me = 1 THEN 'You'
                           ELSE COALESCE(cont.name, m.chat_jid)
                       END as display_sender_name,
                       cont.avatar_base64 as sender_avatar_base64
                FROM messages m
                LEFT JOIN contacts cont ON m.chat_jid = cont.jid
                WHERE m.chat_jid = ? AND m.timestamp > ?
                ORDER BY m.timestamp ASC
                LIMIT ?
            `;

            const messages = await this.all(sql, [chatJid, sinceTimestamp, limit]);
            timer.end({ count: messages.length });

            return messages;

        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getMessagesSinceTimestamp');
        }
    }

    async getOldestMessageTimestamp(chatJid) {
        const timer = performance.start('get_oldest_message_timestamp');

        try {
            const sql = `
                SELECT MIN(timestamp) as oldest_timestamp
                FROM messages
                WHERE chat_jid = ?
            `;

            const result = await this.get(sql, [chatJid]);
            timer.end({ found: !!result?.oldest_timestamp });

            return result?.oldest_timestamp || null;

        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getOldestMessageTimestamp');
        }
    }

    async getMessageCount(chatJid) {
        const timer = performance.start('get_message_count');

        try {
            const sql = `
                SELECT COUNT(*) as count
                FROM messages
                WHERE chat_jid = ?
            `;

            const result = await this.get(sql, [chatJid]);
            timer.end({ count: result?.count || 0 });

            return result?.count || 0;

        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getMessageCount');
        }
    }

    async getMessage(messageId) {
        const timer = performance.start('get_message');

        try {
            const sql = 'SELECT * FROM messages WHERE id = ?';
            const message = await this.get(sql, [messageId]);

            timer.end({ messageId, found: !!message });
            return message;

        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getMessage');
        }
    }

    async updateMessageStatus(messageId, status) {
        try {
            await this.run('UPDATE messages SET status = ? WHERE id = ?', [status, messageId]);
            log.debug('Message status updated', { messageId, status });
        } catch (error) {
            throw errorHandler.database(error, 'updateMessageStatus');
        }
    }

    // Media operations
    async saveMedia(id, messageId, filePath = null, fileName = null, fileSize = null, mimeType = null) {
        const timer = performance.start('save_media');

        try {
            const sql = `
                INSERT OR REPLACE INTO media (id, message_id, file_path, file_name, file_size, mime_type)
                VALUES (?, ?, ?, ?, ?, ?)
            `;

            await this.run(sql, [id, messageId, filePath, fileName, fileSize, mimeType]);
            timer.end();

            log.debug('Media saved', { id, messageId, fileName, fileSize });

        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'saveMedia');
        }
    }

    async getMedia(messageId) {
        const timer = performance.start('get_media');

        try {
            const sql = 'SELECT * FROM media WHERE message_id = ?';
            const media = await this.all(sql, [messageId]);
            timer.end({ messageId, count: media.length });

            return media;
        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getMedia');
        }
    }

    async getAllMedia(limit = 1000) {
        const timer = performance.start('get_all_media');

        try {
            const sql = `
                SELECT m.*, msg.chat_jid, msg.timestamp
                FROM media m
                LEFT JOIN messages msg ON m.message_id = msg.id
                ORDER BY msg.timestamp DESC
                LIMIT ?
            `;

            const media = await this.all(sql, [limit]);
            timer.end({ count: media.length });

            return media;
        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getAllMedia');
        }
    }

    // Contact operations
    async saveContact(jid, name, phoneNumber = null, avatarBase64 = null) {
        const timer = performance.start('save_contact');

        try {
            const sql = `
                INSERT OR REPLACE INTO contacts (jid, name, phone_number, avatar_base64, updated_at)
                VALUES (?, ?, ?, ?, strftime('%s', 'now'))
            `;

            await this.run(sql, [jid, name, phoneNumber, avatarBase64]);
            timer.end();

            log.debug('Contact saved', { jid, name, hasAvatarBase64: !!avatarBase64 });

        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'saveContact');
        }
    }

    async getContact(jid) {
        const timer = performance.start('get_contact');

        try {
            const contact = await this.get('SELECT * FROM contacts WHERE jid = ?', [jid]);
            timer.end({ found: !!contact });

            return contact;
        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getContact');
        }
    }

    async getAllContacts(limit = 1000) {
        const timer = performance.start('get_all_contacts');

        try {
            const sql = `
                SELECT * FROM contacts
                WHERE is_blocked = FALSE
                ORDER BY name ASC, jid ASC
                LIMIT ?
            `;

            const contacts = await this.all(sql, [limit]);
            timer.end({ count: contacts.length });

            return contacts;
        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getAllContacts');
        }
    }

    async updateContactAvatar(jid, avatarBase64) {
        const timer = performance.start('update_contact_avatar');

        try {
            const sql = `
                UPDATE contacts
                SET avatar_base64 = ?, updated_at = strftime('%s', 'now')
                WHERE jid = ?
            `;

            const result = await this.run(sql, [avatarBase64, jid]);
            timer.end({ updated: result.changes > 0 });

            if (result.changes > 0) {
                log.debug('Contact avatar updated', { jid, hasAvatarBase64: !!avatarBase64 });
            }

            return result.changes > 0;
        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'updateContactAvatar');
        }
    }

    async updateContactName(jid, name) {
        const timer = performance.start('update_contact_name');

        try {
            const sql = `
                UPDATE contacts
                SET name = ?, updated_at = strftime('%s', 'now')
                WHERE jid = ?
            `;

            const result = await this.run(sql, [name, jid]);
            timer.end({ updated: result.changes > 0 });

            if (result.changes > 0) {
                log.debug('Contact name updated', { jid, name });
            }

            return result.changes > 0;
        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'updateContactName');
        }
    }

    async searchContacts(query, limit = 50) {
        const timer = performance.start('search_contacts');

        try {
            const sql = `
                SELECT * FROM contacts
                WHERE (name LIKE ? OR phone_number LIKE ? OR jid LIKE ?)
                AND is_blocked = FALSE
                ORDER BY
                    CASE
                        WHEN name LIKE ? THEN 1
                        WHEN phone_number LIKE ? THEN 2
                        ELSE 3
                    END,
                    name ASC
                LIMIT ?
            `;

            const searchPattern = `%${query}%`;
            const exactPattern = `${query}%`;

            const contacts = await this.all(sql, [
                searchPattern, searchPattern, searchPattern,
                exactPattern, exactPattern,
                limit
            ]);

            timer.end({ count: contacts.length, query });

            return contacts;
        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'searchContacts');
        }
    }

    async getContactsWithChats() {
        const timer = performance.start('get_contacts_with_chats');

        try {
            const sql = `
                SELECT DISTINCT c.*, ch.last_message_timestamp
                FROM contacts c
                INNER JOIN chats ch ON c.jid = ch.jid
                WHERE c.is_blocked = FALSE
                ORDER BY ch.last_message_timestamp DESC
            `;

            const contacts = await this.all(sql);
            timer.end({ count: contacts.length });

            return contacts;
        } catch (error) {
            timer.end({ error: true });
            throw errorHandler.database(error, 'getContactsWithChats');
        }
    }

    // Settings operations
    async setSetting(key, value) {
        try {
            const sql = `
                INSERT OR REPLACE INTO settings (key, value, updated_at)
                VALUES (?, ?, strftime('%s', 'now'))
            `;
            
            await this.run(sql, [key, JSON.stringify(value)]);
            log.debug('Setting saved', { key });
            
        } catch (error) {
            throw errorHandler.database(error, 'setSetting');
        }
    }

    async getSetting(key, defaultValue = null) {
        try {
            const row = await this.get('SELECT value FROM settings WHERE key = ?', [key]);
            return row ? JSON.parse(row.value) : defaultValue;
        } catch (error) {
            throw errorHandler.database(error, 'getSetting');
        }
    }

    // Cleanup operations
    async cleanup() {
        try {
            // Delete old messages (older than 6 months)
            const sixMonthsAgo = Date.now() - (6 * 30 * 24 * 60 * 60 * 1000);
            const result = await this.run('DELETE FROM messages WHERE timestamp < ?', [sixMonthsAgo]);
            
            if (result.changes > 0) {
                log.info('Cleaned up old messages', { deletedCount: result.changes });
            }
            
            // Vacuum database to reclaim space
            await this.run('VACUUM');
            
        } catch (error) {
            throw errorHandler.database(error, 'cleanup');
        }
    }

    async close() {
        if (this.db) {
            return new Promise((resolve) => {
                this.db.close((err) => {
                    if (err) {
                        log.error('Error closing database', err);
                    } else {
                        log.info('Database connection closed');
                    }
                    resolve();
                });
            });
        }
    }
}

// Create singleton instance
const database = new Database();

export default database;

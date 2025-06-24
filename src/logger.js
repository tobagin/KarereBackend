// logger.js
// Comprehensive logging system for Karere backend

const winston = require('winston');
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = 'logs';
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Custom format for log messages
const logFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
        let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
        
        // Add stack trace for errors
        if (stack) {
            log += `\n${stack}`;
        }
        
        // Add metadata if present
        if (Object.keys(meta).length > 0) {
            log += `\n${JSON.stringify(meta, null, 2)}`;
        }
        
        return log;
    })
);

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        // Console transport for development
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                logFormat
            )
        }),
        
        // File transport for all logs
        new winston.transports.File({
            filename: path.join(logsDir, 'karere-backend.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true
        }),
        
        // Separate file for errors
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 3,
            tailable: true
        }),
        
        // Separate file for WebSocket events
        new winston.transports.File({
            filename: path.join(logsDir, 'websocket.log'),
            level: 'debug',
            maxsize: 2097152, // 2MB
            maxFiles: 3,
            tailable: true,
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    if (meta.type === 'websocket') {
                        return `${timestamp} [WS-${level.toUpperCase()}]: ${message}`;
                    }
                    return null; // Don't log non-websocket messages to this file
                })
            )
        })
    ]
});

// Enhanced logging methods with context
const log = {
    info: (message, meta = {}) => logger.info(message, meta),
    warn: (message, meta = {}) => logger.warn(message, meta),
    error: (message, error = null, meta = {}) => {
        if (error instanceof Error) {
            logger.error(message, { ...meta, error: error.message, stack: error.stack });
        } else if (error) {
            logger.error(message, { ...meta, error });
        } else {
            logger.error(message, meta);
        }
    },
    debug: (message, meta = {}) => logger.debug(message, meta),
    
    // Specialized logging methods
    websocket: (message, meta = {}) => logger.debug(message, { ...meta, type: 'websocket' }),
    baileys: (message, meta = {}) => logger.info(message, { ...meta, component: 'baileys' }),
    auth: (message, meta = {}) => logger.info(message, { ...meta, component: 'auth' }),
    message: (message, meta = {}) => logger.info(message, { ...meta, component: 'messaging' }),
    database: (message, meta = {}) => logger.info(message, { ...meta, component: 'database' }),
    
    // Performance logging
    performance: (operation, duration, meta = {}) => {
        logger.info(`Performance: ${operation} completed in ${duration}ms`, { 
            ...meta, 
            type: 'performance',
            operation,
            duration 
        });
    }
};

// Error handling utilities
const errorHandler = {
    // Handle and log WebSocket errors
    websocket: (error, context = '') => {
        log.error(`WebSocket error${context ? ` in ${context}` : ''}`, error, { type: 'websocket' });
        return {
            type: 'websocket_error',
            message: 'WebSocket connection error',
            details: error?.message || 'Unknown error'
        };
    },
    
    // Handle and log Baileys errors
    baileys: (error, context = '') => {
        log.error(`Baileys error${context ? ` in ${context}` : ''}`, error, { type: 'baileys' });
        return {
            type: 'baileys_error',
            message: 'WhatsApp connection error',
            details: error?.message || 'Unknown error'
        };
    },
    
    // Handle and log message errors
    messaging: (error, context = '') => {
        log.error(`Messaging error${context ? ` in ${context}` : ''}`, error, { type: 'messaging' });
        return {
            type: 'messaging_error',
            message: 'Message processing error',
            details: error?.message || 'Unknown error'
        };
    },
    
    // Handle and log database errors
    database: (error, context = '') => {
        log.error(`Database error${context ? ` in ${context}` : ''}`, error, { type: 'database' });
        return {
            type: 'database_error',
            message: 'Database operation error',
            details: error?.message || 'Unknown error'
        };
    },
    
    // Handle and log avatar errors
    avatar: (error, context = '') => {
        log.error(`Avatar error${context ? ` in ${context}` : ''}`, error, { type: 'avatar' });
        return {
            type: 'avatar_error',
            message: 'Avatar processing error',
            details: error?.message || 'Unknown error'
        };
    },

    // Generic error handler
    generic: (error, context = '') => {
        log.error(`Generic error${context ? ` in ${context}` : ''}`, error);
        return {
            type: 'generic_error',
            message: 'An unexpected error occurred',
            details: error?.message || 'Unknown error'
        };
    }
};

// Performance monitoring utilities
const performance = {
    start: (operation) => {
        const startTime = Date.now();
        return {
            end: (meta = {}) => {
                const duration = Date.now() - startTime;
                log.performance(operation, duration, meta);
                return duration;
            }
        };
    }
};

// Health check utilities
const health = {
    logSystemInfo: () => {
        log.info('System Information', {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            memory: process.memoryUsage(),
            uptime: process.uptime()
        });
    },
    
    logStartup: () => {
        log.info('Karere Backend Starting', {
            timestamp: new Date().toISOString(),
            pid: process.pid
        });
    },
    
    logShutdown: (reason = 'unknown') => {
        log.info('Karere Backend Shutting Down', {
            reason,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    }
};

module.exports = {
    log,
    errorHandler,
    performance,
    health,
    logger
};

// service-manager.js
// Service management and monitoring for Karere backend

import { log, errorHandler, health } from './logger.js';
import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';

class ServiceManager {
    constructor() {
        this.isShuttingDown = false;
        this.services = new Map();
        this.healthChecks = new Map();
        this.cronJobs = new Map();
        this.startTime = Date.now();
    }

    async initialize() {
        log.info('Initializing Service Manager');
        
        // Setup graceful shutdown handlers
        this.setupShutdownHandlers();
        
        // Setup health monitoring
        this.setupHealthMonitoring();
        
        // Setup periodic tasks
        this.setupPeriodicTasks();
        
        // Log system information
        health.logSystemInfo();
        health.logStartup();
        
        log.info('Service Manager initialized successfully');
    }

    setupShutdownHandlers() {
        const gracefulShutdown = async (signal) => {
            if (this.isShuttingDown) {
                log.warn('Shutdown already in progress, forcing exit');
                process.exit(1);
            }

            this.isShuttingDown = true;
            log.info(`Received ${signal}, starting graceful shutdown`);
            
            try {
                // Stop all cron jobs
                for (const [name, job] of this.cronJobs) {
                    log.info(`Stopping cron job: ${name}`);
                    job.stop();
                }

                // Shutdown all registered services
                for (const [name, service] of this.services) {
                    log.info(`Shutting down service: ${name}`);
                    if (service.shutdown && typeof service.shutdown === 'function') {
                        await service.shutdown();
                    }
                }

                health.logShutdown(signal);
                log.info('Graceful shutdown completed');
                
                // Give logs time to flush
                setTimeout(() => process.exit(0), 1000);
                
            } catch (error) {
                log.error('Error during graceful shutdown', error);
                process.exit(1);
            }
        };

        // Handle various shutdown signals
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon restart

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            log.error('Uncaught Exception', error);
            gracefulShutdown('uncaughtException');
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            log.error('Unhandled Rejection', reason, { promise });
            gracefulShutdown('unhandledRejection');
        });
    }

    setupHealthMonitoring() {
        // Memory usage monitoring
        this.addHealthCheck('memory', () => {
            const usage = process.memoryUsage();
            const maxHeapMB = 512; // 512MB threshold
            const currentHeapMB = usage.heapUsed / 1024 / 1024;
            
            return {
                healthy: currentHeapMB < maxHeapMB,
                details: {
                    heapUsed: `${currentHeapMB.toFixed(2)}MB`,
                    heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
                    external: `${(usage.external / 1024 / 1024).toFixed(2)}MB`,
                    rss: `${(usage.rss / 1024 / 1024).toFixed(2)}MB`
                }
            };
        });

        // Uptime monitoring
        this.addHealthCheck('uptime', () => {
            const uptimeSeconds = process.uptime();
            return {
                healthy: true,
                details: {
                    uptime: `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`,
                    startTime: new Date(this.startTime).toISOString()
                }
            };
        });

        // Disk space monitoring
        this.addHealthCheck('disk', async () => {
            try {
                const stats = await fs.stat('.');
                return {
                    healthy: true,
                    details: {
                        accessible: true
                    }
                };
            } catch (error) {
                return {
                    healthy: false,
                    details: {
                        error: error.message
                    }
                };
            }
        });
    }

    setupPeriodicTasks() {
        // Health check every 5 minutes
        this.addCronJob('health-check', '*/5 * * * *', async () => {
            await this.runHealthChecks();
        });

        // Log rotation check every hour
        this.addCronJob('log-rotation', '0 * * * *', async () => {
            await this.checkLogRotation();
        });

        // Database cleanup every day at 2 AM
        this.addCronJob('database-cleanup', '0 2 * * *', async () => {
            const database = this.getService('database');
            if (database) {
                try {
                    await database.cleanup();
                    log.info('Database cleanup completed');
                } catch (error) {
                    log.error('Database cleanup failed', error);
                }
            }
        });

        // Memory usage report every hour
        this.addCronJob('memory-report', '0 * * * *', () => {
            const usage = process.memoryUsage();
            log.info('Memory Usage Report', {
                heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
                heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
                external: `${(usage.external / 1024 / 1024).toFixed(2)}MB`,
                rss: `${(usage.rss / 1024 / 1024).toFixed(2)}MB`
            });
        });
    }

    // Service registration
    registerService(name, service) {
        this.services.set(name, service);
        log.info(`Service registered: ${name}`);
    }

    getService(name) {
        return this.services.get(name);
    }

    // Health check management
    addHealthCheck(name, checkFunction) {
        this.healthChecks.set(name, checkFunction);
        log.debug(`Health check added: ${name}`);
    }

    async runHealthChecks() {
        const results = {};
        let overallHealthy = true;

        for (const [name, checkFunction] of this.healthChecks) {
            try {
                const result = await checkFunction();
                results[name] = result;
                
                if (!result.healthy) {
                    overallHealthy = false;
                    log.warn(`Health check failed: ${name}`, result.details);
                }
            } catch (error) {
                results[name] = {
                    healthy: false,
                    details: { error: error.message }
                };
                overallHealthy = false;
                log.error(`Health check error: ${name}`, error);
            }
        }

        if (!overallHealthy) {
            log.warn('System health check failed', results);
        } else {
            log.debug('All health checks passed');
        }

        return { healthy: overallHealthy, checks: results };
    }

    // Cron job management
    addCronJob(name, schedule, task) {
        if (this.cronJobs.has(name)) {
            log.warn(`Cron job already exists: ${name}`);
            return;
        }

        const job = cron.schedule(schedule, async () => {
            try {
                log.debug(`Running cron job: ${name}`);
                await task();
            } catch (error) {
                log.error(`Cron job failed: ${name}`, error);
            }
        }, {
            scheduled: false
        });

        this.cronJobs.set(name, job);
        job.start();
        
        log.info(`Cron job scheduled: ${name} (${schedule})`);
    }

    removeCronJob(name) {
        const job = this.cronJobs.get(name);
        if (job) {
            job.stop();
            this.cronJobs.delete(name);
            log.info(`Cron job removed: ${name}`);
        }
    }

    // Log management
    async checkLogRotation() {
        try {
            const logsDir = 'logs';
            const files = await fs.readdir(logsDir);
            
            for (const file of files) {
                const filePath = path.join(logsDir, file);
                const stats = await fs.stat(filePath);
                
                // Check if log file is too large (>10MB)
                if (stats.size > 10 * 1024 * 1024) {
                    log.warn(`Large log file detected: ${file} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
                }
            }
        } catch (error) {
            log.error('Log rotation check failed', error);
        }
    }

    // Performance monitoring
    getPerformanceMetrics() {
        const usage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        return {
            memory: {
                heapUsed: usage.heapUsed,
                heapTotal: usage.heapTotal,
                external: usage.external,
                rss: usage.rss
            },
            cpu: {
                user: cpuUsage.user,
                system: cpuUsage.system
            },
            uptime: process.uptime(),
            pid: process.pid,
            version: process.version,
            platform: process.platform
        };
    }

    // Status reporting
    getStatus() {
        return {
            isShuttingDown: this.isShuttingDown,
            uptime: process.uptime(),
            startTime: this.startTime,
            services: Array.from(this.services.keys()),
            healthChecks: Array.from(this.healthChecks.keys()),
            cronJobs: Array.from(this.cronJobs.keys()),
            performance: this.getPerformanceMetrics()
        };
    }
}

// Create singleton instance
const serviceManager = new ServiceManager();

export default serviceManager;

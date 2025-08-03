const Redis = require('redis');
const { config } = require('../config/environment');
const logger = require('../utils/logger');

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.retryQueue = 'firebase:retry:queue';
    this.cachePrefix = 'firebase:cache:';
    this.rfidQueue = 'rfid:processor:queue'; // Queue for RFID processor data
    this.isProcessing = false;
  }

  async initialize() {
    try {
      logger.info('Initializing Redis client with config:', {
        host: config.redis.host,
        port: config.redis.port,
        db: config.redis.db
      });

      this.client = Redis.createClient({
        url: `redis://${config.redis.host}:${config.redis.port}/${config.redis.db}`,
        password: config.redis.password || undefined,
        socket: {
          connectTimeout: 10000,
          lazyConnect: true,
          reconnectStrategy: (retries) => {
            if (retries > 20) {
              logger.error('Redis connection failed after 20 retries');
              return false;
            }
            const delay = Math.min(retries * 200, 5000);
            logger.info(`Redis reconnection attempt ${retries} in ${delay}ms`);
            return delay;
          }
        }
      });

      this.client.on('connect', () => {
        logger.info('Redis client connected to existing Redis service');
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        logger.error('Redis client error:', err);
        this.isConnected = false;
      });

      this.client.on('end', () => {
        logger.info('Redis client disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
      
      logger.success('Redis service initialized successfully (connecting to existing Redis)');
    } catch (error) {
      logger.error('Failed to initialize Redis service:', error);
      throw error;
    }
  }

  async addToRetryQueue(operation) {
    try {
      if (!this.isConnected) {
        throw new Error('Redis not connected');
      }

      const retryItem = {
        operation,
        timestamp: Date.now(),
        attempts: 0,
        maxAttempts: 5
      };

      await this.client.lPush(this.retryQueue, JSON.stringify(retryItem));
      logger.debug('Added operation to retry queue');
    } catch (error) {
      logger.error('Failed to add to retry queue:', error);
      throw error;
    }
  }

  async processRetryQueue() {
    try {
      if (!this.isConnected) {
        return;
      }

      const item = await this.client.rPop(this.retryQueue);
      if (!item) {
        return null;
      }

      const retryItem = JSON.parse(item);
      retryItem.attempts++;

      if (retryItem.attempts >= retryItem.maxAttempts) {
        logger.warn('Operation exceeded max retry attempts:', retryItem.operation);
        return null;
      }

      // Actually retry the operation
      await this.retryOperation(retryItem);

    } catch (error) {
      logger.error('Failed to process retry queue:', error);
    }
  }

  async retryOperation(retryItem) {
    try {
      const { operation } = retryItem;
      
      logger.info(`Retrying operation: ${operation.type} (attempt ${retryItem.attempts})`);

      // Import firebase service here to avoid circular dependency
      const firebaseService = require('./firebase');

      switch (operation.type) {
        case 'createTagRead':
          await firebaseService.createTagRead(operation.data);
          break;
        case 'createBatchTagReads':
          await firebaseService.createBatchTagReads(operation.data);
          break;
        case 'tagRead':
          await this.processTagReadItem({ data: operation.data });
          break;
        case 'event':
          await this.processEventItem({ data: operation.data });
          break;
        default:
          logger.warn(`Unknown retry operation type: ${operation.type}`);
      }

      logger.success(`Successfully retried operation: ${operation.type}`);

    } catch (error) {
      logger.error(`Retry operation failed: ${retryItem.operation.type}`, error);
      
      // Add back to retry queue for next attempt
      if (retryItem.attempts < retryItem.maxAttempts) {
        await this.addToRetryQueue(retryItem.operation);
      }
    }
  }

  // Process RFID processor queue
  async processRfidQueue() {
    try {
      if (!this.isConnected || this.isProcessing) {
        return;
      }

      this.isProcessing = true;

      // Process tagReads queue
      const tagReadItem = await this.client.rPop(`${this.rfidQueue}:tagReads`);
      if (tagReadItem) {
        await this.processTagReadItem(JSON.parse(tagReadItem));
      }

      // Process events queue
      const eventItem = await this.client.rPop(`${this.rfidQueue}:events`);
      if (eventItem) {
        await this.processEventItem(JSON.parse(eventItem));
      }

      this.isProcessing = false;
    } catch (error) {
      logger.error('Failed to process RFID queue:', error);
      this.isProcessing = false;
    }
  }

  async processTagReadItem(queueData) {
    try {
      const { tagId, tagDocument, collectionPath } = queueData.data;
      
      logger.info(`Processing queued tag read: ${tagId}`);
      
      // Import firebase service here to avoid circular dependency
      const firebaseService = require('./firebase');
      
      // Create the document in Firestore
      await firebaseService.createDocument(collectionPath, tagDocument);
      
      logger.success(`Successfully processed tag read: ${tagId}`);
    } catch (error) {
      logger.error(`Failed to process tag read: ${queueData.data.tagId}`, error);
      
      // Add back to retry queue
      await this.addToRetryQueue({
        type: 'tagRead',
        data: queueData.data
      });
    }
  }

  async processEventItem(queueData) {
    try {
      const { eventDocument, collectionPath } = queueData.data;
      
      logger.info(`Processing queued event: ${eventDocument.eventType}`);
      
      // Import firebase service here to avoid circular dependency
      const firebaseService = require('./firebase');
      
      // Create the document in Firestore
      await firebaseService.createDocument(collectionPath, eventDocument);
      
      logger.success(`Successfully processed event: ${eventDocument.eventType}`);
    } catch (error) {
      logger.error(`Failed to process event: ${queueData.data.eventDocument.eventType}`, error);
      
      // Add back to retry queue
      await this.addToRetryQueue({
        type: 'event',
        data: queueData.data
      });
    }
  }

  // Start processing RFID queue continuously
  startRfidQueueProcessor() {
    if (this.queueProcessorInterval) {
      clearInterval(this.queueProcessorInterval);
    }

    this.queueProcessorInterval = setInterval(() => {
      this.processRfidQueue();
    }, 100); // Process every 100ms

    logger.info('RFID queue processor started');
  }

  // Start processing retry queue continuously
  startRetryQueueProcessor() {
    if (this.retryProcessorInterval) {
      clearInterval(this.retryProcessorInterval);
    }

    this.retryProcessorInterval = setInterval(async () => {
      await this.processRetryQueue();
    }, 5000); // Process every 5 seconds

    logger.info('Retry queue processor started');
  }

  // Stop processing RFID queue
  stopRfidQueueProcessor() {
    if (this.queueProcessorInterval) {
      clearInterval(this.queueProcessorInterval);
      this.queueProcessorInterval = null;
      logger.info('RFID queue processor stopped');
    }
  }

  // Stop processing retry queue
  stopRetryQueueProcessor() {
    if (this.retryProcessorInterval) {
      clearInterval(this.retryProcessorInterval);
      this.retryProcessorInterval = null;
      logger.info('Retry queue processor stopped');
    }
  }

  async setCache(key, value, ttl = 3600) {
    try {
      if (!this.isConnected) {
        return;
      }

      const cacheKey = `${this.cachePrefix}${key}`;
      await this.client.setEx(cacheKey, ttl, JSON.stringify(value));
      logger.debug(`Cached value for key: ${key}`);
    } catch (error) {
      logger.error('Failed to set cache:', error);
    }
  }

  async getCache(key) {
    try {
      if (!this.isConnected) {
        return null;
      }

      const cacheKey = `${this.cachePrefix}${key}`;
      const value = await this.client.get(cacheKey);
      
      if (value) {
        logger.debug(`Cache hit for key: ${key}`);
        return JSON.parse(value);
      }
      
      logger.debug(`Cache miss for key: ${key}`);
      return null;
    } catch (error) {
      logger.error('Failed to get cache:', error);
      return null;
    }
  }

  async deleteCache(key) {
    try {
      if (!this.isConnected) {
        return;
      }

      const cacheKey = `${this.cachePrefix}${key}`;
      await this.client.del(cacheKey);
      logger.debug(`Deleted cache for key: ${key}`);
    } catch (error) {
      logger.error('Failed to delete cache:', error);
    }
  }

  async getRetryQueueLength() {
    try {
      if (!this.isConnected) {
        return 0;
      }

      return await this.client.lLen(this.retryQueue);
    } catch (error) {
      logger.error('Failed to get retry queue length:', error);
      return 0;
    }
  }

  async shutdown() {
    try {
      if (this.client) {
        await this.client.quit();
        logger.info('Redis service shutdown complete');
      }
    } catch (error) {
      logger.error('Error during Redis shutdown:', error);
    }
  }
}

module.exports = new RedisService(); 
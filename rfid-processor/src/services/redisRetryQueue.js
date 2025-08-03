const Redis = require('ioredis');
const logger = require('../utils/logger');

class RedisRetryQueue {
  constructor() {
    const { config } = require('../config/environment');
    
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableReadyCheck: true,
      maxLoadingTimeout: 10000
    });

    this.queueKey = 'firestore:retry:queue';
    this.processingKey = 'firestore:retry:processing';
    this.statsKey = 'firestore:retry:stats';
    this.rfidQueue = 'rfid:processor:queue'; // Queue for Firebase Gateway
    this.maxAttempts = 5;
    this.baseDelay = 1000; // 1 second
    this.maxDelay = 30000; // 30 seconds
    this.maxQueueSize = config.redis.maxQueueSize;
    this.maxMemoryMB = config.redis.maxMemoryMB;
    this.isProcessing = false;
    this.processingInterval = null;
    
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.redis.on('connect', () => {
      logger.success('Redis retry queue connected');
    });

    this.redis.on('error', (error) => {
      logger.error('Redis retry queue error', error);
    });

    this.redis.on('close', () => {
      logger.warning('Redis retry queue connection closed');
    });
  }

  // Initialize the Redis connection
  async initialize() {
    try {
      // The Redis connection is already established in the constructor
      // Just wait for it to be ready
      await this.redis.ping();
      logger.success('Redis retry queue initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Redis retry queue', error);
      throw error;
    }
  }

  // Add a failed write to the retry queue
  async addToRetryQueue(collectionPath, documentData, documentId = null) {
    try {
      // Check capacity limits before adding
      const capacityCheck = await this.checkCapacity();
      if (!capacityCheck.canAdd) {
        logger.error(`Retry queue capacity limit reached: ${capacityCheck.reason}`, {
          currentSize: capacityCheck.currentSize,
          maxSize: capacityCheck.maxSize,
          memoryUsage: capacityCheck.memoryUsage
        });
        return false; // Indicate failure to add
      }

      const item = {
        collectionPath,
        documentData,
        documentId,
        attempts: 0,
        addedAt: Date.now(),
        nextRetry: Date.now()
      };

      const itemKey = `${this.queueKey}:${Date.now()}:${Math.random()}`;
      
      // Store the item with TTL (7 days)
      await this.redis.setex(itemKey, 7 * 24 * 60 * 60, JSON.stringify(item));
      
      // Add to sorted set for processing (score = nextRetry timestamp)
      await this.redis.zadd(this.queueKey, item.nextRetry, itemKey);
      
      logger.warning(`Added to Redis retry queue: ${collectionPath} (${capacityCheck.currentSize + 1}/${this.maxQueueSize})`);
      
      // Start processing if not already running
      if (!this.isProcessing) {
        this.startProcessing();
      }
      
      return true; // Indicate success
      
    } catch (error) {
      logger.error('Failed to add item to Redis retry queue', error);
      // Fallback to in-memory queue if Redis is unavailable
      return this.fallbackToMemory(collectionPath, documentData, documentId);
    }
  }

  // Add data to RFID processor queue for Firebase Gateway
  async addToRfidQueue(queueName, queueData) {
    try {
      const queueKey = `${this.rfidQueue}:${queueName}`;
      await this.redis.lpush(queueKey, JSON.stringify(queueData));
      
      logger.debug(`Added to RFID queue: ${queueName}`, {
        type: queueData.type,
        data: queueData.data
      });
      
      return true;
    } catch (error) {
      logger.error(`Failed to add to RFID queue: ${queueName}`, error);
      return false;
    }
  }

  // Check capacity limits
  async checkCapacity() {
    try {
      const queueSize = await this.redis.zcard(this.queueKey);
      const memoryFallbackSize = this.memoryFallback?.size || 0;
      const totalSize = queueSize + memoryFallbackSize;
      
      // Check queue size limit
      if (totalSize >= this.maxQueueSize) {
        return {
          canAdd: false,
          reason: 'Queue size limit exceeded',
          currentSize: totalSize,
          maxSize: this.maxQueueSize,
          memoryUsage: null
        };
      }

      // Check memory usage (if Redis INFO is available)
      try {
        const info = await this.redis.info('memory');
        const usedMemoryMatch = info.match(/used_memory_human:(\d+\.?\d*)([KMGT]?B)/);
        if (usedMemoryMatch) {
          const usedMemory = parseFloat(usedMemoryMatch[1]);
          const unit = usedMemoryMatch[2];
          const usedMemoryMB = this.convertToMB(usedMemory, unit);
          
          if (usedMemoryMB >= this.maxMemoryMB) {
            return {
              canAdd: false,
              reason: 'Memory limit exceeded',
              currentSize: totalSize,
              maxSize: this.maxQueueSize,
              memoryUsage: `${usedMemoryMB.toFixed(2)}MB/${this.maxMemoryMB}MB`
            };
          }
        }
      } catch (memoryError) {
        // Memory check failed, continue with size check only
        logger.debug('Memory check failed, using size-only capacity check', memoryError);
      }

      return {
        canAdd: true,
        reason: 'Capacity OK',
        currentSize: totalSize,
        maxSize: this.maxQueueSize,
        memoryUsage: null
      };
      
    } catch (error) {
      logger.error('Error checking capacity', error);
      // If we can't check capacity, allow adding but log warning
      return {
        canAdd: true,
        reason: 'Capacity check failed, allowing add',
        currentSize: 'unknown',
        maxSize: this.maxQueueSize,
        memoryUsage: null
      };
    }
  }

  // Convert memory units to MB
  convertToMB(value, unit) {
    const multipliers = {
      'B': 1 / (1024 * 1024),
      'KB': 1 / 1024,
      'MB': 1,
      'GB': 1024,
      'TB': 1024 * 1024
    };
    return value * (multipliers[unit] || 1);
  }

  // Fallback to in-memory storage if Redis is down
  fallbackToMemory(collectionPath, documentData, documentId) {
    if (!this.memoryFallback) {
      this.memoryFallback = new Map();
    }
    
    // Check memory fallback capacity
    if (this.memoryFallback.size >= this.maxQueueSize) {
      logger.error(`Memory fallback capacity limit reached: ${this.memoryFallback.size}/${this.maxQueueSize}`, {
        collectionPath,
        reason: 'Memory fallback queue full'
      });
      return false; // Indicate failure to add
    }
    
    const key = `${collectionPath}:${Date.now()}:${Math.random()}`;
    this.memoryFallback.set(key, {
      collectionPath,
      documentData,
      documentId,
      attempts: 0,
      addedAt: Date.now(),
      nextRetry: Date.now()
    });
    
    logger.warning(`Using memory fallback for retry queue (${this.memoryFallback.size}/${this.maxQueueSize} items)`);
    return true; // Indicate success
  }

  // Start the retry processing loop
  startProcessing() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    this.processRetryQueue();
  }

  // Process the retry queue
  async processRetryQueue() {
    try {
      const now = Date.now();
      
      // Get items ready for retry (score <= now)
      const readyItems = await this.redis.zrangebyscore(this.queueKey, 0, now, 'LIMIT', 0, 10);
      
      if (readyItems.length === 0) {
        // Check memory fallback
        if (this.memoryFallback && this.memoryFallback.size > 0) {
          await this.processMemoryFallback();
        }
        
        // Schedule next check
        setTimeout(() => this.processRetryQueue(), 1000);
        return;
      }

      // Process ready items
      for (const itemKey of readyItems) {
        await this.retryItem(itemKey);
      }

      // Continue processing
      setTimeout(() => this.processRetryQueue(), 100);
      
    } catch (error) {
      logger.error('Error processing retry queue', error);
      this.isProcessing = false;
      
      // Retry processing after delay
      setTimeout(() => this.startProcessing(), 5000);
    }
  }

  // Process memory fallback items
  async processMemoryFallback() {
    const now = Date.now();
    const readyItems = [];
    
    for (const [key, item] of this.memoryFallback.entries()) {
      if (now >= item.nextRetry) {
        readyItems.push({ key, item });
      }
    }
    
    for (const { key, item } of readyItems) {
      await this.retryMemoryItem(key, item);
    }
  }

  // Retry a single item from Redis
  async retryItem(itemKey) {
    try {
      const itemData = await this.redis.get(itemKey);
      if (!itemData) {
        await this.redis.zrem(this.queueKey, itemKey);
        return;
      }
      
      const item = JSON.parse(itemData);
      await this.retryItemLogic(itemKey, item);
      
    } catch (error) {
      logger.error(`Error retrying item ${itemKey}`, error);
      // Remove problematic item
      await this.redis.zrem(this.queueKey, itemKey);
      await this.redis.del(itemKey);
    }
  }

  // Retry a single item from memory fallback
  async retryMemoryItem(key, item) {
    try {
      await this.retryItemLogic(key, item, true);
    } catch (error) {
      logger.error(`Error retrying memory item ${key}`, error);
      this.memoryFallback.delete(key);
    }
  }

  // Core retry logic
  async retryItemLogic(itemKey, item, isMemory = false) {
    try {
      // Import firebase service here to avoid circular dependency
      const firebaseService = require('./firebase');
      
      if (item.documentId) {
        // Update existing document
        await firebaseService.updateDocument(item.collectionPath, item.documentData);
      } else {
        // Create new document
        await firebaseService.createDocument(item.collectionPath, item.documentData);
      }

      // Success - remove from queue
      if (isMemory) {
        this.memoryFallback.delete(itemKey);
      } else {
        await this.redis.zrem(this.queueKey, itemKey);
        await this.redis.del(itemKey);
      }
      
      logger.success(`Retry successful: ${item.collectionPath} (attempt ${item.attempts + 1})`);

    } catch (error) {
      item.attempts++;
      
      if (item.attempts >= this.maxAttempts) {
        // Max attempts reached - log and remove
        if (isMemory) {
          this.memoryFallback.delete(itemKey);
        } else {
          await this.redis.zrem(this.queueKey, itemKey);
          await this.redis.del(itemKey);
        }
        
        logger.error(`Max retry attempts reached for ${item.collectionPath}`, {
          attempts: item.attempts,
          error: error.message
        });
      } else {
        // Calculate exponential backoff delay
        const delay = Math.min(
          this.baseDelay * Math.pow(2, item.attempts - 1),
          this.maxDelay
        );
        
        item.nextRetry = Date.now() + delay;
        
        if (isMemory) {
          this.memoryFallback.set(itemKey, item);
        } else {
          // Update item in Redis
          await this.redis.setex(itemKey, 7 * 24 * 60 * 60, JSON.stringify(item));
          await this.redis.zadd(this.queueKey, item.nextRetry, itemKey);
        }
        
        logger.warning(`Retry failed for ${item.collectionPath} (attempt ${item.attempts}/${this.maxAttempts})`, {
          nextRetry: new Date(item.nextRetry),
          delay
        });
      }
    }
  }

  // Get queue statistics
  async getStats() {
    try {
      const queueSize = await this.redis.zcard(this.queueKey);
      const now = Date.now();
      const readyToRetry = await this.redis.zcount(this.queueKey, 0, now);
      const totalItems = queueSize + (this.memoryFallback?.size || 0);
      
      // Get memory usage if available
      let memoryUsage = null;
      try {
        const info = await this.redis.info('memory');
        const usedMemoryMatch = info.match(/used_memory_human:(\d+\.?\d*)([KMGT]?B)/);
        if (usedMemoryMatch) {
          const usedMemory = parseFloat(usedMemoryMatch[1]);
          const unit = usedMemoryMatch[2];
          const usedMemoryMB = this.convertToMB(usedMemory, unit);
          memoryUsage = `${usedMemoryMB.toFixed(2)}MB/${this.maxMemoryMB}MB`;
        }
      } catch (memoryError) {
        // Memory check failed, continue without memory info
      }
      
      return {
        totalItems,
        readyToRetry: readyToRetry + (this.memoryFallback ? Array.from(this.memoryFallback.values()).filter(item => now >= item.nextRetry).length : 0),
        isProcessing: this.isProcessing,
        redisConnected: this.redis.status === 'ready',
        memoryFallbackSize: this.memoryFallback?.size || 0,
        capacity: {
          current: totalItems,
          max: this.maxQueueSize,
          percentage: Math.round((totalItems / this.maxQueueSize) * 100),
          memoryUsage
        }
      };
    } catch (error) {
      logger.error('Error getting retry queue stats', error);
      const memoryFallbackSize = this.memoryFallback?.size || 0;
      return {
        totalItems: memoryFallbackSize,
        readyToRetry: 0,
        isProcessing: this.isProcessing,
        redisConnected: false,
        memoryFallbackSize,
        capacity: {
          current: memoryFallbackSize,
          max: this.maxQueueSize,
          percentage: Math.round((memoryFallbackSize / this.maxQueueSize) * 100),
          memoryUsage: 'unknown'
        }
      };
    }
  }

  // Clear the queue (for testing or emergency)
  async clear() {
    try {
      const queueSize = await this.redis.zcard(this.queueKey);
      await this.redis.del(this.queueKey);
      
      const memorySize = this.memoryFallback?.size || 0;
      if (this.memoryFallback) {
        this.memoryFallback.clear();
      }
      
      logger.info(`Cleared retry queue (Redis: ${queueSize}, Memory: ${memorySize} items)`);
    } catch (error) {
      logger.error('Error clearing retry queue', error);
    }
  }

  // Graceful shutdown
  async shutdown() {
    this.isProcessing = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    await this.redis.quit();
  }
}

module.exports = new RedisRetryQueue(); 
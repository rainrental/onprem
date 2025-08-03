const { config } = require('../config/environment');
const logger = require('../utils/logger');

class MetricsCollector {
  constructor() {
    this.startTime = Date.now();
    this.eventCount = 0;
    this.processingTimes = [];
    this.lastTagSeen = null;
    this.errors = [];
    this.readerStats = new Map();
    this.deduplicationStats = {
      cachedEvents: 0,
      delayedReports: 0,
      cacheSize: 0
    };
  }

  // Record a tag event being processed
  recordTagEvent(tagId, hostname, processingTimeMs = 0) {
    this.eventCount++;
    this.lastTagSeen = new Date().toISOString();
    
    // Track processing time
    if (processingTimeMs > 0) {
      this.processingTimes.push(processingTimeMs);
      // Keep only last 1000 processing times for average calculation
      if (this.processingTimes.length > 1000) {
        this.processingTimes.shift();
      }
    }

    // Track reader statistics
    if (!this.readerStats.has(hostname)) {
      this.readerStats.set(hostname, 0);
    }
    this.readerStats.set(hostname, this.readerStats.get(hostname) + 1);
  }

  // Record deduplication statistics
  recordDeduplicationStats(stats) {
    this.deduplicationStats = {
      ...this.deduplicationStats,
      ...stats
    };
  }

  // Record an error
  recordError(error, context = 'unknown') {
    this.errors.push({
      timestamp: new Date().toISOString(),
      error: error.message || error.toString(),
      context,
      stack: error.stack
    });

    // Keep only last 100 errors
    if (this.errors.length > 100) {
      this.errors.shift();
    }
  }

  // Get system health status
  getHealthStatus() {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const lastError = this.errors.length > 0 ? this.errors[this.errors.length - 1] : null;
    
    return {
      timestamp: new Date().toISOString(),
      status: this.errors.length > 10 ? 'degraded' : 'healthy',
      uptimeSeconds,
      lastError: lastError ? {
        timestamp: lastError.timestamp,
        context: lastError.context,
        message: lastError.error
      } : null,
      errorsLastHour: this.errors.filter(error => 
        Date.now() - new Date(error.timestamp).getTime() < 3600000
      ).length
    };
  }

  // Get system statistics
  getSystemStats() {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const avgProcessingTime = this.processingTimes.length > 0 
      ? this.processingTimes.reduce((sum, time) => sum + time, 0) / this.processingTimes.length 
      : 0;

    return {
      timestamp: new Date().toISOString(),
      metrics: {
        uniqueTagsCount: this.getUniqueTagsCount(),
        totalEventsProcessed: this.eventCount,
        deduplicationCacheSize: this.deduplicationStats.cacheSize,
        retryQueueSize: this.getRetryQueueSize(),
        uptimeSeconds,
        lastTagSeen: this.lastTagSeen
      },
      performance: {
        eventsPerSecond: uptimeSeconds > 0 ? (this.eventCount / uptimeSeconds).toFixed(2) : 0,
        averageProcessingTimeMs: Math.round(avgProcessingTime),
        memoryUsageMB: this.getMemoryUsage()
      }
    };
  }

  // Get activity summary
  getActivitySummary() {
    const topReaders = Array.from(this.readerStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hostname, events]) => ({ hostname, events }));

    return {
      timestamp: new Date().toISOString(),
      period: '15min', // This will be calculated based on actual interval
      newTags: this.getNewTagsCount(),
      repeatedTags: this.eventCount - this.getNewTagsCount(),
      topReaders,
      deduplicationStats: {
        cachedEvents: this.deduplicationStats.cachedEvents,
        delayedReports: this.deduplicationStats.delayedReports
      }
    };
  }

  // Helper methods to get data from other services
  getUniqueTagsCount() {
    try {
      const firebaseService = require('./firebase');
      return firebaseService.getUniqueTagsCount();
    } catch (error) {
      logger.warning('Could not get unique tags count', error);
      return 0;
    }
  }

  getRetryQueueSize() {
    try {
      const retryQueue = require('./redisRetryQueue');
      const stats = retryQueue.getStats();
      return stats.totalItems || 0;
    } catch (error) {
      logger.warning('Could not get retry queue size', error);
      return 0;
    }
  }

  getMemoryUsage() {
    try {
      const usage = process.memoryUsage();
      return Math.round(usage.heapUsed / 1024 / 1024);
    } catch (error) {
      logger.warning('Could not get memory usage', error);
      return 0;
    }
  }

  getNewTagsCount() {
    // This is a simplified calculation - in reality, we'd track new vs repeated tags
    // For now, we'll estimate based on unique count vs total events
    const uniqueCount = this.getUniqueTagsCount();
    return Math.min(uniqueCount, this.eventCount);
  }

  // Reset metrics (useful for testing or after errors)
  reset() {
    this.eventCount = 0;
    this.processingTimes = [];
    this.errors = [];
    this.readerStats.clear();
    this.deduplicationStats = {
      cachedEvents: 0,
      delayedReports: 0,
      cacheSize: 0
    };
  }
}

module.exports = new MetricsCollector(); 
const logger = require('../utils/logger');
const metricsCollector = require('./metricsCollector');

class Deduplicator {
  constructor(intervalMinutes = 60) {
    this.intervalMinutes = intervalMinutes;
    this.cache = new Map();
    this.timers = new Map();
    
    logger.info(`Deduplicator initialized with ${intervalMinutes} minute interval`);
  }

  shouldReport(timestamp, key, tagDocument, uniqueCount) {
    const cached = this.cache.get(key);
    
    if (cached) {
      cached.event = tagDocument;
      cached.lastSeen = timestamp;
      
      logger.tag('cached', {
        tagId: tagDocument.tidHex,
        hostname: tagDocument.hostname,
        uniqueCount,
        action: 'cached'
      });
      
      return false;
    }
    
    this.cache.set(key, {
      event: tagDocument,
      lastSeen: timestamp,
      timer: this.scheduleReport(key)
    });
    
    logger.tag('processing', {
      tagId: tagDocument.tidHex,
      hostname: tagDocument.hostname,
      uniqueCount,
      action: 'processing'
    });
    
    return true;
  }

  scheduleReport(key) {
    const timer = setTimeout(() => {
      this.reportCached(key);
    }, this.intervalMinutes * 60 * 1000);
    
    this.timers.set(key, timer);
    return timer;
  }

  reportCached(key) {
    const cached = this.cache.get(key);
    
    if (!cached?.event) {
      logger.warning(`No cached event found for key: ${key}`);
      this.timers.delete(key);
      return;
    }
    
    if (this.onReport) {
      this.onReport(cached.event, cached.event.tidHex, 1);
    }
    
    logger.tag('delayed-report', {
      tagId: cached.event.tidHex,
      hostname: cached.event.hostname,
      cachedCount: 1,
      action: 'delayed-report'
    });
    
    this.cache.delete(key);
    this.timers.delete(key);
  }

  setReportCallback(callback) {
    this.onReport = callback;
  }

  updateInterval(newIntervalMinutes) {
    if (newIntervalMinutes === this.intervalMinutes) return;
    
    logger.info(`Updating deduplicator interval from ${this.intervalMinutes} to ${newIntervalMinutes} minutes`);
    this.intervalMinutes = newIntervalMinutes;
    
    for (const [key, timer] of this.timers.entries()) {
      clearTimeout(timer);
      const cached = this.cache.get(key);
      if (cached) {
        cached.timer = this.scheduleReport(key);
      }
    }
  }

  cleanup() {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    
    this.cache.clear();
    this.timers.clear();
  }

  getStats() {
    return {
      activeKeys: this.cache.size,
      activeTimers: this.timers.size,
      totalCachedEvents: this.cache.size // Each key has exactly one event
    };
  }
}

module.exports = Deduplicator; 
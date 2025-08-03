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
      // Tag already seen - replace cached event with latest
      cached.event = tagDocument; // Replace, don't accumulate
      cached.lastSeen = timestamp;
      
      logger.tag('cached', {
        tagId: tagDocument.tidHex,
        hostname: tagDocument.hostname,
        uniqueCount
      });
      
      // Update metrics
      metricsCollector.recordDeduplicationStats({
        cacheSize: this.cache.size
      });
      
      return false;
    } else {
      // First time seeing this tag - report immediately and set up timer
      this.cache.set(key, {
        event: tagDocument, // Single event, not array
        lastSeen: timestamp,
        timer: this.scheduleReport(key)
      });
      
      // Log processing for new tags
      logger.tag('processing', {
        tagId: tagDocument.tidHex,
        hostname: tagDocument.hostname,
        uniqueCount
      });
      
      // Update metrics
      metricsCollector.recordDeduplicationStats({
        cacheSize: this.cache.size
      });
      
      return true;
    }
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
    
    if (cached && cached.event) {
      // Report the latest event (only one event, not accumulated)
      if (this.onReport) {
        this.onReport(cached.event, cached.event.tidHex, 1); // Always count as 1
      }
      
      logger.tag('delayed-report', {
        tagId: cached.event.tidHex,
        hostname: cached.event.hostname,
        cachedCount: 1
      });
      
      // Update metrics
      metricsCollector.recordDeduplicationStats({
        delayedReports: 1,
        cacheSize: this.cache.size
      });
      
      this.cache.delete(key);
    } else {
      logger.warning(`No cached event found for key: ${key}`);
    }
    
    // Clean up timer
    this.timers.delete(key);
  }

  setReportCallback(callback) {
    this.onReport = callback;
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
const { config } = require('../config/environment');
const firebaseService = require('./firebase');
const metricsCollector = require('./metricsCollector');
const logger = require('../utils/logger');

class PeriodicPublisher {
  constructor() {
    this.timers = new Map();
    this.isRunning = false;
  }

  start() {
    if (!config.metrics.enablePeriodicPublishing) {
      logger.info('Periodic publishing disabled');
      return;
    }

    if (this.isRunning) {
      logger.warning('Periodic publisher already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting periodic publisher');

    logger.success('Periodic publisher started (metrics collection disabled in RFID processor mode)');
  }

  schedulePublishing(type, interval, callback) {
    // Initial publish
    callback();

    // Schedule recurring publishes
    const timer = setInterval(callback, interval);
    this.timers.set(type, timer);

    logger.info(`Scheduled ${type} publishing every ${interval / 1000} seconds`);
  }

  // Manual publish (for testing or on-demand)
  async publishAll() {
    logger.info('Manual publishing all metrics (disabled in RFID processor mode)');
  }

  // Stop all publishing
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    // Clear all timers
    for (const [type, timer] of this.timers.entries()) {
      clearInterval(timer);
      logger.info(`Stopped ${type} publishing`);
    }
    
    this.timers.clear();
    logger.info('Periodic publisher stopped');
  }

  // Get publishing status
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeTimers: Array.from(this.timers.keys()),
      config: {
        enabled: config.metrics.enablePeriodicPublishing,
        healthPublishInterval: config.metrics.healthPublishInterval,
        metricsPublishInterval: config.metrics.metricsPublishInterval,
        summaryPublishInterval: config.metrics.summaryPublishInterval
      }
    };
  }
}

module.exports = new PeriodicPublisher(); 
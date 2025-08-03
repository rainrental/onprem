const { config } = require('../config/environment');
const logger = require('../utils/logger');

class QueueService {
  constructor() {
    this.isInitialized = false;
    this.uniqueTags = new Set();
  }

  initialize() {
    try {
      this.isInitialized = true;
      logger.success('Queue service initialized (RFID processor mode)');
    } catch (error) {
      logger.error('Failed to initialize queue service', error);
      throw error;
    }
  }

  getUniqueTagsCount() {
    return this.uniqueTags.size;
  }

  addUniqueTag(tagId) {
    this.uniqueTags.add(tagId);
  }

  clearUniqueTags() {
    this.uniqueTags.clear();
  }

  getServerTimestamp() {
    return new Date();
  }
}

module.exports = new QueueService(); 
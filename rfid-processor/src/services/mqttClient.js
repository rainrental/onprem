const mqtt = require('mqtt');
const { config } = require('../config/environment');
const logger = require('../utils/logger');
const metricsCollector = require('./metricsCollector');
const retryQueue = require('./redisRetryQueue');
const Deduplicator = require('./deduplicator');
const hostnameGroupsConfig = require('../config/hostnameGroups');
const locationStateService = require('./locationState');

class MqttClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.messageCounter = 0;
    this.deduplicator = new Deduplicator(2);
    this.uniqueTags = new Set();
  }

  initialize() {
    this.createClient();
    this.setupEventHandlers();
    this.connect();
    this.setupDeduplicator();
  }

  setupDeduplicator() {
    this.deduplicator.setReportCallback(async (tagDocument, tagId, eventCount) => {
      try {
        await this.queueTagEvent(tagId, tagDocument);
      } catch (error) {
        logger.error('Failed to queue delayed tag event', error);
      }
    });
    
    const state = locationStateService.getState();
    this.deduplicator.updateInterval(state.deduplicateInterval);
    
    logger.info('Deduplicator ready for use');
  }

  createClient() {
    const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const clientType = config.mobile ? 'mobile' : 'fixed';
    const clientId = `${randomCode}-${clientType}`;

    const connectionUrl = `mqtt://${config.mqtt.host}:${config.mqtt.port}`;

    this.client = mqtt.connect(connectionUrl, {
      clientId,
      keepalive: config.mqtt.aliveInterval,
      clean: true,
      reconnectPeriod: 1000,
      connectTimeout: 30000
    });

    logger.info(`MQTT client created: ${clientId}`);
  }

  setupEventHandlers() {
    this.client.on('connect', this.handleConnect.bind(this));
    this.client.on('disconnect', this.handleDisconnect.bind(this));
    this.client.on('message', this.handleMessage.bind(this));
    this.client.on('error', this.handleError.bind(this));
  }

  connect() {
    logger.info(`Connecting to MQTT broker: ${config.mqtt.host}:${config.mqtt.port}`);
  }

  handleConnect() {
    this.isConnected = true;
    logger.success('MQTT connected successfully');

    if (config.mobile) {
      logger.info('MQTT client running in mobile mode');
    }

    this.client.subscribe(config.mqtt.topic, { qos: 2 }, (error) => {
      if (error) {
        logger.error('Failed to subscribe to MQTT topic', error);
      } else {
        logger.info(`Subscribed to MQTT topic: ${config.mqtt.topic}`);
      }
    });
  }

  handleDisconnect() {
    this.isConnected = false;
    logger.warning('MQTT disconnected');
  }

  handleError(error) {
    logger.error('MQTT client error', error);
  }

  async handleMessage(topic, message) {
    try {
      const messageData = JSON.parse(message.toString());

      if (config.mqtt.logRaw) {
        logger.debug('Raw MQTT message received', messageData);
      }

      const eventType = messageData.eventType;

      if (eventType === 'tagInventory') {
        await this.processTagInventory(messageData, topic);
      } else {
        await this.processNonTagEvent(messageData);
      }

    } catch (error) {
      logger.error('Failed to process MQTT message', error);
      metricsCollector.recordError(error, 'mqtt-message-processing');
    }
  }

  getDeduplicationKey(tagEvent) {
    const groupName = hostnameGroupsConfig.getGroupForHostname(tagEvent.hostname);
    return `${groupName}:${tagEvent.tidHex}`;
  }

  getOutcomeInfo(shouldReport, reporting) {
    if (shouldReport && reporting) {
      return { outcome: 'Delivered', emoji: '📤' };
    } else if (shouldReport && !reporting) {
      return { outcome: 'Not Reported', emoji: '🚫' };
    } else if (!shouldReport) {
      return { outcome: 'Cached', emoji: '⏳' };
    } else {
      return { outcome: 'Error', emoji: '❌' };
    }
  }

  async processTagInventory(messageData, topic) {
    const startTime = Date.now();
    const tagEvent = messageData.tagInventoryEvent;

    if (!tagEvent.tidHex) {
      logger.warning('Tag inventory event missing tidHex', messageData);
      return;
    }

    // Get hostname from root level of message, not from tagEvent
    const hostname = messageData.hostname || 'NoHostUpgradeToVersion8';

    // Add hostname to tagEvent if it's not already there
    if (!tagEvent.hostname) {
      tagEvent.hostname = hostname;
    }

    const tagDocument = this.createTagDocument(tagEvent, topic);

    this.uniqueTags.add(tagEvent.tidHex);

    locationStateService.refreshConfiguration().then(() => {
      const state = locationStateService.getState();
      this.deduplicator.updateInterval(state.deduplicateInterval);
    }).catch(error => {
      logger.warning('Failed to refresh configuration, using current state', error);
    });

    const state = locationStateService.getState();
    const deduplicationKey = this.getDeduplicationKey(tagEvent);
    
    const shouldReport = !state.deduplicate || 
      this.deduplicator.shouldReport(
        new Date(tagDocument.timestamp),
        deduplicationKey,
        tagDocument,
        this.uniqueTags.size
      );

    const { outcome, emoji } = this.getOutcomeInfo(shouldReport, state.reporting);
    logger.info(`TPD: ${emoji} ${outcome} [Key: ${deduplicationKey}]`);

    if (shouldReport && state.reporting) {
      await this.queueTagEvent(tagEvent.tidHex, tagDocument);
    } else if (shouldReport && !state.reporting) {
      logger.tag('not-reported', {
        tagId: tagEvent.tidHex,
        hostname: tagEvent.hostname,
        uniqueCount: this.uniqueTags.size,
        action: 'not-reported'
      });
    }

    const processingTime = Date.now() - startTime;
    metricsCollector.recordTagEvent(tagEvent.tidHex, tagEvent.hostname, processingTime);
  }

  async processNonTagEvent(messageData) {
    const eventType = messageData.eventType;
    const eventData = messageData[eventType + 'Event'];
    const hostname = messageData.hostname || 'NoHostUpgradeToVersion8';

    const eventDocument = {
      timestamp: messageData.timestamp.substring(0, messageData.timestamp.length - 1),
      server_timestamp: new Date(),
      hostname,
      eventType,
      event: eventData,
      read: false
    };

    logger.info(`Non-tag event: ${eventType} for ${hostname}`, eventData);
    await this.queueEvent(eventDocument);
  }

  createTagDocument(tagEvent, topic) {
    // Convert tidHex to base64 for tid field
    const tidBase64 = Buffer.from(tagEvent.tidHex, 'hex').toString('base64');
    
    const document = {
      antennaName: `${tagEvent.antenna || 1}`,
      antennaPort: tagEvent.antenna || 1,
      companyId: config.companyId,
      epc: tagEvent.epc || tagEvent.tidHex, // Use epc if available, fallback to tidHex
      frequency: config.rfid.frequency,
      host_timestamp: tagEvent.timestamp, // Host timestamp from RFID reader
      hostname: tagEvent.hostname,
      location: config.location.name,
      mobile: config.mobile,
      peakRssiCdbm: tagEvent.rssi,
      tid: tidBase64, // Base64 encoding of tidHex
      tidHex: tagEvent.tidHex,
      topic: topic,
      transmitPowerCdbm: config.rfid.transmitPowerCdbm
    };

    if (tagEvent.lat && tagEvent.lon) {
      document.lat = tagEvent.lat;
      document.lon = tagEvent.lon;
    }

    return document;
  }

  async queueTagEvent(tagId, tagDocument) {
    try {
      const queueData = {
        type: 'tagRead',
        data: {
          tagId,
          tagDocument,
          collectionPath: `companies/${config.companyId}/tags/${tagId}/reads`
        }
      };

      const added = await retryQueue.addToRfidQueue('tagReads', queueData);
      
      if (added) {
        this.messageCounter++;
        logger.tag('delivered', {
          tagId,
          hostname: tagDocument.hostname,
          uniqueCount: this.uniqueTags.size,
          action: 'delivered'
        });
      } else {
        logger.error(`Failed to queue tag event: ${tagId} - queue capacity limit reached`);
        metricsCollector.recordError(new Error('Queue capacity limit reached'), 'queue-full');
      }

    } catch (error) {
      logger.error(`Failed to queue tag event for ${tagId}`, error);
      metricsCollector.recordError(error, 'tag-event-queuing');
    }
  }

  async queueEvent(eventDocument) {
    try {
      const queueData = {
        type: 'event',
        data: {
          eventDocument,
          collectionPath: `companies/${config.companyId}/readers/${eventDocument.hostname}/events`
        }
      };

      const added = await retryQueue.addToRfidQueue('events', queueData);
      
      if (!added) {
        logger.error(`Failed to queue event: ${eventDocument.eventType} - queue capacity limit reached`);
      }

    } catch (error) {
      logger.error(`Failed to queue event: ${eventDocument.eventType}`, error);
      metricsCollector.recordError(error, 'event-queuing');
    }
  }

  disconnect() {
    if (this.client) {
      this.client.end();
      this.isConnected = false;
    }

    if (this.deduplicator) {
      this.deduplicator.cleanup();
    }
  }

  getStats() {
    return {
      isConnected: this.isConnected,
      messageCount: this.messageCounter,
      uniqueTags: this.uniqueTags.size,
      deduplicatorStats: this.deduplicator?.getStats(),
      retryQueueStats: retryQueue.getStats()
    };
  }
}

module.exports = new MqttClient(); 
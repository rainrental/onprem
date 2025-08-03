#!/usr/bin/env node

const { validateConfig } = require('./config/environment');
const queueService = require('./services/firebase');
const locationStateService = require('./services/locationState');
const mqttClient = require('./services/mqttClient');
const periodicPublisher = require('./services/periodicPublisher');
const redisService = require('./services/redisRetryQueue');
const logger = require('./utils/logger');

class TagProcessingServer {
  constructor() {
    this.isShuttingDown = false;
  }

  async start() {
    try {
      // Validate configuration
      validateConfig();
      
      // Initialize Redis retry queue
      await redisService.initialize();
      
      // Initialize queue service (RFID processor mode)
      queueService.initialize();
      
      // Load location state
      await locationStateService.loadFromGateway();
      
      // Initialize MQTT client
      mqttClient.initialize();
      
      // Initialize periodic metrics publishing
      periodicPublisher.start();
      
      // Start configuration refresh timer
      this.startConfigurationRefresh();
      
      // Set up graceful shutdown
      this.setupGracefulShutdown();
      
      logger.success('Tag processing server started successfully');
      
    } catch (error) {
      logger.error('Failed to start server', error);
      process.exit(1);
    }
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) return;
      
      this.isShuttingDown = true;
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      try {
        // Disconnect MQTT client
        mqttClient.disconnect();
        
        // Stop periodic publishing
        periodicPublisher.stop();
        
        // Stop configuration refresh
        this.stopConfigurationRefresh();
        
        // Shutdown Redis retry queue
        await redisService.shutdown();
        
        logger.success('Server shutdown completed');
        process.exit(0);
        
      } catch (error) {
        logger.error('Error during shutdown', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  startConfigurationRefresh() {
    // Refresh configuration every 5 minutes
    this.configRefreshInterval = setInterval(async () => {
      try {
        await locationStateService.refreshConfiguration();
      } catch (error) {
        logger.error('Failed to refresh configuration', error);
      }
    }, 5 * 60 * 1000); // 5 minutes

    logger.info('Configuration refresh timer started (every 5 minutes)');
  }

  stopConfigurationRefresh() {
    if (this.configRefreshInterval) {
      clearInterval(this.configRefreshInterval);
      this.configRefreshInterval = null;
      logger.info('Configuration refresh timer stopped');
    }
  }
}

// Start the server
const server = new TagProcessingServer();
server.start(); 
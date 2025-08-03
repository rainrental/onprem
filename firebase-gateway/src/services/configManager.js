const { doc, onSnapshot } = require('firebase/firestore');
const { config } = require('../config/environment');
const logger = require('../utils/logger');
const firebaseService = require('./firebase');
const authManager = require('./authManager');

class ConfigManager {
  constructor() {
    this.isInitialized = false;
    this.unsubscribe = null;
    this.cachedConfig = null;
    this.lastUpdateTime = null;
    this.memoryUsage = {
      activeListeners: 0,
      estimatedMemoryKB: 0,
      cachedConfigs: 0,
      lastReported: null
    };
    this.reportInterval = null;
  }

  async initialize() {
    try {
      if (!authManager.isUserAuthenticated()) {
        throw new Error('Authentication required for config manager');
      }

      const companyId = authManager.getCompanyId();
      const locationName = authManager.getLocationName();

      if (!companyId || !locationName) {
        throw new Error('Company ID and Location Name required for config manager');
      }

      logger.info('Initializing config manager', { companyId, locationName });

      // Set up snapshot listener
      await this.setupSnapshotListener(companyId, locationName);

      // Start memory usage reporting
      this.startMemoryReporting(companyId, locationName);

      this.isInitialized = true;
      logger.success('Config manager initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize config manager', error);
      throw error;
    }
  }

  async setupSnapshotListener(companyId, locationName) {
    try {
      const database = firebaseService.getDatabase();
      const locationPath = `companies/${companyId}/locations/${locationName}`;
      const locationDocRef = doc(database, locationPath);

      logger.info('Setting up snapshot listener', { locationPath });

      this.unsubscribe = onSnapshot(locationDocRef, 
        (snapshot) => {
          this.handleConfigUpdate(snapshot.data(), companyId, locationName);
        },
        (error) => {
          logger.error('Snapshot listener error', error);
          // Attempt to reconnect after delay
          setTimeout(() => {
            this.setupSnapshotListener(companyId, locationName);
          }, 5000);
        }
      );

      this.memoryUsage.activeListeners = 1;
      this.memoryUsage.estimatedMemoryKB = 150; // Estimated overhead per listener
      this.memoryUsage.cachedConfigs = 1;

      logger.info('Snapshot listener established', { 
        locationPath,
        memoryUsage: this.getMemoryUsage()
      });

    } catch (error) {
      logger.error('Failed to setup snapshot listener', error);
      throw error;
    }
  }

  handleConfigUpdate(newData, companyId, locationName) {
    try {
      if (!newData) {
        logger.warning('Received empty config data from snapshot');
        return;
      }

      const oldData = this.cachedConfig;
      const hasRelevantChanges = this.hasRelevantChanges(oldData, newData);

      if (hasRelevantChanges) {
        logger.info('Relevant config changes detected', {
          locationName,
          companyId,
          changedFields: this.getChangedFields(oldData, newData)
        });

        // Update cached config
        this.cachedConfig = newData;
        this.lastUpdateTime = new Date();

        // Trigger config update handlers
        this.triggerConfigUpdateHandlers(newData);

        logger.info('Config updated successfully', {
          locationName,
          companyId,
          lastUpdate: this.lastUpdateTime
        });
      } else {
        logger.debug('Config update received but no relevant changes', {
          locationName,
          companyId
        });
      }

    } catch (error) {
      logger.error('Error handling config update', error);
    }
  }

  hasRelevantChanges(oldData, newData) {
    if (!oldData || !newData) {
      return true; // First load or missing data
    }

    const relevantFields = [
      'deduplicate', 'deduplicate_interval', 'deduplicate_mobile', 
      'deduplicate_mobile_interval', 'update_strategy', 'current_version',
      'auto_update', 'check_interval', 'update_window', 'safety_checks'
    ];

    return relevantFields.some(field => {
      const oldValue = oldData[field];
      const newValue = newData[field];
      
      // Handle nested objects (like update_window and safety_checks)
      if (typeof oldValue === 'object' && typeof newValue === 'object') {
        return JSON.stringify(oldValue) !== JSON.stringify(newValue);
      }
      
      return oldValue !== newValue;
    });
  }

  getChangedFields(oldData, newData) {
    if (!oldData || !newData) {
      return ['initial_load'];
    }

    const relevantFields = [
      'deduplicate', 'deduplicate_interval', 'deduplicate_mobile', 
      'deduplicate_mobile_interval', 'update_strategy', 'current_version',
      'auto_update', 'check_interval', 'update_window', 'safety_checks'
    ];

    return relevantFields.filter(field => {
      const oldValue = oldData[field];
      const newValue = newData[field];
      
      if (typeof oldValue === 'object' && typeof newValue === 'object') {
        return JSON.stringify(oldValue) !== JSON.stringify(newValue);
      }
      
      return oldValue !== newValue;
    });
  }

  triggerConfigUpdateHandlers(newConfig) {
    // This can be extended to notify other parts of the application
    // For now, just log the update
    logger.info('Config update handlers triggered', {
      config: {
        deduplicate: newConfig.deduplicate,
        updateStrategy: newConfig.update_strategy,
        autoUpdate: newConfig.auto_update
      }
    });
  }

  getMemoryUsage() {
    return {
      activeListeners: this.memoryUsage.activeListeners,
      estimatedMemoryKB: this.memoryUsage.estimatedMemoryKB,
      cachedConfigs: this.memoryUsage.cachedConfigs,
      lastReported: this.memoryUsage.lastReported,
      lastUpdateTime: this.lastUpdateTime
    };
  }

  async startMemoryReporting(companyId, locationName) {
    // Report memory usage every 5 minutes
    const reportIntervalMs = 5 * 60 * 1000;

    this.reportInterval = setInterval(async () => {
      try {
        await this.reportMemoryUsage(companyId, locationName);
      } catch (error) {
        logger.error('Failed to report memory usage', error);
      }
    }, reportIntervalMs);

    // Initial report
    await this.reportMemoryUsage(companyId, locationName);

    logger.info('Memory usage reporting started', { 
      intervalMs: reportIntervalMs,
      companyId,
      locationName
    });
  }

  async reportMemoryUsage(companyId, locationName) {
    try {
      const memoryData = this.getMemoryUsage();
      const reportData = {
        gateway_memory_usage: {
          activeListeners: memoryData.activeListeners,
          estimatedMemoryKB: memoryData.estimatedMemoryKB,
          cachedConfigs: memoryData.cachedConfigs,
          lastReported: new Date().toISOString(),
          gatewayId: process.env.GATEWAY_ID || 'firebase-gateway',
          version: process.env.VERSION || 'unknown'
        }
      };

      const locationPath = `companies/${companyId}/locations/${locationName}`;
      await firebaseService.updateDocument(locationPath, reportData);

      this.memoryUsage.lastReported = new Date();

      logger.debug('Memory usage reported to Firestore', {
        locationPath,
        memoryData
      });

    } catch (error) {
      logger.error('Failed to report memory usage to Firestore', error);
      throw error;
    }
  }

  getCachedConfig() {
    return this.cachedConfig;
  }

  isInitialized() {
    return this.isInitialized;
  }

  async shutdown() {
    try {
      logger.info('Shutting down config manager');

      // Clear memory reporting interval
      if (this.reportInterval) {
        clearInterval(this.reportInterval);
        this.reportInterval = null;
      }

      // Unsubscribe from snapshot listener
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }

      // Clear cached data
      this.cachedConfig = null;
      this.lastUpdateTime = null;
      this.memoryUsage = {
        activeListeners: 0,
        estimatedMemoryKB: 0,
        cachedConfigs: 0,
        lastReported: null
      };

      this.isInitialized = false;

      logger.success('Config manager shutdown complete');

    } catch (error) {
      logger.error('Error during config manager shutdown', error);
    }
  }
}

module.exports = new ConfigManager(); 
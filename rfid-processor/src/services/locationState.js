const { config } = require('../config/environment');
const logger = require('../utils/logger');
const axios = require('axios');

class LocationStateService {
  constructor() {
    this.state = {
      deduplicate: false,
      deduplicateInterval: 2,
      reporting: false
    };
    this.lastConfigUpdate = null;
    this.configRefreshInterval = config.config.refreshInterval;
  }

  async loadFromGateway() {
    try {
      const { gatewayUrl, locationName, companyId } = this.getConfigParams();
      const response = await axios.get(`${gatewayUrl}/api/config/location/${locationName}`, {
        params: { companyId },
        timeout: 5000
      });

      if (!response.data.success || !response.data.config) {
        throw new Error('Invalid response from gateway');
      }

      this.updateStateFromConfig(response.data.config);
      this.lastConfigUpdate = new Date();
      
      logger.info('Configuration loaded from gateway', {
        locationName,
        companyId,
        config: this.state,
        lastUpdated: response.data.config.lastUpdated
      });
      
      this.logCurrentState();
      
    } catch (error) {
      logger.warning('Failed to load configuration from gateway, using default state', {
        error: error.message,
        locationName: config.location.name,
        companyId: config.companyId
      });
      this.setDefaultState();
    }
  }

  getConfigParams() {
    return {
      gatewayUrl: config.firebase.gatewayUrl,
      locationName: config.location.name,
      companyId: config.companyId
    };
  }

  updateStateFromConfig(gatewayConfig) {
    const prefix = config.mobile ? 'Mobile' : '';
    this.state = {
      deduplicate: gatewayConfig[`deduplicate${prefix}`] ?? false,
      deduplicateInterval: gatewayConfig[`deduplicate${prefix}Interval`] ?? 2,
      reporting: gatewayConfig[`reporting${prefix}`] ?? false
    };
  }

  setDefaultState() {
    this.state = {
      deduplicate: false,
      deduplicateInterval: 2,
      reporting: true
    };
    this.logCurrentState();
  }

  async refreshConfiguration() {
    const now = Date.now();
    const shouldRefresh = !this.lastConfigUpdate || 
      (now - this.lastConfigUpdate.getTime()) > this.configRefreshInterval;
    
    if (shouldRefresh) {
      logger.info('Refreshing configuration from gateway');
      await this.loadFromGateway();
    }
  }

  logCurrentState() {
    logger.info('Location State Configuration:', {
      deduplicate: this.state.deduplicate,
      deduplicateInterval: this.state.deduplicateInterval,
      reporting: this.state.reporting
    });
  }

  getState() {
    return this.state;
  }



}

module.exports = new LocationStateService(); 
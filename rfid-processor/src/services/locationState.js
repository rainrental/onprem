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
      const gatewayUrl = config.firebase.gatewayUrl;
      const locationName = config.location.name;
      const companyId = config.companyId;

      logger.info(`Fetching configuration from gateway: ${gatewayUrl}/api/config/location/${locationName}?companyId=${companyId}`);

      const response = await axios.get(`${gatewayUrl}/api/config/location/${locationName}`, {
        params: { companyId },
        timeout: 5000
      });

      if (response.data.success && response.data.config) {
        const gatewayConfig = response.data.config;
        
        // Update state based on device type
        if (config.mobile) {
          this.state = {
            deduplicate: gatewayConfig.deduplicateMobile ?? false,
            deduplicateInterval: gatewayConfig.deduplicateMobileInterval ?? 2,
            reporting: gatewayConfig.reportingMobile ?? false
          };
        } else {
          this.state = {
            deduplicate: gatewayConfig.deduplicate ?? false,
            deduplicateInterval: gatewayConfig.deduplicateInterval ?? 2,
            reporting: gatewayConfig.reporting ?? false
          };
        }

        this.lastConfigUpdate = new Date();
        logger.info('Configuration loaded from gateway', {
          locationName,
          companyId,
          config: this.state,
          lastUpdated: gatewayConfig.lastUpdated
        });
      } else {
        throw new Error('Invalid response from gateway');
      }

      this.logCurrentState();
      
    } catch (error) {
      logger.warning('Failed to load configuration from gateway, using default state', {
        error: error.message,
        locationName: config.location.name,
        companyId: config.companyId
      });
      

      this.state = {
        deduplicate: false,
        deduplicateInterval: 2,
        reporting: true  // Enable reporting for testing
      };
      this.logCurrentState();
    }
  }

  async refreshConfiguration() {
    const now = Date.now();
    if (!this.lastConfigUpdate || (now - this.lastConfigUpdate.getTime()) > this.configRefreshInterval) {
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
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class HostnameGroupsConfig {
  constructor() {
    this.config = null;
    this.loadConfig();
  }

  loadConfig() {
    try {
      const configPath = path.join(__dirname, '../../config/hostname-groups.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      this.config = JSON.parse(configData);
      
      logger.info('Hostname groups configuration loaded successfully');
      logger.debug('Deduplication group:', this.config.deduplicationGroup);
      logger.debug('Available groups:', Object.keys(this.config.groups));
      
    } catch (error) {
      logger.warning('Failed to load hostname groups config, using default hostname grouping');
      this.config = {
        deduplicationGroup: 'hostname',
        groups: {}
      };
    }
  }

  getDeduplicationGroup() {
    return this.config.deduplicationGroup;
  }

  getGroupForHostname(hostname) {
    // If deduplication group is 'hostname', return the hostname as-is
    if (this.config.deduplicationGroup === 'hostname') {
      return hostname;
    }

    // Look for the hostname in the groups
    for (const [groupName, hostnames] of Object.entries(this.config.groups)) {
      if (hostnames.includes(hostname)) {
        return groupName;
      }
    }

    // If not found in any group, return the hostname as fallback
    return hostname;
  }

  getConfig() {
    return this.config;
  }
}

module.exports = new HostnameGroupsConfig(); 
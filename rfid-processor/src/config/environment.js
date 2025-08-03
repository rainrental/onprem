const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const config = {
  location: {
    name: process.env.LOCATIONNAME || 'Default Location'
  },
  companyId: process.env.COMPANY_ID || 'default-company',
  mobile: process.env.MOBILE === '1',
  
  mqtt: {
    host: process.env.MQTT_HOST || 'mosquitto',
    port: parseInt(process.env.MQTT_PORT) || 1883,
    topic: process.env.MQTT_TOPIC || 'rfid/#',
    aliveInterval: parseInt(process.env.MQTT_ALIVE_INTERVAL) || 60,
    logRaw: process.env.MQTT_LOG_RAW === 'true'
  },
  
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB) || 0,
    maxQueueSize: parseInt(process.env.REDIS_MAX_QUEUE_SIZE) || 1000000,
    maxMemoryMB: parseInt(process.env.REDIS_MAX_MEMORY_MB) || 2048,
    enablePersistence: process.env.REDIS_ENABLE_PERSISTENCE === 'true'
  },
  
  firebase: {
    gatewayUrl: process.env.FIREBASE_GATEWAY_URL || 'http://firebase-gateway:3000'
  },
  
  rfid: {
    frequency: parseInt(process.env.RFID_FREQUENCY) || 915250000,
    transmitPowerCdbm: parseInt(process.env.RFID_TRANSMIT_POWER_CDBM) || 3000
  },
  
  metrics: {
    enablePeriodicPublishing: process.env.ENABLE_PERIODIC_PUBLISHING === 'true',
    healthPublishInterval: parseInt(process.env.HEALTH_PUBLISH_INTERVAL) || 60000,
    metricsPublishInterval: parseInt(process.env.METRICS_PUBLISH_INTERVAL) || 300000,
    summaryPublishInterval: parseInt(process.env.SUMMARY_PUBLISH_INTERVAL) || 900000,
    retentionDays: parseInt(process.env.METRICS_RETENTION_DAYS) || 30
  },
  
  logging: {
    logUniqueTags: process.env.LOG_UNIQUE_TAGS === 'true',
    enableTimestamp: process.env.LOG_ENABLE_TIMESTAMP !== 'false', // Default to true
    enableColoredOutput: process.env.LOG_ENABLE_COLORED_OUTPUT !== 'false', // Default to true
    verbose: process.env.VERBOSE === 'true' // Default to false
  },
  
  config: {
    refreshInterval: parseInt(process.env.CONFIG_REFRESH_INTERVAL) || 5 * 60 * 1000 // 5 minutes default
  }
};

function validateConfig() {
  const required = [
    'LOCATIONNAME',
    'COMPANY_ID'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  console.log('Configuration validated successfully');
}

module.exports = { config, validateConfig }; 
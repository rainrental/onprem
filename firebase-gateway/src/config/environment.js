require('dotenv').config();

const config = {
  // Firebase Configuration
  firebase: {
    databaseURL: process.env.FIREBASE_DATABASEURL,
    // Client-side Firebase config for invitation-based auth
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,

    functionsUrl: process.env.FIREBASE_FUNCTIONS_URL || 
      (process.env.FIREBASE_PROJECT_ID ? 
        `https://europe-west2-${process.env.FIREBASE_PROJECT_ID}.cloudfunctions.net` : 
        null)
  },

  // Application Configuration
  app: {
    companyId: process.env.COMPANY_ID,
    locationName: process.env.LOCATIONNAME,
    isMobile: process.env.MOBILE === "1",
    tagTTLDays: parseInt(process.env.FIRESTORE_TAG_TTL_DURATION_DAYS) || 30
  },

  // Redis Configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB) || 0,
    maxQueueSize: parseInt(process.env.REDIS_MAX_QUEUE_SIZE) || 1000000,
    maxMemoryMB: parseInt(process.env.REDIS_MAX_MEMORY_MB) || 2048,
    enablePersistence: process.env.REDIS_ENABLE_PERSISTENCE !== 'false'
  },

  // Metrics Publishing Configuration
  metrics: {
    enabled: process.env.ENABLE_PERIODIC_PUBLISHING !== 'false',
    healthInterval: parseInt(process.env.HEALTH_PUBLISH_INTERVAL) || 60000,
    statsInterval: parseInt(process.env.METRICS_PUBLISH_INTERVAL) || 300000,
    summaryInterval: parseInt(process.env.SUMMARY_PUBLISH_INTERVAL) || 900000,
    retentionDays: parseInt(process.env.METRICS_RETENTION_DAYS) || 30
  },

  // MQTT Configuration
  mqtt: {
    host: process.env.MQTT_HOST,
    port: parseInt(process.env.MQTT_PORT) || 1883,
    keepAliveInterval: parseInt(process.env.MQTT_ALIVE_INTERVAL) || 60,
    topic: process.env.MQTT_TOPIC,
    logRaw: parseBoolean(process.env.MQTT_LOG_RAW),
    logUniqueTags: parseBoolean(process.env.LOG_UNIQUE_TAGS)
  },


  backend: {
    url: null
  },

  // Logging Configuration
  logging: {
    enableColoredOutput: true,
    enableTimestamp: true
  }
};

function parseBoolean(value) {
  if (typeof value === 'string') {
    return value.toLowerCase() === "true" || value === "1" || value.toLowerCase() === "yes";
  }
  return Boolean(value);
}

function validateConfig() {
  const required = [
    'firebase.databaseURL',
    'firebase.functionsUrl',
    'app.companyId',
    'app.locationName'
  ];

  const missing = required.filter(key => {
    const value = key.split('.').reduce((obj, k) => obj?.[k], config);
    return !value;
  });

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

module.exports = {
  config,
  validateConfig
}; 
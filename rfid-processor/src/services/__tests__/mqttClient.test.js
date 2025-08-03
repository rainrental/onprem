const mqttClient = require('../mqttClient');

// Mock dependencies
jest.mock('../locationState', () => ({
  getState: jest.fn(() => ({
    deduplicate: true,
    reporting: true
  }))
}));

jest.mock('../deduplicator', () => ({
  shouldReport: jest.fn(() => true)
}));

jest.mock('../redisRetryQueue', () => ({
  addToRfidQueue: jest.fn(() => true)
}));

jest.mock('../metricsCollector', () => ({
  recordTagEvent: jest.fn(),
  recordError: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  verbose: jest.fn(),
  error: jest.fn(),
  tag: jest.fn()
}));

describe('MqttClient - Tag Document Format', () => {
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = require('../../utils/logger');
  });

  describe('createTagDocument', () => {
    it('should create tag document with expected format', () => {
      const tagEvent = {
        tidHex: 'E28011002000725019730950',
        tidDecimal: '123456789',
        rssi: -71.8,
        antenna: 1,
        timestamp: '2025-08-01T00:17:41.312Z',
        hostname: 'HC720E250508197'
      };

      const topic = 'fixedevents';
      const document = mqttClient.createTagDocument(tagEvent, topic);

      // Verify expected format
      expect(document).toMatchObject({
        antennaName: '1',
        antennaPort: 1,
        epc: 'E28011002000725019730950',
        frequency: 915250000,

        host_timestamp: '2025-08-01T00:17:41.312Z',
        hostname: 'HC720E250508197',
        location: expect.any(String),
        peakRssiCdbm: -71.8,
        server_timestamp: {
          '__time__': expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
        },
        tid: 'E28011002000725019730950',
        tidHex: 'E28011002000725019730950',
        timestamp: '2025-08-01T00:17:41.312Z',
        topic: 'fixedevents',
        transmitPowerCdbm: 3000,
        ttl: {
          '__time__': expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
        }
      });

      // Verify no old fields
      expect(document).not.toHaveProperty('tidDecimal');
      expect(document).not.toHaveProperty('rssi');
      expect(document).not.toHaveProperty('antenna');
      expect(document).not.toHaveProperty('mobile');
    });

    it('should handle missing antenna value', () => {
      const tagEvent = {
        tidHex: 'E28011002000725019730950',
        rssi: -71.8,
        timestamp: '2025-08-01T00:17:41.312Z',
        hostname: 'HC720E250508197'
      };

      const topic = 'fixedevents';
      const document = mqttClient.createTagDocument(tagEvent, topic);

      expect(document.antennaName).toBe('1');
      expect(document.antennaPort).toBe(1);
    });

    it('should include location data when available', () => {
      const tagEvent = {
        tidHex: 'E28011002000725019730950',
        rssi: -71.8,
        antenna: 1,
        timestamp: '2025-08-01T00:17:41.312Z',
        hostname: 'HC720E250508197',
        lat: 51.5074,
        lon: -0.1278
      };

      const topic = 'fixedevents';
      const document = mqttClient.createTagDocument(tagEvent, topic);

      expect(document.lat).toBe(51.5074);
      expect(document.lon).toBe(-0.1278);
    });
  });
}); 
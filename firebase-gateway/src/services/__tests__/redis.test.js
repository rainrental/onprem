const redisService = require('../redis');

// Mock dependencies
jest.mock('../firebase', () => ({
  createTagRead: jest.fn(),
  createBatchTagReads: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn()
}));

// Mock Redis client
const mockRedisClient = {
  connect: jest.fn(),
  quit: jest.fn(),
  lPush: jest.fn(),
  rPop: jest.fn(),
  lLen: jest.fn(),
  setEx: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  on: jest.fn()
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient)
}));

describe('RedisService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the singleton instance
    redisService.client = null;
    redisService.isConnected = false;
    redisService.isProcessing = false;
    redisService.queueProcessorInterval = null;
    redisService.retryProcessorInterval = null;
  });

  describe('addToRetryQueue', () => {
    it('should add operation to retry queue', async () => {
      redisService.isConnected = true;
      mockRedisClient.lPush.mockResolvedValue(1);

      const operation = { type: 'createTagRead', data: { tagId: 'test' } };
      await redisService.addToRetryQueue(operation);

      expect(mockRedisClient.lPush).toHaveBeenCalledWith(
        'firebase:retry:queue',
        expect.stringContaining('"type":"createTagRead"')
      );
    });

    it('should throw error if not connected', async () => {
      redisService.isConnected = false;

      const operation = { type: 'createTagRead', data: { tagId: 'test' } };
      await expect(redisService.addToRetryQueue(operation)).rejects.toThrow('Redis not connected');
    });
  });

  describe('processRetryQueue', () => {
    it('should process retry queue item successfully', async () => {
      redisService.isConnected = true;
      const mockRetryItem = {
        operation: { type: 'createTagRead', data: { tagId: 'test' } },
        attempts: 1,
        maxAttempts: 5
      };
      mockRedisClient.rPop.mockResolvedValue(JSON.stringify(mockRetryItem));

      await redisService.processRetryQueue();

      expect(mockRedisClient.rPop).toHaveBeenCalledWith('firebase:retry:queue');
    });

    it('should not process when not connected', async () => {
      redisService.isConnected = false;

      await redisService.processRetryQueue();

      expect(mockRedisClient.rPop).not.toHaveBeenCalled();
    });

    it('should handle empty queue', async () => {
      redisService.isConnected = true;
      mockRedisClient.rPop.mockResolvedValue(null);

      await redisService.processRetryQueue();

      expect(mockRedisClient.rPop).toHaveBeenCalledWith('firebase:retry:queue');
    });
  });

  describe('retryOperation', () => {
    it('should retry createTagRead operation', async () => {
      const firebaseService = require('../firebase');
      firebaseService.createTagRead.mockResolvedValue({ id: 'test-id' });

      const retryItem = {
        operation: { type: 'createTagRead', data: { tagId: 'test' } },
        attempts: 1,
        maxAttempts: 5
      };

      await redisService.retryOperation(retryItem);

      expect(firebaseService.createTagRead).toHaveBeenCalledWith({ tagId: 'test' });
    });

    it('should handle retry failures', async () => {
      const firebaseService = require('../firebase');
      firebaseService.createTagRead.mockRejectedValue(new Error('Firestore error'));

      const retryItem = {
        operation: { type: 'createTagRead', data: { tagId: 'test' } },
        attempts: 1,
        maxAttempts: 5
      };

      await redisService.retryOperation(retryItem);

      expect(firebaseService.createTagRead).toHaveBeenCalledWith({ tagId: 'test' });
    });
  });

  describe('getRetryQueueLength', () => {
    it('should return retry queue length', async () => {
      redisService.isConnected = true;
      mockRedisClient.lLen.mockResolvedValue(5);

      const length = await redisService.getRetryQueueLength();

      expect(length).toBe(5);
      expect(mockRedisClient.lLen).toHaveBeenCalledWith('firebase:retry:queue');
    });

    it('should return 0 when not connected', async () => {
      redisService.isConnected = false;

      const length = await redisService.getRetryQueueLength();

      expect(length).toBe(0);
    });
  });

  describe('queue processors', () => {
    it('should start RFID queue processor', () => {
      redisService.startRfidQueueProcessor();

      expect(redisService.queueProcessorInterval).toBeDefined();
    });

    it('should start retry queue processor', () => {
      redisService.startRetryQueueProcessor();

      expect(redisService.retryProcessorInterval).toBeDefined();
    });

    it('should stop queue processors', () => {
      redisService.startRfidQueueProcessor();
      redisService.startRetryQueueProcessor();

      redisService.stopRfidQueueProcessor();
      redisService.stopRetryQueueProcessor();

      expect(redisService.queueProcessorInterval).toBeNull();
      expect(redisService.retryProcessorInterval).toBeNull();
    });
  });
}); 
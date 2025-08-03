const configManager = require('../configManager');

// Mock dependencies
jest.mock('../firebase', () => ({
  getDatabase: jest.fn(() => ({})),
  updateDocument: jest.fn()
}));

jest.mock('../authManager', () => ({
  isUserAuthenticated: jest.fn(() => true),
  getCompanyId: jest.fn(() => 'test-company'),
  getLocationName: jest.fn(() => 'test-location')
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn()
}));

// Mock Firebase Firestore
const mockOnSnapshot = jest.fn();
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(() => ({})),
  onSnapshot: mockOnSnapshot
}));

describe('ConfigManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the singleton instance
    configManager.isInitialized = false;
    configManager.unsubscribe = null;
    configManager.cachedConfig = null;
    configManager.lastUpdateTime = null;
    configManager.memoryUsage = {
      activeListeners: 0,
      estimatedMemoryKB: 0,
      cachedConfigs: 0,
      lastReported: null
    };
    configManager.reportInterval = null;
  });

  describe('initialize', () => {
    it('should initialize successfully with valid auth', async () => {
      await configManager.initialize();
      
      expect(configManager.isInitialized).toBe(true);
      expect(mockOnSnapshot).toHaveBeenCalled();
    });

    it('should throw error if not authenticated', async () => {
      const authManager = require('../authManager');
      authManager.isUserAuthenticated.mockReturnValue(false);

      await expect(configManager.initialize()).rejects.toThrow('Authentication required for config manager');
    });
  });

  describe('hasRelevantChanges', () => {
    it('should detect changes in deduplication settings', () => {
      const oldData = { deduplicate: false, deduplicate_interval: 2 };
      const newData = { deduplicate: true, deduplicate_interval: 2 };

      const result = configManager.hasRelevantChanges(oldData, newData);
      expect(result).toBe(true);
    });

    it('should detect changes in update settings', () => {
      const oldData = { update_strategy: 'latest', auto_update: false };
      const newData = { update_strategy: 'latest', auto_update: true };

      const result = configManager.hasRelevantChanges(oldData, newData);
      expect(result).toBe(true);
    });

    it('should detect changes in nested objects', () => {
      const oldData = { 
        update_window: { startHour: 2, endHour: 6 },
        safety_checks: { maxUpdatesPerDay: 3 }
      };
      const newData = { 
        update_window: { startHour: 3, endHour: 6 },
        safety_checks: { maxUpdatesPerDay: 3 }
      };

      const result = configManager.hasRelevantChanges(oldData, newData);
      expect(result).toBe(true);
    });

    it('should not detect changes in irrelevant fields', () => {
      const oldData = { 
        deduplicate: false, 
        irrelevant_field: 'old_value',
        update_strategy: 'latest'
      };
      const newData = { 
        deduplicate: false, 
        irrelevant_field: 'new_value',
        update_strategy: 'latest'
      };

      const result = configManager.hasRelevantChanges(oldData, newData);
      expect(result).toBe(false);
    });

    it('should return true for first load (no old data)', () => {
      const newData = { deduplicate: false, update_strategy: 'latest' };

      const result = configManager.hasRelevantChanges(null, newData);
      expect(result).toBe(true);
    });
  });

  describe('getChangedFields', () => {
    it('should return changed field names', () => {
      const oldData = { 
        deduplicate: false, 
        deduplicate_interval: 2,
        update_strategy: 'latest'
      };
      const newData = { 
        deduplicate: true, 
        deduplicate_interval: 2,
        update_strategy: 'latest'
      };

      const result = configManager.getChangedFields(oldData, newData);
      expect(result).toEqual(['deduplicate']);
    });

    it('should return initial_load for first load', () => {
      const newData = { deduplicate: false };

      const result = configManager.getChangedFields(null, newData);
      expect(result).toEqual(['initial_load']);
    });
  });

  describe('getMemoryUsage', () => {
    it('should return memory usage information', () => {
      configManager.memoryUsage = {
        activeListeners: 1,
        estimatedMemoryKB: 150,
        cachedConfigs: 1,
        lastReported: new Date()
      };
      configManager.lastUpdateTime = new Date();

      const result = configManager.getMemoryUsage();

      expect(result).toHaveProperty('activeListeners', 1);
      expect(result).toHaveProperty('estimatedMemoryKB', 150);
      expect(result).toHaveProperty('cachedConfigs', 1);
      expect(result).toHaveProperty('lastReported');
      expect(result).toHaveProperty('lastUpdateTime');
    });
  });

  describe('shutdown', () => {
    it('should cleanup resources properly', async () => {
      // Setup mock unsubscribe function
      const mockUnsubscribe = jest.fn();
      configManager.unsubscribe = mockUnsubscribe;
      configManager.reportInterval = setInterval(() => {}, 1000);

      await configManager.shutdown();

      expect(mockUnsubscribe).toHaveBeenCalled();
      expect(configManager.isInitialized).toBe(false);
      expect(configManager.cachedConfig).toBeNull();
      expect(configManager.lastUpdateTime).toBeNull();
    });
  });
}); 
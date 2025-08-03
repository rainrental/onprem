const logger = require('../logger');

// Mock console methods
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

describe('Logger', () => {
  let consoleOutput = [];

  beforeEach(() => {
    consoleOutput = [];
    console.log = jest.fn((...args) => {
      consoleOutput.push(args.join(' '));
    });
    console.error = jest.fn((...args) => {
      consoleOutput.push(args.join(' '));
    });
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('verbose logging', () => {
    it('should log verbose messages when VERBOSE is true', () => {
      // Mock config to enable verbose logging
      const originalConfig = require('../../config/environment').config;
      jest.doMock('../../config/environment', () => ({
        config: {
          ...originalConfig,
          logging: {
            ...originalConfig.logging,
            verbose: true
          }
        }
      }));

      // Re-require logger to get updated config
      jest.resetModules();
      const testLogger = require('../logger');

      testLogger.verbose('Test verbose message', { data: 'test' });

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('Test verbose message');
      expect(consoleOutput[0]).toContain('"data":"test"');
    });

    it('should not log verbose messages when VERBOSE is false', () => {
      // Mock config to disable verbose logging
      const originalConfig = require('../../config/environment').config;
      jest.doMock('../../config/environment', () => ({
        config: {
          ...originalConfig,
          logging: {
            ...originalConfig.logging,
            verbose: false
          }
        }
      }));

      // Re-require logger to get updated config
      jest.resetModules();
      const testLogger = require('../logger');

      testLogger.verbose('Test verbose message', { data: 'test' });

      expect(consoleOutput.length).toBe(0);
    });

    it('should not log verbose messages by default', () => {
      logger.verbose('Test verbose message', { data: 'test' });

      expect(consoleOutput.length).toBe(0);
    });
  });

  describe('other logging levels', () => {
    it('should log info messages regardless of verbose setting', () => {
      logger.info('Test info message', { data: 'test' });

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('Test info message');
    });

    it('should log error messages regardless of verbose setting', () => {
      logger.error('Test error message', new Error('test error'));

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('Test error message');
    });

    it('should log success messages regardless of verbose setting', () => {
      logger.success('Test success message', { data: 'test' });

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('Test success message');
    });
  });
}); 
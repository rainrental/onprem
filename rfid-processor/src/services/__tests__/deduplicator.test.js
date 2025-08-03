const Deduplicator = require('../deduplicator');

describe('Deduplicator', () => {
  let deduplicator;
  let reportCallback;
  let reportedEvents;

  beforeEach(() => {
    // Enable fake timers
    jest.useFakeTimers();
    
    // Mock the report callback to capture reported events
    reportedEvents = [];
    reportCallback = jest.fn((event, tagId, count) => {
      reportedEvents.push({ event, tagId, count, timestamp: Date.now() });
    });

    // Create deduplicator with 1-minute interval for testing
    deduplicator = new Deduplicator(1); // 1 minute interval
    deduplicator.setReportCallback(reportCallback);
  });

  afterEach(() => {
    deduplicator.cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Basic deduplication behavior', () => {
    it('should report first detection immediately', () => {
      const tagEvent = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: '2024-01-01T10:00:00.000Z'
      };
      const key = 'Reader1:ABC123';

      const shouldReport = deduplicator.shouldReport(
        new Date(tagEvent.timestamp),
        key,
        tagEvent,
        1
      );

      expect(shouldReport).toBe(true);
      // The callback should be called by the calling code, not the deduplicator itself
      // The deduplicator only returns true/false
    });

    it('should not report subsequent detections within interval', () => {
      const tagEvent1 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: '2024-01-01T10:00:00.000Z'
      };
      const tagEvent2 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: '2024-01-01T10:00:30.000Z' // 30 seconds later
      };
      const key = 'Reader1:ABC123';

      // First detection
      const shouldReport1 = deduplicator.shouldReport(
        new Date(tagEvent1.timestamp),
        key,
        tagEvent1,
        1
      );
      expect(shouldReport1).toBe(true);

      // Second detection within interval
      const shouldReport2 = deduplicator.shouldReport(
        new Date(tagEvent2.timestamp),
        key,
        tagEvent2,
        1
      );
      expect(shouldReport2).toBe(false);
    });

    it('should report cached event when interval expires', () => {
      const tagEvent1 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: '2024-01-01T10:00:00.000Z'
      };
      const tagEvent2 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: '2024-01-01T10:00:30.000Z'
      };
      const key = 'Reader1:ABC123';

      // First detection
      deduplicator.shouldReport(new Date(tagEvent1.timestamp), key, tagEvent1, 1);

      // Second detection (cached)
      deduplicator.shouldReport(new Date(tagEvent2.timestamp), key, tagEvent2, 1);

      // Fast-forward time to expire interval
      jest.advanceTimersByTime(60 * 1000); // 1 minute

      // Should have reported the cached event
      expect(reportCallback).toHaveBeenCalledWith(tagEvent2, 'ABC123', 1);
      expect(reportedEvents).toHaveLength(1);
      expect(reportedEvents[0].event).toEqual(tagEvent2); // Latest event
      expect(reportedEvents[0].count).toBe(1); // Always count as 1
    });
  });

  describe('Multiple detections within interval', () => {
    it('should only report latest event when interval expires', () => {
      const tagEvent1 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: '2024-01-01T10:00:00.000Z'
      };
      const tagEvent2 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: '2024-01-01T10:00:30.000Z'
      };
      const tagEvent3 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: '2024-01-01T10:00:45.000Z'
      };
      const key = 'Reader1:ABC123';

      // First detection
      deduplicator.shouldReport(new Date(tagEvent1.timestamp), key, tagEvent1, 1);

      // Second detection
      deduplicator.shouldReport(new Date(tagEvent2.timestamp), key, tagEvent2, 1);

      // Third detection
      deduplicator.shouldReport(new Date(tagEvent3.timestamp), key, tagEvent3, 1);

      // Fast-forward time to expire interval
      jest.advanceTimersByTime(60 * 1000);

      // Should have reported only the latest event
      expect(reportCallback).toHaveBeenCalledWith(tagEvent3, 'ABC123', 1);
      expect(reportedEvents).toHaveLength(1);
      expect(reportedEvents[0].event).toEqual(tagEvent3); // Latest event
      expect(reportedEvents[0].count).toBe(1);
    });
  });

  describe('Hostname grouping', () => {
    it('should use different keys for different hostnames', () => {
      const tagEvent1 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: '2024-01-01T10:00:00.000Z'
      };
      const tagEvent2 = {
        tidHex: 'ABC123',
        hostname: 'Reader2',
        timestamp: '2024-01-01T10:00:00.000Z'
      };

      const key1 = 'Reader1:ABC123';
      const key2 = 'Reader2:ABC123';

      // Both should report immediately (different keys)
      const shouldReport1 = deduplicator.shouldReport(
        new Date(tagEvent1.timestamp),
        key1,
        tagEvent1,
        1
      );
      const shouldReport2 = deduplicator.shouldReport(
        new Date(tagEvent2.timestamp),
        key2,
        tagEvent2,
        1
      );

      expect(shouldReport1).toBe(true);
      expect(shouldReport2).toBe(true);
    });

    it('should use same key for same hostname', () => {
      const tagEvent1 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: '2024-01-01T10:00:00.000Z'
      };
      const tagEvent2 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: '2024-01-01T10:00:30.000Z'
      };

      const key = 'Reader1:ABC123';

      // First should report, second should not
      const shouldReport1 = deduplicator.shouldReport(
        new Date(tagEvent1.timestamp),
        key,
        tagEvent1,
        1
      );
      const shouldReport2 = deduplicator.shouldReport(
        new Date(tagEvent2.timestamp),
        key,
        tagEvent2,
        1
      );

      expect(shouldReport1).toBe(true);
      expect(shouldReport2).toBe(false);
    });
  });

  describe('Interval expiration', () => {
    it('should allow new detection after interval expires', () => {
      const tagEvent1 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: '2024-01-01T10:00:00.000Z'
      };
      const tagEvent2 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: '2024-01-01T10:01:30.000Z' // After interval
      };
      const key = 'Reader1:ABC123';

      // First detection
      deduplicator.shouldReport(new Date(tagEvent1.timestamp), key, tagEvent1, 1);

      // Fast-forward past interval
      jest.advanceTimersByTime(60 * 1000);

      // Should have reported cached event
      expect(reportCallback).toHaveBeenCalledWith(tagEvent1, 'ABC123', 1);
      expect(reportedEvents).toHaveLength(1);

      // New detection after interval should report immediately
      const shouldReport = deduplicator.shouldReport(
        new Date(tagEvent2.timestamp),
        key,
        tagEvent2,
        1
      );

      expect(shouldReport).toBe(true);
    });
  });

  describe('Multiple intervals scenario', () => {
    it('should produce 2 events per interval for constantly read tag', () => {
      const key = 'Reader1:ABC123';

      // Simulate 3 intervals of constant reading
      for (let interval = 0; interval < 3; interval++) {
        const startTime = new Date(`2024-01-01T10:0${interval}:00.000Z`);
        
        // First detection of interval
        const firstEvent = {
          tidHex: 'ABC123',
          hostname: 'Reader1',
          timestamp: startTime.toISOString()
        };
        
        const shouldReport = deduplicator.shouldReport(startTime, key, firstEvent, 1);
        expect(shouldReport).toBe(true);

        // Simulate multiple detections within interval
        for (let i = 1; i <= 5; i++) {
          const subsequentEvent = {
            tidHex: 'ABC123',
            hostname: 'Reader1',
            timestamp: new Date(startTime.getTime() + i * 10000).toISOString() // 10s apart
          };
          
          const shouldReportSubsequent = deduplicator.shouldReport(
            new Date(subsequentEvent.timestamp),
            key,
            subsequentEvent,
            1
          );
          expect(shouldReportSubsequent).toBe(false);
        }

        // Advance to next interval
        jest.advanceTimersByTime(60 * 1000);
      }

      // Should have 3 total events (3 intervals × 1 cached event each)
      expect(reportedEvents).toHaveLength(3);
    });

    it('should produce exactly 2 events per minute with precise timing', () => {
      const key = 'Reader1:ABC123';
      const baseTime = new Date('2024-01-01T10:00:00.000Z');
      
      // Minute 1: 00:00-01:00
      // 00:00:01 - First detection (should report immediately)
      const event1 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: new Date(baseTime.getTime() + 1000).toISOString() // 00:00:01
      };
      
      const shouldReport1 = deduplicator.shouldReport(new Date(event1.timestamp), key, event1, 1);
      expect(shouldReport1).toBe(true);
      expect(reportedEvents).toHaveLength(0); // No callback called yet (handled by calling code)

      // 00:00:30 - Subsequent detection (should cache)
      const event2 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: new Date(baseTime.getTime() + 30000).toISOString() // 00:00:30
      };
      
      const shouldReport2 = deduplicator.shouldReport(new Date(event2.timestamp), key, event2, 1);
      expect(shouldReport2).toBe(false);

      // 00:00:59 - Last detection of minute (should cache and replace previous)
      const event3 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: new Date(baseTime.getTime() + 59000).toISOString() // 00:00:59
      };
      
      const shouldReport3 = deduplicator.shouldReport(new Date(event3.timestamp), key, event3, 1);
      expect(shouldReport3).toBe(false);

      // 00:01:00 - Timer fires (should report cached event)
      jest.advanceTimersByTime(60 * 1000);
      expect(reportCallback).toHaveBeenCalledWith(event3, 'ABC123', 1);
      expect(reportedEvents).toHaveLength(1);
      expect(reportedEvents[0].event).toEqual(event3); // Latest event from minute 1

      // Minute 2: 01:00-02:00
      // 01:00:01 - First detection of new minute (should report immediately)
      const event4 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: new Date(baseTime.getTime() + 60000 + 1000).toISOString() // 01:00:01
      };
      
      const shouldReport4 = deduplicator.shouldReport(new Date(event4.timestamp), key, event4, 1);
      expect(shouldReport4).toBe(true);

      // 01:00:59 - Last detection of minute (should cache)
      const event5 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: new Date(baseTime.getTime() + 60000 + 59000).toISOString() // 01:00:59
      };
      
      const shouldReport5 = deduplicator.shouldReport(new Date(event5.timestamp), key, event5, 1);
      expect(shouldReport5).toBe(false);

      // 01:01:00 - Timer fires (should report cached event)
      jest.advanceTimersByTime(60 * 1000);
      expect(reportCallback).toHaveBeenCalledWith(event5, 'ABC123', 1);
      expect(reportedEvents).toHaveLength(2);
      expect(reportedEvents[1].event).toEqual(event5); // Latest event from minute 2

      // Minute 3: 02:00-03:00
      // 02:00:01 - First detection of new minute (should report immediately)
      const event6 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: new Date(baseTime.getTime() + 120000 + 1000).toISOString() // 02:00:01
      };
      
      const shouldReport6 = deduplicator.shouldReport(new Date(event6.timestamp), key, event6, 1);
      expect(shouldReport6).toBe(true);

      // 02:00:59 - Last detection of minute (should cache)
      const event7 = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: new Date(baseTime.getTime() + 120000 + 59000).toISOString() // 02:00:59
      };
      
      const shouldReport7 = deduplicator.shouldReport(new Date(event7.timestamp), key, event7, 1);
      expect(shouldReport7).toBe(false);

      // 02:01:00 - Timer fires (should report cached event)
      jest.advanceTimersByTime(60 * 1000);
      expect(reportCallback).toHaveBeenCalledWith(event7, 'ABC123', 1);
      expect(reportedEvents).toHaveLength(3);
      expect(reportedEvents[2].event).toEqual(event7); // Latest event from minute 3

      // Summary: 3 minutes × 1 cached event per minute = 3 total cached events
      // (Plus 3 immediate events that would be handled by calling code)
    });
  });

  describe('Cleanup', () => {
    it('should clean up timers and cache on cleanup', () => {
      const tagEvent = {
        tidHex: 'ABC123',
        hostname: 'Reader1',
        timestamp: '2024-01-01T10:00:00.000Z'
      };
      const key = 'Reader1:ABC123';

      deduplicator.shouldReport(new Date(tagEvent.timestamp), key, tagEvent, 1);
      
      expect(deduplicator.cache.size).toBe(1);
      expect(deduplicator.timers.size).toBe(1);

      deduplicator.cleanup();

      expect(deduplicator.cache.size).toBe(0);
      expect(deduplicator.timers.size).toBe(0);
    });
  });
}); 
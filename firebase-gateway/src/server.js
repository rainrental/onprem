#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { validateConfig } = require('./config/environment');
const firebaseService = require('./services/firebase');
const redisService = require('./services/redis');
const authManager = require('./services/authManager');
const configManager = require('./services/configManager');

const logger = require('./utils/logger');

class FirebaseGatewayServer {
  constructor() {
    this.app = express();
    this.isShuttingDown = false;
    this.port = process.env.PORT || 3000;
  }

  async start() {
    try {
      // Validate configuration
      validateConfig();
      
      // Initialize authentication manager
      await authManager.initialize();
      
      // Authenticate with invitation code
      await this.authenticate();
      
      // Initialize Firebase (now with authenticated user)
      firebaseService.initialize();
      
      // Initialize Redis
      await redisService.initialize();
      
      // Start RFID queue processor
      redisService.startRfidQueueProcessor();
      
      // Start retry queue processor
      redisService.startRetryQueueProcessor();
      
      // Initialize config manager with snapshot listener
      await configManager.initialize();
      
      // Set up Express middleware
      this.setupMiddleware();
      
      // Set up routes
      this.setupRoutes();
      
      // Set up graceful shutdown
      this.setupGracefulShutdown();
      
      // Start the server
      this.app.listen(this.port, () => {
        logger.success(`Firebase Gateway started on port ${this.port}`);
      });
      
    } catch (error) {
      logger.error('Failed to start Firebase Gateway', error);
      process.exit(1);
    }
  }

  async authenticate() {
    const invitationCode = process.env.INVITATION_CODE;
    
    if (!invitationCode) {
      logger.error('INVITATION_CODE environment variable is required');
      process.exit(1);
    }
    
    try {
      logger.info(`Authenticating with invitation code: ${invitationCode}`);
      
      const result = await authManager.authenticateWithInvitation(invitationCode);
      
      if (result.success) {
        logger.success(`Authentication successful for location: ${result.locationName}`);
        return;
      } else {
        logger.error(`Authentication failed: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      logger.error(`Authentication error: ${error.message}`);
      process.exit(1);
    }
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(compression());
    
    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // limit each IP to 1000 requests per windowMs
      message: 'Too many requests from this IP'
    });
    this.app.use(limiter);
    
    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      logger.info('GET /health', { ip: req.ip });
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        firebase: authManager.isUserAuthenticated(),
        redis: redisService.isConnected,
        configManager: configManager.isInitialized
      });
    });

    // Redis queue status endpoint
    this.app.get('/api/redis/status', async (req, res) => {
      try {
        logger.info('GET /api/redis/status', { ip: req.ip });

        // Check authentication
        if (!authManager.isUserAuthenticated()) {
          return res.status(401).json({
            error: 'Firebase Gateway not authenticated'
          });
        }

        const retryQueueLength = await redisService.getRetryQueueLength();

        res.json({
          success: true,
          redis: {
            connected: redisService.isConnected,
            retryQueueLength,
            isProcessing: redisService.isProcessing
          }
        });

      } catch (error) {
        logger.error('Error getting Redis status', error);
        res.status(500).json({
          error: 'Internal server error',
          message: error.message
        });
      }
    });

    // Config manager status endpoint
    this.app.get('/api/config/status', (req, res) => {
      try {
        logger.info('GET /api/config/status', { ip: req.ip });

        // Check authentication
        if (!authManager.isUserAuthenticated()) {
          return res.status(401).json({
            error: 'Firebase Gateway not authenticated'
          });
        }

        const cachedConfig = configManager.getCachedConfig();
        const memoryUsage = configManager.getMemoryUsage();

        res.json({
          success: true,
          configManager: {
            initialized: configManager.isInitialized,
            hasCachedConfig: !!cachedConfig,
            lastUpdateTime: configManager.lastUpdateTime,
            memoryUsage
          },
          cachedConfig: cachedConfig ? {
            deduplicate: cachedConfig.deduplicate,
            updateStrategy: cachedConfig.update_strategy,
            autoUpdate: cachedConfig.auto_update,
            currentVersion: cachedConfig.current_version
          } : null
        });

      } catch (error) {
        logger.error('Error getting config status', error);
        res.status(500).json({
          error: 'Internal server error',
          message: error.message
        });
      }
    });

    // Location configuration endpoint (includes updates and deduplication)
    this.app.get('/api/config/location/:locationName', async (req, res) => {
      try {
        const { locationName } = req.params;
        const { companyId } = req.query;

        if (!companyId) {
          return res.status(400).json({
            error: 'Missing companyId query parameter'
          });
        }

        logger.info('GET /api/config/location/:locationName', { 
          locationName, 
          companyId,
          ip: req.ip 
        });

        // Check authentication
        if (!authManager.isUserAuthenticated()) {
          return res.status(401).json({
            error: 'Firebase Gateway not authenticated'
          });
        }

        // Try to get cached config first, fallback to Firestore
        let locationDoc = configManager.getCachedConfig();
        
        if (!locationDoc) {
          // Fallback to direct Firestore fetch
          const locationPath = `companies/${companyId}/locations/${locationName}`;
          locationDoc = await firebaseService.getDocument(locationPath);
          
          if (!locationDoc) {
            return res.status(404).json({
              error: 'Location not found',
              locationName,
              companyId
            });
          }
        }

        // Extract all configuration fields including updates
        const config = {
          // Deduplication settings
          deduplicate: locationDoc.deduplicate ?? false,
          deduplicateInterval: locationDoc.deduplicate_interval ?? 2,
          deduplicateMobile: locationDoc.deduplicate_mobile ?? false,
          deduplicateMobileInterval: locationDoc.deduplicate_mobile_interval ?? 2,
          
          // Reporting settings
          reporting: locationDoc.reporting ?? false,
          reportingMobile: locationDoc.reporting_mobile ?? false,
          
          // Update settings
          updateStrategy: locationDoc.update_strategy ?? 'latest',
          currentVersion: locationDoc.current_version ?? 'v1.02.03',
          autoUpdate: locationDoc.auto_update ?? false,
          checkInterval: locationDoc.check_interval ?? 3600000, // 1 hour
          
          // Update window settings (optional)
          updateWindow: locationDoc.update_window ?? {
            startHour: 2,
            endHour: 6
          },
          
          // Safety settings
          safetyChecks: locationDoc.safety_checks ?? {
            maxUpdatesPerDay: 3,
            requireHealthyServices: true,
            backupBeforeUpdate: true
          },
          
          lastUpdated: locationDoc.last_update || new Date().toISOString()
        };

        const isFromCache = !!configManager.getCachedConfig();
        logger.info('Location configuration retrieved', { 
          locationName, 
          companyId, 
          fromCache: isFromCache 
        });
        
        res.json({
          success: true,
          locationName,
          companyId,
          config,
          fromCache: isFromCache
        });

      } catch (error) {
        logger.error('Error getting location configuration', error);
        res.status(500).json({
          error: 'Internal server error',
          message: error.message
        });
      }
    });

    // Update status endpoint
    this.app.get('/api/config/updates/status', async (req, res) => {
      try {
        logger.info('GET /api/config/updates/status', { ip: req.ip });

        // Check authentication
        if (!authManager.isUserAuthenticated()) {
          return res.status(401).json({
            error: 'Firebase Gateway not authenticated'
          });
        }

        // Read local update status
        const fs = require('fs');
        const path = require('path');
        const statusFile = path.join(process.cwd(), 'data', 'update-status.json');
        
        let status = {
          lastChecked: null,
          currentVersion: 'unknown',
          updateAvailable: false,
          lastUpdate: null,
          updateInProgress: false
        };

        if (fs.existsSync(statusFile)) {
          try {
            status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
          } catch (error) {
            logger.warning('Failed to read update status file:', error.message);
          }
        }

        res.json({
          success: true,
          status
        });

      } catch (error) {
        logger.error('Error getting update status', error);
        res.status(500).json({
          error: 'Internal server error',
          message: error.message
        });
      }
    });

    // Update location configuration endpoint
    this.app.put('/api/config/location/:locationName', async (req, res) => {
      try {
        const { locationName } = req.params;
        const { companyId } = req.query;
        const updateData = req.body;

        if (!companyId) {
          return res.status(400).json({
            error: 'Missing companyId query parameter'
          });
        }

        logger.info('PUT /api/config/location/:locationName', { 
          locationName, 
          companyId,
          ip: req.ip 
        });

        // Check authentication
        if (!authManager.isUserAuthenticated()) {
          return res.status(401).json({
            error: 'Firebase Gateway not authenticated'
          });
        }

        // Get current location configuration
        const locationPath = `companies/${companyId}/locations/${locationName}`;
        const currentDoc = await firebaseService.getDocument(locationPath);
        
        if (!currentDoc) {
          return res.status(404).json({
            error: 'Location not found',
            locationName,
            companyId
          });
        }

        // Prepare update data with proper field names
        const updateFields = {
          // Deduplication settings
          deduplicate: updateData.deduplicate,
          deduplicate_interval: updateData.deduplicateInterval,
          deduplicate_mobile: updateData.deduplicateMobile,
          deduplicate_mobile_interval: updateData.deduplicateMobileInterval,
          
          // Reporting settings
          reporting: updateData.reporting,
          reporting_mobile: updateData.reportingMobile,
          
          // Update settings
          update_strategy: updateData.updateStrategy,
          current_version: updateData.currentVersion,
          auto_update: updateData.autoUpdate,
          check_interval: updateData.checkInterval,
          
          // Update window settings
          update_window: updateData.updateWindow,
          
          // Safety settings
          safety_checks: updateData.safetyChecks,
          
          last_update: new Date()
        };

        // Update the document
        await firebaseService.updateDocument(locationPath, updateFields);

        logger.info('Location configuration updated', { locationName, companyId });
        
        res.json({
          success: true,
          locationName,
          companyId,
          message: 'Configuration updated successfully'
        });

      } catch (error) {
        logger.error('Error updating location configuration', error);
        res.status(500).json({
          error: 'Internal server error',
          message: error.message
        });
      }
    });



    // Tag read operations
    this.app.post('/api/tag-reads', async (req, res) => {
      try {
        const { tagId, readerId, timestamp, locationName, companyId } = req.body;
        
        if (!tagId || !readerId) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await firebaseService.createTagRead({
          tagId,
          readerId,
          timestamp: timestamp || new Date(),
          locationName,
          companyId
        });

        res.json({ success: true, id: result.id });
      } catch (error) {
        logger.error('Failed to create tag read:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Batch tag reads
    this.app.post('/api/tag-reads/batch', async (req, res) => {
      try {
        const { reads } = req.body;
        
        if (!Array.isArray(reads) || reads.length === 0) {
          return res.status(400).json({ error: 'Invalid reads array' });
        }

        const results = await firebaseService.createBatchTagReads(reads);
        res.json({ success: true, count: results.length });
      } catch (error) {
        logger.error('Failed to create batch tag reads:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get tag reads
    this.app.get('/api/tag-reads', async (req, res) => {
      try {
        const { companyId, limit = 100, offset = 0 } = req.query;
        
        if (!companyId) {
          return res.status(400).json({ error: 'Company ID required' });
        }

        const reads = await firebaseService.getTagReads(companyId, parseInt(limit), parseInt(offset));
        res.json({ success: true, reads });
      } catch (error) {
        logger.error('Failed to get tag reads:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Error handling
    this.app.use((err, req, res, next) => {
      logger.error('Unhandled error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) return;
      
      this.isShuttingDown = true;
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      try {
              // Close Redis connection
      await redisService.shutdown();
      
      // Stop RFID queue processor
      redisService.stopRfidQueueProcessor();
      
      // Stop retry queue processor
      redisService.stopRetryQueueProcessor();
      
      // Shutdown config manager
      await configManager.shutdown();
      
      // Shutdown auth manager
      await authManager.shutdown();
        
        logger.info('Firebase Gateway shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
}

// Start the server
const server = new FirebaseGatewayServer();
server.start().catch(error => {
  logger.error('Failed to start server:', error);
  process.exit(1);
}); 
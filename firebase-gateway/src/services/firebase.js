const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, doc, getDoc, setDoc, serverTimestamp, Timestamp, onSnapshot } = require('firebase/firestore');
const { config } = require('../config/environment');
const logger = require('../utils/logger');
const redisService = require('./redis');
const authManager = require('./authManager');

class FirebaseService {
  constructor() {
    this.database = null;
    this.isInitialized = false;
  }

  initialize() {
    try {
      // Ensure we have an authenticated user
      if (!authManager.isUserAuthenticated()) {
        throw new Error('Authentication required. Please authenticate with invitation code first.');
      }
      
      // Get the Firestore instance from the authenticated auth manager
      this.database = authManager.firestore;
      this.isInitialized = true;
      
      logger.success('Firebase client SDK initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Firebase', error);
      throw error;
    }
  }

  getDatabase() {
    if (!this.isInitialized) {
      throw new Error('Firebase not initialized');
    }
    return this.database;
  }

  // Generic document creation (kept for backward compatibility)
  async createDocument(collectionPath, documentData) {
    try {
      const collectionRef = collection(this.database, collectionPath);
      
      // Calculate TTL (30 days from now)
      const ttl = new Date();
      ttl.setDate(ttl.getDate() + 30);
      
      const docRef = await addDoc(collectionRef, {
        ...documentData,
        server_timestamp: serverTimestamp(),
        ttl: ttl.toISOString(),
        createdAt: serverTimestamp()
      });
      
      logger.debug(`Document created: ${docRef.id} in ${collectionPath}`);
      return { id: docRef.id, ...documentData };
    } catch (error) {
      logger.error(`Failed to create document in ${collectionPath}:`, error);
      throw error;
    }
  }

  // Specific methods for different document types
  async createHealthMetrics(companyId, locationName, healthData) {
    try {
      const collectionPath = `companies/${companyId}/locations/${locationName}/metrics/health`;
      const docRef = await addDoc(collection(this.database, collectionPath), {
        ...healthData,
        createdAt: serverTimestamp()
      });
      
      logger.debug(`Health metrics created: ${docRef.id} for ${companyId}/${locationName}`);
      return { id: docRef.id, ...healthData };
    } catch (error) {
      logger.error(`Failed to create health metrics for ${companyId}/${locationName}:`, error);
      throw error;
    }
  }

  async createStatsMetrics(companyId, locationName, statsData) {
    try {
      const collectionPath = `companies/${companyId}/locations/${locationName}/metrics/stats`;
      const docRef = await addDoc(collection(this.database, collectionPath), {
        ...statsData,
        createdAt: serverTimestamp()
      });
      
      logger.debug(`Stats metrics created: ${docRef.id} for ${companyId}/${locationName}`);
      return { id: docRef.id, ...statsData };
    } catch (error) {
      logger.error(`Failed to create stats metrics for ${companyId}/${locationName}:`, error);
      throw error;
    }
  }

  async createSummaryMetrics(companyId, locationName, summaryData) {
    try {
      const collectionPath = `companies/${companyId}/locations/${locationName}/metrics/summary`;
      const docRef = await addDoc(collection(this.database, collectionPath), {
        ...summaryData,
        createdAt: serverTimestamp()
      });
      
      logger.debug(`Summary metrics created: ${docRef.id} for ${companyId}/${locationName}`);
      return { id: docRef.id, ...summaryData };
    } catch (error) {
      logger.error(`Failed to create summary metrics for ${companyId}/${locationName}:`, error);
      throw error;
    }
  }

  async createTagReadDocument(companyId, tagReadData) {
    try {
      const collectionPath = `companies/${companyId}/tagReads`;
      const docRef = await addDoc(collection(this.database, collectionPath), {
        ...tagReadData,
        createdAt: serverTimestamp()
      });
      
      logger.debug(`Tag read document created: ${docRef.id} for company ${companyId}`);
      return { id: docRef.id, ...tagReadData };
    } catch (error) {
      logger.error(`Failed to create tag read document for company ${companyId}:`, error);
      throw error;
    }
  }

  async createEventDocument(companyId, eventData) {
    try {
      const collectionPath = `companies/${companyId}/events`;
      const docRef = await addDoc(collection(this.database, collectionPath), {
        ...eventData,
        createdAt: serverTimestamp()
      });
      
      logger.debug(`Event document created: ${docRef.id} for company ${companyId}`);
      return { id: docRef.id, ...eventData };
    } catch (error) {
      logger.error(`Failed to create event document for company ${companyId}:`, error);
      throw error;
    }
  }

  // Update methods for current documents
  async updateCurrentHealth(companyId, locationName, healthData) {
    try {
      const documentPath = `companies/${companyId}/locations/${locationName}/current/health`;
      await setDoc(doc(this.database, documentPath), healthData, { merge: true });
      
      logger.debug(`Current health updated for ${companyId}/${locationName}`);
    } catch (error) {
      logger.error(`Failed to update current health for ${companyId}/${locationName}:`, error);
      throw error;
    }
  }

  async updateCurrentStats(companyId, locationName, statsData) {
    try {
      const documentPath = `companies/${companyId}/locations/${locationName}/current/stats`;
      await setDoc(doc(this.database, documentPath), statsData, { merge: true });
      
      logger.debug(`Current stats updated for ${companyId}/${locationName}`);
    } catch (error) {
      logger.error(`Failed to update current stats for ${companyId}/${locationName}:`, error);
      throw error;
    }
  }

  async updateCurrentSummary(companyId, locationName, summaryData) {
    try {
      const documentPath = `companies/${companyId}/locations/${locationName}/current/summary`;
      await setDoc(doc(this.database, documentPath), summaryData, { merge: true });
      
      logger.debug(`Current summary updated for ${companyId}/${locationName}`);
    } catch (error) {
      logger.error(`Failed to update current summary for ${companyId}/${locationName}:`, error);
      throw error;
    }
  }

  // Legacy methods (kept for backward compatibility)
  async createTagRead(tagReadData) {
    try {
      const { tagId, readerId, timestamp, locationName, companyId } = tagReadData;
      
      const tagRead = {
        tagId,
        readerId,
        timestamp: Timestamp.fromDate(new Date(timestamp)),
        locationName: locationName || config.location.name,
        companyId: companyId || config.company.id,
        createdAt: serverTimestamp()
      };

      const collectionRef = collection(this.database, 'tagReads');
      const docRef = await addDoc(collectionRef, tagRead);
      
      logger.debug(`Tag read created: ${docRef.id}`, { tagId, readerId });
      return { id: docRef.id, ...tagRead };
    } catch (error) {
      logger.error('Failed to create tag read:', error);
      
      // Add to retry queue
      await redisService.addToRetryQueue({
        type: 'createTagRead',
        data: tagReadData
      });
      
      throw error;
    }
  }

  async createBatchTagReads(tagReads) {
    try {
      const results = [];

      for (const tagReadData of tagReads) {
        const { tagId, readerId, timestamp, locationName, companyId } = tagReadData;
        
        const tagRead = {
          tagId,
          readerId,
          timestamp: Timestamp.fromDate(new Date(timestamp)),
          locationName: locationName || config.location.name,
          companyId: companyId || config.company.id,
          createdAt: serverTimestamp()
        };

        const collectionRef = collection(this.database, 'tagReads');
        const docRef = await addDoc(collectionRef, tagRead);
        results.push({ id: docRef.id, ...tagRead });
      }

      logger.debug(`Batch tag reads created: ${results.length} records`);
      return results;
    } catch (error) {
      logger.error('Failed to create batch tag reads:', error);
      
      // Add to retry queue
      await redisService.addToRetryQueue({
        type: 'createBatchTagReads',
        data: tagReads
      });
      
      throw error;
    }
  }

  async getTagReads(companyId, limit = 100, offset = 0) {
    try {
      const query = this.database.collection('tagReads')
        .where('companyId', '==', companyId)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .offset(offset);

      const snapshot = await query.get();
      
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      logger.error('Failed to get tag reads:', error);
      throw error;
    }
  }

  async updateDocument(documentPath, data, merge = true) {
    try {
      const docRef = doc(this.database, documentPath);
      await setDoc(docRef, data, { merge });
      
      logger.debug(`Document updated: ${documentPath}`);
    } catch (error) {
      logger.error(`Failed to update document: ${documentPath}`, error);
      throw error;
    }
  }

  async getDocument(documentPath) {
    try {
      if (!this.isInitialized) {
        throw new Error('Firebase not initialized');
      }

      const docRef = doc(this.database, documentPath);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return docSnap.data();
      } else {
        return null;
      }
    } catch (error) {
      logger.error('Failed to get document:', error);
      throw error;
    }
  }

  getServerTimestamp() {
    return serverTimestamp();
  }

  getDeleteField() {
    return null; // Not supported via client SDK
  }
}

module.exports = new FirebaseService(); 
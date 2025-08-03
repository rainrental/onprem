const { initializeApp } = require('firebase/app');
const { getAuth, signInWithCustomToken, onAuthStateChanged } = require('firebase/auth');
const { getFirestore } = require('firebase/firestore');
const config = require('../config/environment');
const logger = require('../utils/logger');

class AuthManager {
  constructor() {
    this.auth = null;
    this.firestore = null;
    this.refreshTimer = null;
    this.isAuthenticated = false;
    this.currentToken = null;
    this.functionsUrl = config.firebase.functionsUrl;
  }

  async initialize() {
    try {
      // Initialize Firebase with config
      const firebaseConfig = {
        apiKey: config.firebase.apiKey,
        authDomain: config.firebase.authDomain,
        projectId: config.firebase.projectId,
        storageBucket: config.firebase.storageBucket,
        messagingSenderId: config.firebase.messagingSenderId,
        appId: config.firebase.appId
      };

      const app = initializeApp(firebaseConfig);
      this.auth = getAuth(app);
      this.firestore = getFirestore(app);

      // Set up auth state listener
      onAuthStateChanged(this.auth, (user) => {
        if (user) {
          this.isAuthenticated = true;
          logger.info('Firebase authentication successful');
          this.scheduleTokenRefresh();
        } else {
          this.isAuthenticated = false;
          logger.warn('Firebase authentication lost');
          this.clearRefreshTimer();
        }
      });

      logger.info('Auth manager initialized');
      return true;
    } catch (error) {
      logger.error('Failed to initialize auth manager:', error);
      return false;
    }
  }

  async authenticateWithInvitation(invitationCode) {
    try {
      logger.info(`Validating invitation code: ${invitationCode}`);

      const response = await fetch(`${this.functionsUrl}/validateInvitation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          invitationCode: invitationCode
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Invitation validation failed');
      }

      const data = await response.json();
      
      if (!data.success || !data.customToken) {
        throw new Error('Invalid response from invitation validation');
      }

      // Sign in with custom token
      const userCredential = await signInWithCustomToken(this.auth, data.customToken);
      
      this.currentToken = data.customToken;
      this.locationName = data.locationName;
      this.companyId = data.companyId;

      logger.success(`Authentication successful for location: ${data.locationName}`);
      
      // Schedule token refresh (45 minutes to be safe)
      this.scheduleTokenRefresh();

      return {
        success: true,
        locationName: data.locationName,
        companyId: data.companyId,
        expiresIn: data.expiresIn
      };

    } catch (error) {
      logger.error('Authentication failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async refreshToken() {
    try {
      if (!this.auth.currentUser) {
        throw new Error('No authenticated user');
      }

      // Get current ID token
      const idToken = await this.auth.currentUser.getIdToken();
      
      logger.info('Refreshing Firebase custom token');

      const response = await fetch(`${this.functionsUrl}/refreshToken`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Token refresh failed');
      }

      const data = await response.json();
      
      if (!data.success || !data.customToken) {
        throw new Error('Invalid response from token refresh');
      }

      // Sign in with new custom token
      await signInWithCustomToken(this.auth, data.customToken);
      
      this.currentToken = data.customToken;

      logger.success('Token refreshed successfully');
      
      // Schedule next refresh
      this.scheduleTokenRefresh();

      return {
        success: true,
        expiresIn: data.expiresIn
      };

    } catch (error) {
      logger.error('Token refresh failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  scheduleTokenRefresh() {
    // Clear existing timer
    this.clearRefreshTimer();
    
    // Schedule refresh in 45 minutes (before 60-minute expiry)
    const refreshDelay = 45 * 60 * 1000; // 45 minutes in milliseconds
    
    this.refreshTimer = setTimeout(async () => {
      logger.info('Scheduled token refresh triggered');
      await this.refreshToken();
    }, refreshDelay);

    logger.info(`Token refresh scheduled in ${refreshDelay / 60000} minutes`);
  }

  clearRefreshTimer() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async getIdToken() {
    try {
      if (!this.auth.currentUser) {
        throw new Error('No authenticated user');
      }
      
      return await this.auth.currentUser.getIdToken();
    } catch (error) {
      logger.error('Failed to get ID token:', error.message);
      throw error;
    }
  }

  isUserAuthenticated() {
    return this.isAuthenticated && this.auth.currentUser !== null;
  }

  getCurrentUser() {
    return this.auth.currentUser;
  }

  getLocationName() {
    return this.locationName;
  }

  getCompanyId() {
    return this.companyId;
  }

  async signOut() {
    try {
      await this.auth.signOut();
      this.clearRefreshTimer();
      this.isAuthenticated = false;
      this.currentToken = null;
      this.locationName = null;
      this.companyId = null;
      logger.info('User signed out successfully');
    } catch (error) {
      logger.error('Sign out failed:', error.message);
    }
  }

  async shutdown() {
    this.clearRefreshTimer();
    if (this.auth.currentUser) {
      await this.signOut();
    }
    logger.info('Auth manager shutdown complete');
  }
}

module.exports = new AuthManager(); 
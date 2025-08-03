const { initializeApp } = require('firebase/app');
const { getAuth, signInWithCustomToken, onAuthStateChanged } = require('firebase/auth');
const { getFirestore } = require('firebase/firestore');
const { config } = require('../config/environment');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

class AuthManager {
  constructor() {
    this.auth = null;
    this.firestore = null;
    this.refreshTimer = null;
    this.isAuthenticated = false;
    this.currentToken = null;
    this.locationName = null;
    this.companyId = null;
    
    // Token storage file - use persistent volume
    this.tokenFile = path.join(process.cwd(), 'data', '.auth-token.json');
    
    // Get functions URL with fallback
    this.functionsUrl = config.firebase.functionsUrl;
    
    if (!this.functionsUrl) {
      logger.error('Firebase Functions URL is not configured. Please set FIREBASE_FUNCTIONS_URL or FIREBASE_PROJECT_ID environment variable.');
      throw new Error('Firebase Functions URL is required. Please set FIREBASE_FUNCTIONS_URL or FIREBASE_PROJECT_ID environment variable.');
    }
    
    logger.info(`Using Firebase Functions URL: ${this.functionsUrl}`);
  }

  saveAuthState() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.tokenFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      const authState = {
        token: this.currentToken,
        locationName: this.locationName,
        companyId: this.companyId,
        timestamp: Date.now()
      };
      
      fs.writeFileSync(this.tokenFile, JSON.stringify(authState, null, 2));
      logger.debug('Authentication state saved');
    } catch (error) {
      logger.warning('Failed to save authentication state:', error.message);
    }
  }

  loadAuthState() {
    try {
      if (fs.existsSync(this.tokenFile)) {
        const authState = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8'));
        
        // Check if token is not too old (7 days - extended for longer persistence)
        const tokenAge = Date.now() - authState.timestamp;
        if (tokenAge < 7 * 24 * 60 * 60 * 1000) {
          this.currentToken = authState.token;
          this.locationName = authState.locationName;
          this.companyId = authState.companyId;
          logger.info('Loaded existing authentication state');
          return true;
        } else {
          logger.info('Stored authentication state is too old, will re-authenticate');
          this.clearAuthState();
        }
      }
    } catch (error) {
      logger.warning('Failed to load authentication state:', error.message);
      this.clearAuthState();
    }
    return false;
  }

  clearAuthState() {
    try {
      if (fs.existsSync(this.tokenFile)) {
        fs.unlinkSync(this.tokenFile);
      }
      this.currentToken = null;
      this.locationName = null;
      this.companyId = null;
    } catch (error) {
      logger.warning('Failed to clear authentication state:', error.message);
    }
  }

  async initialize() {
    try {
      // Load existing authentication state
      this.loadAuthState();
      
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
          logger.warning('Firebase authentication lost');
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
      // Check if already authenticated with Firebase
      if (this.auth.currentUser) {
        logger.info('Already authenticated with Firebase, skipping invitation validation');
        return {
          success: true,
          locationName: this.getLocationName(),
          companyId: this.getCompanyId()
        };
      }

      // Check if we have a stored token and try to use it
      if (this.currentToken) {
        try {
          logger.info('Attempting to use stored custom token');
          
          // Sign in with stored custom token
          await signInWithCustomToken(this.auth, this.currentToken);
          
          // Now try to refresh the token
          const refreshResult = await this.refreshToken();
          if (refreshResult.success) {
            logger.info('Successfully refreshed existing token');
            return {
              success: true,
              locationName: this.getLocationName(),
              companyId: this.getCompanyId()
            };
          }
        } catch (error) {
          logger.warning('Failed to use stored token, will validate new invitation');
        }
      }

      // Clean the invitation code (remove hyphens and convert to uppercase)
      const cleanCode = invitationCode.replace(/-/g, '').toUpperCase();
      
      logger.info(`Validating invitation code: ${cleanCode}`);

      const response = await fetch(`${this.functionsUrl}/validateInvitation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          invitationCode: cleanCode
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
      
      // Save authentication state
      this.saveAuthState();
      
      // Schedule token refresh (45 minutes to be safe)
      this.scheduleTokenRefresh();

      return {
        success: true,
        locationName: data.locationName,
        companyId: data.companyId
      };

    } catch (error) {
      logger.error('Authentication failed:', error.message);
      // Clear any stored auth state on failure
      this.clearAuthState();
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
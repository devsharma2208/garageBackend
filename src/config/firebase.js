const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const env = require('./env');

let firebaseApp = null;
let isInitialized = false;

function initFirebase() {
  if (isInitialized && firebaseApp) {
    return firebaseApp;
  }

  try {
    // 1. JSON string in env var
    if (env.firebase?.serviceAccountJson) {
      const serviceAccount = JSON.parse(env.firebase.serviceAccountJson);
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      isInitialized = true;
      logger.info('Firebase Admin initialized from FIREBASE_SERVICE_ACCOUNT JSON env variable');
      return firebaseApp;
    }

    // 2. File path in env var
    const keyPath = env.firebase?.serviceAccountKeyPath;
    if (keyPath) {
      const resolvedPath = path.isAbsolute(keyPath)
        ? keyPath
        : path.resolve(process.cwd(), keyPath);

      if (fs.existsSync(resolvedPath)) {
        const fileContent = fs.readFileSync(resolvedPath, 'utf8');
        const serviceAccount = JSON.parse(fileContent);
        firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        isInitialized = true;
        logger.info(`Firebase Admin initialized from file: ${resolvedPath}`);
        return firebaseApp;
      } else {
        logger.warn(`Firebase service account file not found at: ${resolvedPath}`);
      }
    }

    // 3. Individual env vars
    if (
      env.firebase?.projectId &&
      env.firebase?.clientEmail &&
      env.firebase?.privateKey
    ) {
      const privateKey = env.firebase.privateKey.replace(/\\n/g, '\n');
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: env.firebase.projectId,
          clientEmail: env.firebase.clientEmail,
          privateKey,
        }),
      });
      isInitialized = true;
      logger.info('Firebase Admin initialized from individual env credentials');
      return firebaseApp;
    }

    // 4. Default root firebase-service-account.json if present
    const defaultLocalKey = path.resolve(process.cwd(), 'firebase-service-account.json');
    if (fs.existsSync(defaultLocalKey)) {
      const fileContent = fs.readFileSync(defaultLocalKey, 'utf8');
      const serviceAccount = JSON.parse(fileContent);
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      isInitialized = true;
      logger.info('Firebase Admin initialized from default ./firebase-service-account.json');
      return firebaseApp;
    }

    logger.warn(
      'Firebase Admin not initialized: Credentials not provided. Push notifications will run in dry-run/mock mode.'
    );
    return null;
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin:', error.message);
    return null;
  }
}

// Ensure FCM data payload values are strictly strings
function sanitizeFCMData(data = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      continue;
    }
    sanitized[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return sanitized;
}

/**
 * Send push notification to multiple device tokens via FCM
 * @param {string[]} tokens - Array of FCM registration tokens
 * @param {object} payload - { title, body, data, imageUrl }
 * @returns {Promise<{ successCount: number, failureCount: number, invalidTokens: string[] }>}
 */
async function sendMulticast(tokens, { title, body, data = {}, imageUrl = null }) {
  if (!tokens || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  // Deduplicate and filter non-empty tokens
  const uniqueTokens = [...new Set(tokens.filter((t) => typeof t === 'string' && t.trim().length > 0))];
  if (uniqueTokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  if (!isInitialized) {
    logger.info(
      `[FCM Mock Mode] Would send push to ${uniqueTokens.length} token(s): "${title}" - "${body}"`
    );
    return {
      successCount: uniqueTokens.length,
      failureCount: 0,
      invalidTokens: [],
      mock: true,
    };
  }

  const sanitizedData = sanitizeFCMData(data);

  const message = {
    tokens: uniqueTokens,
    notification: {
      title,
      body,
      ...(imageUrl ? { imageUrl } : {}),
    },
    data: sanitizedData,
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'garage_sales_alerts',
        ...(imageUrl ? { imageUrl } : {}),
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
        },
      },
    },
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    const invalidTokens = [];

    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const errorCode = resp.error?.code;
        // Identify dead/unregistered tokens
        if (
          errorCode === 'messaging/registration-token-not-registered' ||
          errorCode === 'messaging/invalid-registration-token' ||
          errorCode === 'messaging/invalid-argument'
        ) {
          invalidTokens.push(uniqueTokens[idx]);
        }
        logger.warn(`FCM send failure for token ${uniqueTokens[idx]?.slice(0, 10)}...: ${resp.error?.message}`);
      }
    });

    logger.info(
      `FCM multicast sent: ${response.successCount} success, ${response.failureCount} failed out of ${uniqueTokens.length}`
    );

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokens,
    };
  } catch (err) {
    logger.error('FCM sendEachForMulticast error:', err.message);
    return {
      successCount: 0,
      failureCount: uniqueTokens.length,
      invalidTokens: [],
      error: err.message,
    };
  }
}

/**
 * Send push notification to a topic (e.g. 'all_users' or 'announcements')
 */
async function sendToTopic(topic, { title, body, data = {}, imageUrl = null }) {
  if (!isInitialized) {
    logger.info(`[FCM Mock Mode] Would send topic push to "${topic}": "${title}" - "${body}"`);
    return { messageId: 'mock-topic-msg-id', mock: true };
  }

  const message = {
    topic,
    notification: {
      title,
      body,
      ...(imageUrl ? { imageUrl } : {}),
    },
    data: sanitizeFCMData(data),
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'garage_sales_alerts',
        ...(imageUrl ? { imageUrl } : {}),
      },
    },
  };

  try {
    const messageId = await admin.messaging().send(message);
    logger.info(`FCM topic message sent to "${topic}": ${messageId}`);
    return { messageId };
  } catch (err) {
    logger.error(`FCM sendToTopic "${topic}" error:`, err.message);
    throw err;
  }
}

// Initialise on load
initFirebase();

module.exports = {
  admin,
  initFirebase,
  isFirebaseReady: () => isInitialized,
  sendMulticast,
  sendToTopic,
};

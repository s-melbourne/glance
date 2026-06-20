'use strict';

const admin = require('firebase-admin');

let adminReady = false;
let adminInitError = null;

function parseServiceAccount(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is empty.');
  }

  const trimmed = raw.trim().replace(/^\uFEFF/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    // Azure portal pastes sometimes break escaping — try compacting whitespace outside strings.
    const compact = trimmed.replace(/\r\n/g, '\n');
    return JSON.parse(compact);
  }
}

function initFirebaseAdmin() {
  if (adminReady) return;
  if (adminInitError) throw adminInitError;

  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const projectId = process.env.FIREBASE_PROJECT_ID;

    if (serviceAccountJson) {
      const serviceAccount = parseServiceAccount(serviceAccountJson);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: projectId || serviceAccount.project_id,
      });
    } else if (projectId) {
      admin.initializeApp({ projectId });
    } else {
      throw new Error('FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT_JSON is not set.');
    }

    adminReady = true;
  } catch (err) {
    adminInitError = err;
    throw err;
  }
}

function getBearerToken(request) {
  // SWA managed APIs replace Authorization with an internal proxy token (see
  // https://github.com/Azure/static-web-apps/issues/34). Read our custom header first.
  const headerNames = ['x-firebase-token', 'X-Firebase-Token', 'authorization', 'Authorization'];
  for (const name of headerNames) {
    const header = request.headers.get(name);
    if (!header) continue;
    if (header.startsWith('Bearer ')) return header.slice(7).trim();
    return header.trim();
  }
  return null;
}

function getAllowedEmails() {
  const raw = process.env.GLANCE_ALLOWED_EMAILS || '';
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

function jsonResponse(status, body) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function requireAuth(request) {
  if (process.env.GLANCE_AUTH_DISABLED === 'true') {
    return {
      principal: {
        userId: 'local-dev',
        userDetails: 'dev@local',
        identityProvider: 'local',
      },
    };
  }

  const token = getBearerToken(request);
  if (!token) {
    return { error: jsonResponse(401, { error: 'Authentication required.', code: 'missing_token' }) };
  }

  try {
    initFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(token);
    const email = (decoded.email || '').toLowerCase();

    const allowed = getAllowedEmails();
    if (allowed.length > 0 && !allowed.includes(email)) {
      return {
        error: jsonResponse(403, {
          error: 'Your account is not authorized for this family dashboard.',
          code: 'not_allowlisted',
        }),
      };
    }

    return {
      principal: {
        userId: decoded.uid,
        userDetails: decoded.email || decoded.uid,
        identityProvider: decoded.firebase?.sign_in_provider || 'firebase',
      },
    };
  } catch (err) {
    if (!adminReady && adminInitError) {
      return {
        error: jsonResponse(503, {
          error: 'Authentication service is misconfigured.',
          code: 'auth_config_error',
        }),
      };
    }
    return {
      error: jsonResponse(401, {
        error: 'Invalid or expired sign-in token.',
        code: 'invalid_token',
      }),
    };
  }
}

module.exports = { requireAuth };

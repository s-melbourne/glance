'use strict';

const admin = require('firebase-admin');

let adminReady = false;

function initFirebaseAdmin() {
  if (adminReady) return;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (serviceAccountJson) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
      projectId: projectId || undefined,
    });
  } else if (projectId) {
    admin.initializeApp({ projectId });
  } else {
    throw new Error('FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT_JSON is not set.');
  }

  adminReady = true;
}

function getBearerToken(request) {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
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
    return { error: jsonResponse(401, { error: 'Authentication required.' }) };
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
  } catch {
    return { error: jsonResponse(401, { error: 'Invalid or expired sign-in token.' }) };
  }
}

module.exports = { requireAuth };

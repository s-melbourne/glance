// ─── Glance API — Firebase init.json for self-hosted auth helpers ─────────────
// Route: GET /api/firebase-init  (rewritten from /__/firebase/init.json)

'use strict';

const { app } = require('@azure/functions');
const { getPublicAuthDomain } = require('../shared/firebase-public');

app.http('firebase-init', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'firebase-init',
  handler: async () => {
    const apiKey = process.env.FIREBASE_API_KEY;
    const authDomain = getPublicAuthDomain();
    const projectId = process.env.FIREBASE_PROJECT_ID;

    if (!apiKey || !authDomain || !projectId) {
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Firebase authentication is not configured.' }),
      };
    }

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
      body: JSON.stringify({ apiKey, authDomain, projectId }),
    };
  },
});

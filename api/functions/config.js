// ─── Glance API — Public client config ───────────────────────────────────────
// Route: GET /api/config
//
// Returns non-secret Firebase web SDK settings for the browser.
// Auth-protected routes verify Firebase ID tokens separately.

'use strict';

const { app } = require('@azure/functions');

app.http('config', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'config',
  handler: async () => {
    const apiKey = process.env.FIREBASE_API_KEY;
    const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const appId = process.env.FIREBASE_APP_ID;

    if (!apiKey || !authDomain || !projectId) {
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Firebase authentication is not configured.',
          firebase: null,
        }),
      };
    }

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
      body: JSON.stringify({
        firebase: {
          apiKey,
          authDomain,
          projectId,
          appId: appId || undefined,
        },
      }),
    };
  },
});

'use strict';

function getPublicAuthDomain() {
  const configured = (process.env.FIREBASE_AUTH_DOMAIN || '').trim();
  const publicHost = (process.env.GLANCE_PUBLIC_HOST || 'nice-ground-08e391700.7.azurestaticapps.net').trim();
  if (!configured || configured.endsWith('.firebaseapp.com') || configured.endsWith('.web.app')) {
    return publicHost;
  }
  return configured;
}

module.exports = { getPublicAuthDomain };

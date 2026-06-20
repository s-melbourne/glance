'use strict';

function parsePrincipal(request) {
  const encoded = request.headers.get('x-ms-client-principal');
  if (!encoded) return null;

  try {
    const json = Buffer.from(encoded, 'base64').toString('ascii');
    return JSON.parse(json);
  } catch {
    return null;
  }
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

function requireAuth(request) {
  if (process.env.GLANCE_AUTH_DISABLED === 'true') {
    return {
      principal: {
        userId: 'local-dev',
        userDetails: 'dev@local',
        identityProvider: 'local',
      },
    };
  }

  const principal = parsePrincipal(request);
  if (!principal?.userId) {
    return { error: jsonResponse(401, { error: 'Authentication required.' }) };
  }

  const allowed = getAllowedEmails();
  if (allowed.length > 0) {
    const email = (principal.userDetails || '').toLowerCase();
    if (!allowed.includes(email)) {
      return {
        error: jsonResponse(403, {
          error: 'Your account is not authorized for this family dashboard.',
        }),
      };
    }
  }

  return { principal };
}

module.exports = { requireAuth, parsePrincipal };

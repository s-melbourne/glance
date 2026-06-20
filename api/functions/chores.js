// ─── Glance API — Chores ──────────────────────────────────────────────────────
// Azure Functions v4 programming model.
// Routes:
//   GET  /api/chores?userId={id}        — list chores for a user (or all)
//   POST /api/chores                    — create a new chore
//   PUT  /api/chores/{id}               — toggle completion or update a chore
//
// Cosmos DB: GlanceDB → Chores container, partition key: /assignedUser

'use strict';

const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');
const { requireAuth } = require('../shared/auth');

// ─── Cosmos client (singleton re-used across warm invocations) ────────────────
let _container = null;

function getContainer() {
  if (_container) return _container;

  const connectionString = process.env.COSMOS_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('COSMOS_CONNECTION_STRING environment variable is not set.');
  }

  const client = new CosmosClient(connectionString);
  _container = client.database('GlanceDB').container('Chores');
  return _container;
}

// ─── Validation constants ─────────────────────────────────────────────────────
const VALID_USERS = new Set(['anna', 'simeon', 'tennille', 'bibi']);
const VALID_RECURRENCE = new Set(['daily', 'weekly', 'once']);
const VALID_DAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
const MAX_TITLE_LENGTH = 120;

// ─── Input validation helpers ─────────────────────────────────────────────────
function validateUserId(userId) {
  return typeof userId === 'string' && VALID_USERS.has(userId.toLowerCase());
}

function validateChorePayload(body) {
  const errors = [];

  if (!body.assignedUser || !VALID_USERS.has(body.assignedUser)) {
    errors.push('assignedUser must be one of: anna, simeon, tennille, bibi');
  }

  if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
    errors.push('title is required');
  } else if (body.title.length > MAX_TITLE_LENGTH) {
    errors.push(`title must be ${MAX_TITLE_LENGTH} characters or fewer`);
  }

  if (!body.recurrence || !VALID_RECURRENCE.has(body.recurrence)) {
    errors.push('recurrence must be one of: daily, weekly, once');
  }

  if (body.daysOfWeek !== undefined) {
    if (!Array.isArray(body.daysOfWeek)) {
      errors.push('daysOfWeek must be an array');
    } else if (body.daysOfWeek.some(d => !VALID_DAYS.has(d))) {
      errors.push('daysOfWeek contains invalid day names');
    }
  }

  return errors;
}

// ─── GET /api/chores ──────────────────────────────────────────────────────────
app.http('choresGet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'chores',
  handler: async (request, context) => {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const userId = request.query.get('userId');

    let querySpec;
    if (userId) {
      if (!validateUserId(userId)) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Invalid userId.' }),
        };
      }
      querySpec = {
        query: 'SELECT * FROM c WHERE c.assignedUser = @userId AND c.isActive = true',
        parameters: [{ name: '@userId', value: userId.toLowerCase() }],
      };
    } else {
      querySpec = {
        query: 'SELECT * FROM c WHERE c.isActive = true',
      };
    }

    try {
      const container = getContainer();
      const { resources } = await container.items.query(querySpec).fetchAll();
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chores: resources }),
      };
    } catch (err) {
      context.error('Chores GET error:', err.message);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to retrieve chores.' }),
      };
    }
  },
});

// ─── POST /api/chores ─────────────────────────────────────────────────────────
app.http('choresPost', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'chores',
  handler: async (request, context) => {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    let body;
    try {
      body = await request.json();
    } catch {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Request body must be valid JSON.' }),
      };
    }

    const errors = validateChorePayload(body);
    if (errors.length > 0) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Validation failed.', details: errors }),
      };
    }

    const now = new Date().toISOString();
    const chore = {
      id: `chore-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      assignedUser: body.assignedUser.toLowerCase(),
      title: body.title.trim(),
      description: typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '',
      recurrence: body.recurrence,
      daysOfWeek: Array.isArray(body.daysOfWeek) ? body.daysOfWeek.filter(d => VALID_DAYS.has(d)) : [],
      completedDates: [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const container = getContainer();
      const { resource } = await container.items.create(chore);
      return {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chore: resource }),
      };
    } catch (err) {
      context.error('Chores POST error:', err.message);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to create chore.' }),
      };
    }
  },
});

// ─── PUT /api/chores/{id} ─────────────────────────────────────────────────────
app.http('choresPut', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'chores/{id}',
  handler: async (request, context) => {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const choreId = request.params.id;

    if (!choreId || !/^[\w-]+$/.test(choreId)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid chore id.' }),
      };
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Request body must be valid JSON.' }),
      };
    }

    // assignedUser is required in body to locate the partition
    if (!body.assignedUser || !validateUserId(body.assignedUser)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'assignedUser is required for updates.' }),
      };
    }

    try {
      const container = getContainer();
      const partitionKey = body.assignedUser.toLowerCase();
      const { resource: existing } = await container.item(choreId, partitionKey).read();

      if (!existing) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Chore not found.' }),
        };
      }

      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

      // Toggle completion for today
      let completedDates = [...(existing.completedDates || [])];
      if (body.action === 'toggle') {
        if (completedDates.includes(today)) {
          completedDates = completedDates.filter(d => d !== today);
        } else {
          completedDates.push(today);
        }
      }

      // Merge allowed mutable fields — never trust client-supplied id or partitionKey
      const updated = {
        ...existing,
        title: typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE_LENGTH) : existing.title,
        description: typeof body.description === 'string' ? body.description.trim().slice(0, 500) : existing.description,
        recurrence: VALID_RECURRENCE.has(body.recurrence) ? body.recurrence : existing.recurrence,
        daysOfWeek: Array.isArray(body.daysOfWeek) ? body.daysOfWeek.filter(d => VALID_DAYS.has(d)) : existing.daysOfWeek,
        isActive: typeof body.isActive === 'boolean' ? body.isActive : existing.isActive,
        completedDates,
        updatedAt: new Date().toISOString(),
      };

      const { resource } = await container.item(choreId, partitionKey).replace(updated);
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chore: resource }),
      };
    } catch (err) {
      if (err.code === 404) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Chore not found.' }),
        };
      }
      context.error('Chores PUT error:', err.message);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to update chore.' }),
      };
    }
  },
});

// ─── Glance API — Lists ───────────────────────────────────────────────────────
// Azure Functions v4 programming model.
// Routes:
//   GET    /api/lists?listType={type}   — fetch all items for a list type
//   POST   /api/lists                   — add a new item to a list
//   DELETE /api/lists/{id}              — remove an item (requires listType query param)
//
// Cosmos DB: GlanceDB → Lists container, partition key: /listType
// TTL: 30 days on all documents (configured at container level in Cosmos).

'use strict';

const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');

// ─── Cosmos client (singleton) ────────────────────────────────────────────────
let _container = null;

function getContainer() {
  if (_container) return _container;

  const connectionString = process.env.COSMOS_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('COSMOS_CONNECTION_STRING environment variable is not set.');
  }

  const client = new CosmosClient(connectionString);
  _container = client.database('GlanceDB').container('Lists');
  return _container;
}

// ─── Validation constants ─────────────────────────────────────────────────────
const VALID_LIST_TYPES = new Set(['grocery', 'todo', 'packing']);
const VALID_USERS = new Set(['anna', 'simeon', 'tennille', 'bibi']);
const MAX_TEXT_LENGTH = 200;

// ─── GET /api/lists?listType={type} ──────────────────────────────────────────
app.http('listsGet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'lists',
  handler: async (request, context) => {
    const listType = request.query.get('listType');

    if (!listType || !VALID_LIST_TYPES.has(listType)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'listType query parameter is required.',
          valid: [...VALID_LIST_TYPES],
        }),
      };
    }

    try {
      const container = getContainer();
      const { resources } = await container.items
        .query({
          query: 'SELECT * FROM c WHERE c.listType = @listType ORDER BY c.createdAt ASC',
          parameters: [{ name: '@listType', value: listType }],
        })
        .fetchAll();

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: resources, listType }),
      };
    } catch (err) {
      context.error('Lists GET error:', err.message);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to retrieve list items.' }),
      };
    }
  },
});

// ─── POST /api/lists ──────────────────────────────────────────────────────────
app.http('listsPost', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'lists',
  handler: async (request, context) => {
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

    // Validate listType
    if (!body.listType || !VALID_LIST_TYPES.has(body.listType)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'listType must be one of: grocery, todo, packing.' }),
      };
    }

    // Validate text
    if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'text is required.' }),
      };
    }

    if (body.text.length > MAX_TEXT_LENGTH) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `text must be ${MAX_TEXT_LENGTH} characters or fewer.` }),
      };
    }

    // Validate optional addedBy
    const addedBy = body.addedBy && VALID_USERS.has(body.addedBy) ? body.addedBy : null;

    // Validate optional quantity (grocery use-case)
    let quantity = null;
    if (body.quantity !== undefined) {
      const q = Number(body.quantity);
      quantity = Number.isFinite(q) && q > 0 ? Math.floor(q) : null;
    }

    const now = new Date().toISOString();
    const item = {
      id: `list-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      listType: body.listType,
      text: body.text.trim(),
      quantity,
      unit: typeof body.unit === 'string' ? body.unit.trim().slice(0, 20) : null,
      checked: false,
      addedBy,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const container = getContainer();
      const { resource } = await container.items.create(item);
      return {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: resource }),
      };
    } catch (err) {
      context.error('Lists POST error:', err.message);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to create list item.' }),
      };
    }
  },
});

// ─── PUT /api/lists/{id} — toggle checked state ───────────────────────────────
app.http('listsPut', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'lists/{id}',
  handler: async (request, context) => {
    const itemId = request.params.id;

    if (!itemId || !/^[\w-]+$/.test(itemId)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid item id.' }),
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

    if (!body.listType || !VALID_LIST_TYPES.has(body.listType)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'listType is required for updates.' }),
      };
    }

    try {
      const container = getContainer();
      const partitionKey = body.listType;
      const { resource: existing } = await container.item(itemId, partitionKey).read();

      const updated = {
        ...existing,
        checked: typeof body.checked === 'boolean' ? body.checked : !existing.checked,
        text: typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT_LENGTH) : existing.text,
        updatedAt: new Date().toISOString(),
      };

      const { resource } = await container.item(itemId, partitionKey).replace(updated);
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: resource }),
      };
    } catch (err) {
      if (err.code === 404) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'List item not found.' }),
        };
      }
      context.error('Lists PUT error:', err.message);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to update list item.' }),
      };
    }
  },
});

// ─── DELETE /api/lists/{id}?listType={type} ───────────────────────────────────
app.http('listsDelete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'lists/{id}',
  handler: async (request, context) => {
    const itemId = request.params.id;
    const listType = request.query.get('listType');

    if (!itemId || !/^[\w-]+$/.test(itemId)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid item id.' }),
      };
    }

    if (!listType || !VALID_LIST_TYPES.has(listType)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'listType query parameter is required for deletion.' }),
      };
    }

    try {
      const container = getContainer();
      await container.item(itemId, listType).delete();
      return {
        status: 204,
        body: null,
      };
    } catch (err) {
      if (err.code === 404) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'List item not found.' }),
        };
      }
      context.error('Lists DELETE error:', err.message);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to delete list item.' }),
      };
    }
  },
});

// ─── Glance API — Midnight Reset Timer ───────────────────────────────────────
// Azure Functions v4 programming model.
// Schedule: fires daily at 00:00:01 local time (CRON: 1 0 0 * * *)
//
// Responsibilities:
//   1. Trim completedDates arrays in the Chores container to the last 7 days.
//      This prevents unbounded document growth while keeping a useful history.
//   2. Log a summary of chores reset for observability.
//
// Note: This function does NOT delete completion history — it only prunes
// entries older than 7 days. The current day's completions are always preserved.

'use strict';

const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');

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

// Build an ISO date string for N days ago (YYYY-MM-DD)
function daysAgoKey(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

app.timer('midnightReset', {
  // Fires at 00:00:01 every day — the 6-part CRON used by Azure Functions
  // Format: seconds minutes hours day-of-month month day-of-week
  schedule: '1 0 0 * * *',
  runOnStartup: false,
  handler: async (timer, context) => {
    context.log('MidnightReset: starting daily chore trim run.');

    if (timer.isPastDue) {
      context.warn('MidnightReset: timer is past due — running catch-up.');
    }

    const cutoff = daysAgoKey(7); // Prune anything older than 7 days

    let container;
    try {
      container = getContainer();
    } catch (err) {
      context.error('MidnightReset: failed to connect to Cosmos DB:', err.message);
      return;
    }

    // Fetch all active chores that have at least one completedDate entry
    let allChores;
    try {
      const { resources } = await container.items
        .query({
          query: 'SELECT * FROM c WHERE c.isActive = true AND ARRAY_LENGTH(c.completedDates) > 0',
        })
        .fetchAll();
      allChores = resources;
    } catch (err) {
      context.error('MidnightReset: failed to query chores:', err.message);
      return;
    }

    let trimmedCount = 0;
    let errorCount = 0;

    for (const chore of allChores) {
      const before = chore.completedDates.length;
      const trimmed = chore.completedDates.filter(dateStr => dateStr >= cutoff);

      // Only write back if something actually changed
      if (trimmed.length === before) continue;

      try {
        await container.item(chore.id, chore.assignedUser).replace({
          ...chore,
          completedDates: trimmed,
          updatedAt: new Date().toISOString(),
        });
        trimmedCount++;
      } catch (err) {
        context.error(`MidnightReset: failed to update chore ${chore.id}:`, err.message);
        errorCount++;
      }
    }

    context.log(
      `MidnightReset: complete. Chores scanned: ${allChores.length}, ` +
      `trimmed: ${trimmedCount}, errors: ${errorCount}.`
    );
  },
});

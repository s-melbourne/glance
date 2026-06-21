// ─── Glance API — Calendar Proxy ─────────────────────────────────────────────
// Azure Functions v4 programming model.
// Route: GET /api/calendar
//
// Fetches the private iCloud .ics stream from the URL stored in the
// ICLOUD_CALENDAR_URL app setting, parses it server-side with ical.js,
// and returns a clean structured JSON payload to the frontend.
// The private URL is never exposed to the browser.

'use strict';

const { app } = require('@azure/functions');
const ICAL = require('ical.js');
const { requireAuth } = require('../shared/auth');

// ─── Allowed user IDs — must match USERS array in src/state.js ───────────────
const VALID_USERS = new Set(['anna', 'simeon', 'tennille', 'bibi']);

// ─── Helper: map keyword in event summary to a userId ───────────────────────
const USER_KEYWORDS = [
  { id: 'anna',     keywords: ['anna'] },
  { id: 'simeon',   keywords: ['simeon'] },
  { id: 'tennille', keywords: ['tennille'] },
  { id: 'bibi',     keywords: ['bibi'] },
];

function matchUser(summary) {
  const lower = (summary || '').toLowerCase();
  for (const u of USER_KEYWORDS) {
    if (u.keywords.some(kw => lower.includes(kw))) return u.id;
  }
  return null;
}

// ─── Helper: strip matched user keyword prefix from summary ─────────────────
function stripUserPrefix(summary) {
  let s = summary;
  for (const u of USER_KEYWORDS) {
    for (const kw of u.keywords) {
      s = s.replace(new RegExp(kw, 'gi'), '').trim();
    }
  }
  return s.replace(/^[-:,\s]+/, '').trim() || summary;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isFloatingIcalTime(icalTime) {
  if (icalTime.isDate) return false;
  const tzid = icalTime.zone?.tzid;
  return !tzid || tzid === 'floating';
}

// Serialize for the browser: all-day and floating times keep wall-clock values (no UTC Z suffix).
function icalTimeToApiString(icalTime) {
  if (icalTime.isDate) {
    return `${icalTime.year}-${pad2(icalTime.month)}-${pad2(icalTime.day)}`;
  }
  if (isFloatingIcalTime(icalTime)) {
    return `${icalTime.year}-${pad2(icalTime.month)}-${pad2(icalTime.day)}T${pad2(icalTime.hour)}:${pad2(icalTime.minute)}:${pad2(icalTime.second)}`;
  }
  return icalTime.toJSDate().toISOString();
}

// ─── Helper: convert ICAL.Time to JS Date for server-side window checks ───────
function icalTimeToDate(icalTime) {
  if (icalTime.isDate) {
    return new Date(icalTime.year, icalTime.month - 1, icalTime.day);
  }
  if (isFloatingIcalTime(icalTime)) {
    return new Date(
      icalTime.year,
      icalTime.month - 1,
      icalTime.day,
      icalTime.hour,
      icalTime.minute,
      icalTime.second
    );
  }
  return icalTime.toJSDate();
}

function dateToApiDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dateToApiDateTime(d) {
  return `${dateToApiDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function syncWindowBounds() {
  const windowStart = new Date();
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + 60);
  return { windowStart, windowEnd };
}

function eventOverlapsWindow(start, end, windowStart, windowEnd) {
  const eventEnd = end || start;
  return eventEnd >= windowStart && start <= windowEnd;
}

// ─── Parse raw .ics text into structured event objects ───────────────────────
function parseICalEvents(icsText) {
  let jcal;
  try {
    jcal = ICAL.parse(icsText);
  } catch {
    throw new Error('Failed to parse iCalendar data');
  }

  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents('vevent');
  const events = [];
  const { windowStart, windowEnd } = syncWindowBounds();

  for (const vevent of vevents) {
    const event = new ICAL.Event(vevent);
    const rawSummary = (event.summary || 'Untitled').trim();
    const userId = matchUser(rawSummary);
    const label = stripUserPrefix(rawSummary);

    if (event.isRecurring()) {
      try {
        const iter = event.iterator();
        let next;
        while ((next = iter.next())) {
          const start = icalTimeToDate(next);
          if (start > windowEnd) break;
          if (start < windowStart) continue;

          const detail = event.getOccurrenceDetails(next);
          const end = icalTimeToDate(detail.endDate);

          events.push({
            id: `${event.uid}-${next.toICALString()}`,
            summary: rawSummary,
            label,
            userId,
            start: icalTimeToApiString(next),
            end: icalTimeToApiString(detail.endDate),
            allDay: next.isDate,
          });
        }
      } catch {
        // Skip malformed recurring events without crashing the whole feed
      }
    } else {
      const start = icalTimeToDate(event.startDate);
      const end = event.endDate
        ? icalTimeToDate(event.endDate)
        : new Date(start.getTime() + 3_600_000);

      if (event.startDate.isDate) {
        // Multi-day all-day event — expand into individual day entries
        let cursor = new Date(start);
        cursor.setHours(0, 0, 0, 0);
        const last = new Date(end);
        last.setHours(0, 0, 0, 0);
        let idx = 0;
        while (cursor < last) {
          if (cursor >= windowStart && cursor <= windowEnd) {
            const next = new Date(cursor);
            next.setDate(next.getDate() + 1);
            events.push({
              id: `${event.uid}-allday-${idx++}`,
              summary: rawSummary,
              label,
              userId,
              start: dateToApiDate(cursor),
              end: dateToApiDate(next),
              allDay: true,
            });
          }
          const nextDay = new Date(cursor);
          nextDay.setDate(nextDay.getDate() + 1);
          cursor = nextDay;
        }
      } else if (eventOverlapsWindow(start, end, windowStart, windowEnd)) {
        events.push({
          id: event.uid || `event-${Date.now()}`,
          summary: rawSummary,
          label,
          userId,
          start: icalTimeToApiString(event.startDate),
          end: event.endDate
            ? icalTimeToApiString(event.endDate)
            : dateToApiDateTime(new Date(start.getTime() + 3_600_000)),
          allDay: false,
        });
      }
    }
  }

  return events;
}

// ─── Function registration (v4 model — no function.json) ─────────────────────
app.http('calendar', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'calendar',
  handler: async (request, context) => {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const calendarUrl = process.env.ICLOUD_CALENDAR_URL;

    if (!calendarUrl) {
      context.error('ICLOUD_CALENDAR_URL environment variable is not set.');
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Calendar source not configured.' }),
      };
    }

    // Validate the URL is HTTPS before fetching
    let parsed;
    try {
      parsed = new URL(calendarUrl);
    } catch {
      context.error('ICLOUD_CALENDAR_URL is not a valid URL.');
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Calendar source misconfigured.' }),
      };
    }

    if (parsed.protocol !== 'https:') {
      context.error('ICLOUD_CALENDAR_URL must use HTTPS.');
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Calendar source must use HTTPS.' }),
      };
    }

    let icsText;
    try {
      const response = await fetch(calendarUrl, {
        headers: { 'User-Agent': 'Glance-Family-Dashboard/1.0' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Upstream responded with HTTP ${response.status}`);
      }

      icsText = await response.text();
    } catch (err) {
      context.error('Failed to fetch calendar feed:', err.message);
      return {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to retrieve calendar data.' }),
      };
    }

    let events;
    try {
      events = parseICalEvents(icsText);
    } catch (err) {
      context.error('Failed to parse calendar feed:', err.message);
      return {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Calendar data could not be parsed.' }),
      };
    }

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-cache, no-store',
      },
      body: JSON.stringify({ events, fetchedAt: new Date().toISOString() }),
    };
  },
});

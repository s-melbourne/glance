# Glance

A family dashboard for shared calendars, chores, and household lists. Glance pulls events from a private iCloud calendar feed, maps them to family members by keyword, and presents them in week, day, and month views optimized for phones, tablets, and wall displays.

Built as a static web app on **Azure Static Web Apps** with a **Node.js Azure Functions** API and **Azure Cosmos DB** for persistent data.

## Features

- **Shared calendar** — Server-side proxy fetches and parses an iCloud `.ics` feed; the private URL never reaches the browser
- **Family lanes** — Events are assigned to members when the summary contains their name (e.g. `Anna: dentist`)
- **Week / day / month views** — Touch-friendly layout with per-person filtering
- **Chores** — Daily, weekly, or one-off tasks with per-day completion tracking
- **Lists** — Grocery, todo, and packing lists with optional quantities
- **Offline resilience** — Calendar, chores, and lists are cached locally with [Dexie](https://dexie.org/) (IndexedDB)
- **Auto-sync** — Calendar refreshes every 15 minutes; a midnight timer rolls the UI to the new day

## Architecture

```
Browser (src/)          Azure Static Web Apps
  ├── index.html  ──►   static files + routing
  ├── ui.js             staticwebapp.config.json
  ├── state.js
  └── api-client.js ──► /api/*  ──►  Azure Functions (api/)
                                        ├── calendar.js   → iCloud .ics
                                        ├── chores.js     → Cosmos DB (Chores)
                                        ├── lists.js      → Cosmos DB (Lists)
                                        └── midnightReset.js (timer)
```

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla JS (ES modules), Tailwind CSS, Dexie |
| Hosting | Azure Static Web Apps |
| API | Azure Functions v4 (Node.js 20+) |
| Database | Cosmos DB NoSQL (`GlanceDB`) |
| Calendar | iCloud private calendar URL (`.ics`) |

## Project structure

```
glance/
├── src/                      # Frontend (served at / via SWA routing)
│   ├── index.html
│   ├── ui.js                 # Views, rendering, sync loop
│   ├── state.js              # Family members, date helpers, app state
│   └── api-client.js         # API calls + Dexie offline cache
├── api/                      # Azure Functions
│   ├── functions/
│   │   ├── calendar.js
│   │   ├── chores.js
│   │   ├── lists.js
│   │   └── midnightReset.js
│   ├── host.json
│   ├── local.settings.json   # Local secrets (not committed)
│   └── package.json
├── infra/
│   └── cosmos-schema.json    # Cosmos DB container reference
├── staticwebapp.config.json  # SWA routes, headers, CSP
└── index.html                # Legacy single-file prototype (use src/ instead)
```

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) v4
- [Azure Static Web Apps CLI](https://azure.github.io/static-web-apps-cli/) (recommended for local dev)
- An Azure Cosmos DB account (serverless is fine for household use)
- A private HTTPS iCloud calendar subscription URL

## Local development

### 1. Install API dependencies

```bash
cd api
npm install
```

### 2. Configure environment

Copy `api/local.settings.json` and set your values:

| Variable | Description |
|----------|-------------|
| `ICLOUD_CALENDAR_URL` | Private HTTPS link to your iCloud `.ics` feed |
| `COSMOS_CONNECTION_STRING` | Cosmos DB connection string |

To get an iCloud calendar URL: **Calendar app → right-click calendar → Get Info → enable Public Calendar → copy the `.ics` subscription link** (use the private/subscription URL, not a web page).

### 3. Create Cosmos DB resources

Create a database and containers as described in [`infra/cosmos-schema.json`](infra/cosmos-schema.json):

| Container | Partition key | Notes |
|-----------|---------------|-------|
| `Chores` | `/assignedUser` | No TTL |
| `Lists` | `/listType` | 30-day default TTL |

### 4. Run locally

From the repo root, start the Static Web Apps CLI so the frontend and API run together:

```bash
swa start src --api-location api
```

The app opens at `http://localhost:4280`. The API is proxied at `/api/*`.

Alternatively, run the Functions host alone:

```bash
cd api
npm start
```

Functions listen on `http://localhost:7071`. You will still need a static file server for the frontend and a proxy for `/api` calls.

## Deployment

Deploy to [Azure Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/) with:

- **App location:** `src`
- **API location:** `api`
- **Output location:** *(leave blank — static files only)*

Set these **application settings** in the Azure portal (or via CI/CD):

- `ICLOUD_CALENDAR_URL`
- `COSMOS_CONNECTION_STRING`

The `midnightReset` timer function runs on the Functions host schedule (`1 0 0 * * *`) and trims chore completion history older than 7 days.

## API reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/calendar` | Fetch and parse iCloud calendar events |
| `GET` | `/api/chores?userId={id}` | List active chores (optional filter) |
| `POST` | `/api/chores` | Create a chore |
| `PUT` | `/api/chores/{id}` | Update or toggle completion (`action: "toggle"`) |
| `GET` | `/api/lists?listType={type}` | List items (`grocery`, `todo`, `packing`) |
| `POST` | `/api/lists` | Add a list item |
| `PUT` | `/api/lists/{id}` | Update or toggle checked state |
| `DELETE` | `/api/lists/{id}?listType={type}` | Remove a list item |

## Customizing family members

Family members are defined in two places that must stay in sync:

1. **Frontend** — [`src/state.js`](src/state.js) (`USERS` array: id, name, keywords, colors)
2. **API** — [`api/functions/calendar.js`](api/functions/calendar.js) and [`api/functions/chores.js`](api/functions/chores.js) (`VALID_USERS` / `USER_KEYWORDS`)

Calendar events are matched when the event summary contains a member's keyword (case-insensitive). Prefixes like `Anna:` or `anna -` are stripped for display.

## Calendar event format

Tag events in iCloud so Glance can route them to the right person:

```
Anna: School pickup
Simeon - Football practice
Tennille dentist
```

Events without a matching keyword appear unassigned. Recurring and all-day events are expanded server-side within a 60-day window.

## License

Private family project — no license specified.

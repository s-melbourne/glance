# Glance

A family dashboard for shared calendars, chores, and household lists. Glance pulls events from a private iCloud calendar feed, maps them to family members by keyword, and presents them in week, day, and month views optimized for phones, tablets, and wall displays.

Built as a static web app on **Azure Static Web Apps** with a **Node.js Azure Functions** API and **Azure Cosmos DB** for persistent data.

## Features

- **Sign-in** — Google and Apple SSO via [Firebase Auth](https://firebase.google.com/products/auth) (free Spark plan; no inactivity pause)
- **Shared calendar** — Server-side proxy fetches and parses an iCloud `.ics` feed; the private URL never reaches the browser
- **Family lanes** — Events are assigned to members when the summary contains their name (e.g. `Anna: dentist`)
- **Week / day / month views** — Touch-friendly layout with per-person filtering
- **Chores** — Daily, weekly, or one-off tasks with per-day completion tracking
- **Lists** — Grocery, todo, and packing lists with optional quantities
- **Offline resilience** — Last successful calendar sync is cached in the browser for offline viewing
- **Auto-sync** — Calendar refreshes every 2 minutes (and when the tab becomes visible again); a midnight timer rolls the UI to the new day

## Architecture

```
Browser (public/)       Azure Static Web Apps
  └── index.html  ──►   static files + routing
                        staticwebapp.config.json
        │ fetch /api/calendar
        └─────────────►  Azure Functions (api/)
                           ├── calendar.js   → iCloud .ics
                           ├── chores.js     → Cosmos DB (Chores)
                           ├── lists.js      → Cosmos DB (Lists)
                           └── midnightReset.js (timer)
```

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla JS, Tailwind CSS |
| Hosting | Azure Static Web Apps |
| API | Azure Functions v4 (Node.js 20+) |
| Database | Cosmos DB NoSQL (`GlanceDB`) |
| Calendar | iCloud private calendar URL (`.ics`) |

## Project structure

```
glance/
├── public/                   # Main UI (deployed at / via SWA)
│   ├── index.html            # Calendar planner views + sync loop
│   └── staticwebapp.config.json
├── src/                      # Earlier modular prototype (not deployed)
│   ├── index.html
│   ├── ui.js
│   ├── state.js
│   └── api-client.js
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
└── package.json              # Local dev server (serve public/)
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

Copy [`api/local.settings.json.example`](api/local.settings.json.example) to `api/local.settings.json` and set your values:

| Variable | Description |
|----------|-------------|
| `ICLOUD_CALENDAR_URL` | Private HTTPS link to your iCloud `.ics` feed |
| `COSMOS_CONNECTION_STRING` | Cosmos DB connection string |
| `GLANCE_AUTH_DISABLED` | Set to `true` for local API dev without SWA auth headers |
| `GLANCE_ALLOWED_EMAILS` | Comma-separated allowlist of Google/Apple emails (optional; empty = any signed-in user) |

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
swa start public --api-location api
```

The app opens at `http://localhost:4280`. The API is proxied at `/api/*` and SWA auth is emulated at `/.auth/*`.

Alternatively, run the Functions host alone:

```bash
cd api
npm start
```

Functions listen on `http://localhost:7071`. You will still need a static file server for the frontend and a proxy for `/api` calls.

## Deployment

Deploy to [Azure Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/) with:

- **App location:** `public`
- **API location:** `api`
- **Output location:** *(leave blank — static files only)*

Set these **application settings** in the Azure portal (or via CI/CD):

| Setting | Purpose |
|---------|---------|
| `ICLOUD_CALENDAR_URL` | Private iCloud `.ics` subscription URL |
| `COSMOS_CONNECTION_STRING` | Cosmos DB connection string |
| `FIREBASE_API_KEY` | Firebase web API key (public; used by browser) |
| `FIREBASE_AUTH_DOMAIN` | e.g. `your-project.firebaseapp.com` |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_APP_ID` | *(Optional)* Firebase web app ID |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service account JSON (single line) for API token verification |
| `GLANCE_ALLOWED_EMAILS` | *(Optional)* Comma-separated family emails allowed to sign in |

### Authentication (Firebase — Google & Apple SSO)

Glance uses **[Firebase Authentication](https://firebase.google.com/docs/auth)** on the free **Spark** plan. The browser signs in with Google or Apple; the API verifies Firebase ID tokens. This works on **Azure Static Web Apps Free tier** (no Standard SKU required).

**1. Create a Firebase project**

1. Go to [Firebase Console](https://console.firebase.google.com/) → **Add project** (Spark plan, no payment card required).
2. **Build → Authentication → Sign-in method** → enable **Google** and **Apple**.
3. **Project settings → General** → add a **Web app** → copy the `apiKey`, `authDomain`, `projectId`, and `appId`.
4. **Authentication → Settings → Authorized domains** → add your SWA hostname (e.g. `your-app.azurestaticapps.net`) and `localhost` for local dev.

**2. Apple Sign In (in Firebase Console)**

Follow Firebase’s Apple provider setup: register your Services ID in Apple Developer, then paste Team ID, Key ID, private key, and Services ID into Firebase.

**3. Service account for the API**

1. **Project settings → Service accounts** → **Generate new private key**.
2. Paste the entire JSON as a **single-line** value into Azure `FIREBASE_SERVICE_ACCOUNT_JSON`.

**4. Azure application settings**

Set all `FIREBASE_*` variables above in Static Web App → **Environment variables**. The browser loads public config from `GET /api/config`; protected routes require a valid `Authorization: Bearer <token>` header.

**5. Family allowlist (recommended)**

Set `GLANCE_ALLOWED_EMAILS` to household emails (comma-separated). Other Google/Apple accounts receive HTTP 403.

**6. Local development**

```bash
swa start public --api-location api
```

Set `GLANCE_AUTH_DISABLED=true` in `api/local.settings.json` to skip token verification when testing Functions alone. Use **View demo calendar** on the login screen to browse sample events without Firebase configured.

### Connect your iPhone calendar

Glance syncs through a **private iCloud calendar subscription URL**. The URL is stored only in Azure (`ICLOUD_CALENDAR_URL`); the browser calls `/api/calendar` and never sees the link.

1. **On iPhone** — open **Settings → Calendar → Accounts → iCloud** and ensure **Calendars** is enabled. Create or use a shared family calendar in the Calendar app.
2. **Get the private link** — on a Mac, open **Calendar →** right-click the calendar → **Get Info** → enable **Public Calendar**, then copy the **Share Link** (it ends in `.ics`). Alternatively, sign in at [icloud.com/calendar](https://www.icloud.com/calendar), select the calendar, share it, and copy the subscription URL.
3. **Azure** — in your Static Web App → **Environment variables**, add `ICLOUD_CALENDAR_URL` with the full `https://…` URL.
4. **Local dev** — add the same key to `api/local.settings.json` under `Values`, then run `swa start public --api-location api`.

Events sync every 2 minutes while Glance is open. Tag titles with a family member name so Glance routes them to the right lane (see [Calendar event format](#calendar-event-format)).

The `midnightReset` timer function runs on the Functions host schedule (`1 0 0 * * *`) and trims chore completion history older than 7 days.

## API reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/config` | Public Firebase web SDK settings for sign-in |
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

1. **Frontend** — [`public/index.html`](public/index.html) (`USERS` array in the inline script)
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

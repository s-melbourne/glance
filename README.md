# Glance

A family dashboard for shared calendars, chores, and household lists. Glance pulls events from a private iCloud calendar feed, maps them to family members by keyword, and presents them in week, day, and month views optimized for phones, tablets, and wall displays.

Built as a static web app on **Azure Static Web Apps** with a **Node.js Azure Functions** API and **Azure Cosmos DB** for persistent data.

## Features

- **Sign-in** — Google and Apple SSO via Azure Static Web Apps (family email allowlist optional)
- **Shared calendar** — Server-side proxy fetches and parses an iCloud `.ics` feed; the private URL never reaches the browser
- **Family lanes** — Events are assigned to members when the summary contains their name (e.g. `Anna: dentist`)
- **Week / day / month views** — Touch-friendly layout with per-person filtering
- **Chores** — Daily, weekly, or one-off tasks with per-day completion tracking
- **Lists** — Grocery, todo, and packing lists with optional quantities
- **Offline resilience** — Last successful calendar sync is cached in the browser for offline viewing
- **Auto-sync** — Calendar refreshes every 15 minutes; a midnight timer rolls the UI to the new day

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
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (SSO) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `APPLE_CLIENT_ID` | Apple Services ID (SSO) |
| `APPLE_CLIENT_SECRET` | Apple Sign In client secret (JWT) |
| `GLANCE_ALLOWED_EMAILS` | *(Optional)* Comma-separated family emails allowed to sign in |

### Authentication (Google & Apple SSO)

Glance uses [Azure Static Web Apps built-in authentication](https://learn.microsoft.com/azure/static-web-apps/authentication-authorization). The UI offers **Continue with Google** and **Continue with Apple**; all `/api/*` routes require a signed-in user.

**1. Google**

1. Create an OAuth client in [Google Cloud Console](https://console.cloud.google.com/) (Web application).
2. Add authorized redirect URI: `https://<your-swa-hostname>.azurestaticapps.net/.auth/login/google/callback`
3. In Azure Portal → Static Web App → **Settings → Authentication** → Add **Google**, or set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` as application settings (referenced by [`public/staticwebapp.config.json`](public/staticwebapp.config.json)).

**2. Apple**

1. Register an App ID and Services ID in [Apple Developer](https://developer.apple.com/) with Sign in with Apple enabled.
2. Configure return URL: `https://<your-swa-hostname>.azurestaticapps.net/.auth/login/apple/callback`
3. Generate a client secret (JWT) and set `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` in application settings. Apple is wired as a custom OpenID Connect provider named `apple` in `staticwebapp.config.json`.

**3. Family allowlist (recommended)**

Set `GLANCE_ALLOWED_EMAILS` to your household Google/Apple emails (comma-separated). The API rejects sign-ins from other accounts with HTTP 403.

**4. Local development**

Run `swa start public --api-location api` so `/.auth/*` and `/api/*` behave like production. Set `GLANCE_AUTH_DISABLED=true` in `api/local.settings.json` to skip API auth checks when testing Functions in isolation.

### Connect your iPhone calendar

Glance syncs through a **private iCloud calendar subscription URL**. The URL is stored only in Azure (`ICLOUD_CALENDAR_URL`); the browser calls `/api/calendar` and never sees the link.

1. **On iPhone** — open **Settings → Calendar → Accounts → iCloud** and ensure **Calendars** is enabled. Create or use a shared family calendar in the Calendar app.
2. **Get the private link** — on a Mac, open **Calendar →** right-click the calendar → **Get Info** → enable **Public Calendar**, then copy the **Share Link** (it ends in `.ics`). Alternatively, sign in at [icloud.com/calendar](https://www.icloud.com/calendar), select the calendar, share it, and copy the subscription URL.
3. **Azure** — in your Static Web App → **Environment variables**, add `ICLOUD_CALENDAR_URL` with the full `https://…` URL.
4. **Local dev** — add the same key to `api/local.settings.json` under `Values`, then run `swa start public --api-location api`.

Events sync every 15 minutes. Tag titles with a family member name so Glance routes them to the right lane (see [Calendar event format](#calendar-event-format)).

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

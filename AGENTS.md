# Glance — Agent guide

Glance is a family dashboard (shared calendar, chores, lists). See `README.md` for the full architecture and API reference.

- **Frontend** (`src/`): vanilla JS ES modules + Tailwind/Dexie via CDN. Static files served at `/`, talks to `/api/*`.
- **API** (`api/`): Azure Functions v4 (Node) — `calendar` (proxies an iCloud `.ics` feed), `chores`/`lists` (Cosmos DB), and a `midnightReset` timer.

## Cursor Cloud specific instructions

Dependencies are installed by the startup update script (`npm install` at the repo root and in `api/`). The `api/` install includes Azure Functions Core Tools (`func`) and the Azurite storage emulator as local dev tools.

### Running the services (commands not standard — read this)

- **Frontend**: the `npm run dev` script passes `serve src -l 3000 --open`, but the installed `serve@14` no longer accepts `--open` and crashes. Run it without that flag instead: `./node_modules/.bin/serve src -l 3000` (port 3000). `--open` only auto-opens a browser and is useless headless.
- **API host**: run from `api/` with `npm start` (which runs `func start`, port 7071). `func` is a local binary — it is NOT on `PATH`, so use `npm start` / `npx func` / `./node_modules/.bin/func`, not a bare `func`.
- **Azurite is required for a stable API host.** The `midnightReset` timer trigger needs `AzureWebJobsStorage` (`UseDevelopmentStorage=true` → `127.0.0.1:10000`). Without Azurite, the timer listener fails after retries and destabilizes the host. Start it first, in its own process: `cd api && ./node_modules/.bin/azurite --silent --location /tmp/azurite`. HTTP endpoints can respond briefly without it, but don't rely on that.

### External dependencies / secrets (not available by default)

The API integrates with two external services configured via `api/local.settings.json` (committed with placeholders):

- `ICLOUD_CALENDAR_URL` — an HTTPS `.ics` feed. The `calendar` endpoint validates HTTPS, fetches it server-side, and parses with `ical.js`. Without a real value it returns HTTP 503.
- `COSMOS_CONNECTION_STRING` — Cosmos DB. `chores`/`lists` return HTTP 500 without a reachable Cosmos account.

Calendar events are routed to family lanes only when the summary contains a member keyword (`anna`, `simeon`, `tennille`, `bibi`), e.g. `Anna: Dentist`.

### Wiring the frontend to the live API

`serve` does not proxy `/api`. To exercise the full stack same-origin (as Azure Static Web Apps does in prod), either use the SWA CLI (`npx @azure/static-web-apps-cli start src --api-location api`, the README's recommended runner) or put a small reverse proxy in front that forwards `/api/*` to `http://127.0.0.1:7071`. With no working calendar feed, the frontend falls back to in-app demo events; note that the demo fallback is overwritten by the immediate re-sync in `startSyncLoop()`, so to see events in the UI you need the `calendar` endpoint actually returning data.

### Testing against a local feed without secrets

You can demo the calendar pipeline end-to-end without real secrets by serving a family-tagged `.ics` over local HTTPS (self-signed) and pointing `ICLOUD_CALENDAR_URL` at it. Because Node's fetch rejects self-signed certs, launch `func` with `NODE_TLS_REJECT_UNAUTHORIZED=0` (local dev only). Revert any `local.settings.json` change before committing — never commit real secrets.

There is no lint step or automated test suite in this repo; `api` `npm run build` is a no-op.

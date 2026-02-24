# Folio Foundation

Folio inherits the runtime foundation from `email-automator` with Folio-specific naming and no business features implemented yet.

Architecture baseline:

- Local desktop app runtime (React UI + local Express backend)
- Remote Supabase (serverless database + Edge Functions)
- Local processing backend wired through RealTimeX SDK
- Unified single-port serving in desktop mode (UI + API on same port)

## What is included

- Project structure and build scripts
- Env/config loading strategy
- Local API middleware stack (auth, validation, rate-limit, error handling)
- Dynamic Supabase connection strategy (env fallback + request header forwarding)
- RealTimeX SDK service bootstrap
- Setup Wizard parity flow (managed and manual setup, migration orchestration, SSE logs)
- Setup/migrate backend routes (`/api/setup/*`, `/api/migrate`)
- Health and processing scaffold routes
- Baseline Supabase schema, RLS policies, and migration timestamp RPC
- Edge function skeleton for user settings

## What is intentionally not included yet

- OCR/classification/routing logic
- Folio-specific ingestion and extraction features
- Any production document processing behavior

## Run locally

```bash
cd /Users/ledangtrung/rtGit/realtimex-ai-app-agents/folio
npm install
npm run dev:api
npm run dev
```

Desktop-style single-port run (same shape as RealTimeX Desktop launch):

```bash
npx @realtimex/folio@latest --port 5176
```

Local workspace equivalent:

```bash
node ./bin/folio.js --port 5176
```

## Scripts

- `npm run dev` - frontend (Vite)
- `npm run dev:api` - local backend (tsx watch)
- `npm run build` - UI + API build
- `npm run migrate` - push Supabase migrations/functions

## Setup Wizard Flow

1. Open app and run Setup Wizard.
2. Choose:
   - Managed: provide Supabase access token, select org, auto-provision project.
   - Manual: provide existing Supabase URL + anon key.
3. Run migration from wizard (streamed logs from `/api/migrate`).
4. Wizard stores Supabase config locally and unlocks foundation dashboard.

## Repo layout

- `src/` frontend shell + shared API/config clients
- `api/` local backend runtime
- `supabase/` migrations and edge functions
- `scripts/` migration and build helpers
- `bin/` CLI wrappers for desktop usage

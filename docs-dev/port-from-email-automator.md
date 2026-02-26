# Folio Port Map

This document maps what was intentionally inherited from `email-automator` into Folio before adding product features.

## Inherited Foundations

- Local desktop runtime shape: React frontend + local Express backend
- Remote Supabase data plane with RLS-first schema and migrations
- Hybrid API client pattern: Edge Functions + Local API
- Dynamic Supabase config strategy: BYOK via UI/localStorage with env fallback
- Middleware stack: auth, validation, rate-limit, centralized error handling
- RealTimeX SDK bootstrap and provider detection service
- Migration/version check utility pattern
- CLI wrappers and migration script conventions

## Adapted for Folio

- Default local API port changed to `3006`
- Domain models reduced to foundation tables (`user_settings`, `integrations`, `processing_jobs`, `system_logs`)
- Processing route is scaffold-only (`/api/processing/dispatch`), no business logic
- Edge function baseline includes only `api-v1-settings`

## Explicitly Deferred

- Any Folio ingestion funnel implementation
- OCR/classification/extraction behavior
- Rule/routing business actions
- Calendar/ledger side effects

## Why this sequence

This keeps architecture parity with the proven runtime and prevents rework. Feature development can now layer on top of stable app/server/database/runtime contracts.

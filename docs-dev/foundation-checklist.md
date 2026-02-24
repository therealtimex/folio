# Foundation Checklist

## Local App

- [x] Vite React frontend shell
- [x] Local Express API server
- [x] Dev and build scripts
- [x] CLI wrappers (`folio`, `folio-setup`, `folio-deploy`)

## Supabase

- [x] Supabase config
- [x] Initial schema migration
- [x] Migration timestamp RPC
- [x] RLS policies for all baseline tables
- [x] Minimal edge function (`api-v1-settings`)

## RealTimeX SDK

- [x] SDK initialization service
- [x] availability checks
- [x] default provider selection
- [x] local processing dispatch stub route

## Gaps Before Feature Work

- [ ] Add typed DB client generation
- [x] Add CI workflow (typecheck/test/build/lint)
- [x] Add auth/session wiring in frontend
- [x] Add setup wizard UX parity with email-automator

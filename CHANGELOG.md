# Changelog

All notable changes to Folio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.17] - 2026-03-03
### Added
- **Workspace multi-tenancy** — all data (ingestions, policies, document chunks, policy match feedback) is now scoped to a `workspace_id` rather than `user_id`, enabling shared workspaces across team members.
- `auth` middleware now resolves the active workspace from the `X-Workspace-Id` request header, falling back to the user's earliest active membership. `req.workspaceId` and `req.workspaceRole` are set for all authenticated requests. Backward-compatible: deployments without the workspace migration (missing `workspace_members` table) continue to function.
- New `/api/workspaces` route covering: list workspaces, list members, invite member, update member role, remove member.
- **Workspace & Team** settings tab in `AccountSettingsPage` — switch active workspace, view members, invite by email, update roles, remove members (with confirmation dialog). Owners cannot be demoted or removed.
- OTP email login as an alternative to password login on `LoginPage` — two-step flow (send code → verify 6-digit code), with resend support. `shouldCreateUser: false` prevents account creation via OTP.
- Active workspace persisted in `localStorage` (`folio_active_workspace_id`) and propagated via `X-Workspace-Id` header on every API request. `api.setActiveWorkspaceId()` dispatches a `folio:workspace-changed` custom event for reactive UI updates.
- `search_workspace_documents` Supabase RPC for workspace-scoped vector search (falls back to existing `search_documents` when no workspace context is present).

### Changed
- `PolicyLoader` cache key changed from `user_id` to `workspace_id`; cache is invalidated per-workspace on save, patch, and delete.
- `PolicyLearningService`, `RAGService`, `IngestionService`, `PolicyEngine`, `ChatService` all accept and propagate `workspaceId` throughout.
- `IngestionService.list`, `.get`, `.delete` signatures simplified — `userId` parameter removed, replaced by `workspaceId`.
- Stats endpoint (`GET /api/stats`) now queries by `workspace_id` and returns `403` (not `400`) when no workspace context is present, consistent with all other endpoints.
- `LoginPage` OTP/password mode toggle resets cleanly when switching to sign-up mode. `useEffect`-based `isSignUp` sync removed in favour of `key` prop on the component.
- Member removal confirmation replaced with an in-app `Dialog` component (previously used `window.confirm`).

### Database migrations
- `20260303000000_add_workspaces_phase1.sql` — `workspaces` and `workspace_members` tables, RLS, unique constraints on `(workspace_id, policy_id)` and `(workspace_id, ingestion_id, policy_id)`, workspace_id columns backfilled.
- `20260303010000_add_workspace_management_rpc.sql` — RPCs for workspace management.
- `20260303020000_workspace_scope_document_chunks.sql` — `workspace_id` column on `document_chunks`, `search_workspace_documents` RPC.
- Existing migrations made idempotent (`DROP … IF EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, publication guard).

## [0.1.16] - 2026-03-02
### Changed
- Dropzone directory resolution now delegates to `SDKService.getDefaultDropzoneDir()`, which queries `sdk.getAppDataDir()` (with a 10 s timeout) and falls back to `~/.realtimex.ai/Resources/local-apps/{appId}/dropzone`. Users with no configured `storage_path`, or whose path still points to the legacy `~/.realtimex/folio/dropzone` default, are migrated automatically.

### Fixed
- Removed stale `// @ts-ignore` annotations on `sdk.ping()` calls now that `ping`, `getAppDataDir`, and `appId` are present in the SDK type definitions.

## [0.1.15] - 2026-03-01
### Changed
- Increased document detail modal width from `max-w-xl` (576px) to `max-w-3xl` (768px) to give the policy match block adequate horizontal space.

## [0.1.14] - 2026-03-01
### Added
- Separate ingestion LLM model settings (`ingestion_llm_provider`, `ingestion_llm_model`) independent from chat model settings, with backward-compatible fallback to chat settings when ingestion settings are unset.
- New database columns `ingestion_llm_provider` and `ingestion_llm_model` on `user_settings` (nullable, no default) via migration `20260302000000_add_ingestion_llm_settings.sql`.
- `IngestionService.resolveIngestionLlmSettings` — public static helper that applies the ingestion → chat fallback chain; used consistently across both fast paths (`ingest`, `rerun`) and the summarize route.
- Intelligence settings UI now shows a three-column layout with separate "Chat LLM" and "Ingestion LLM" provider/model selectors.
- `ModelCapabilityService.resolveVisionSupport` now prefers `ingestion_llm_provider`/`ingestion_llm_model` so VLM triage decisions reflect the actual ingestion model.
- Ingestion model context included in system prompt metadata passed to the AI assistant.

### Tests
- Added regression for `resolveVisionSupport` preferring ingestion model settings over chat model settings when both are set.

## [0.1.13] - 2026-03-01
### Added
- Image re-encode retry on VLM fast path: when a VLM call fails with an `"invalid model"` error, the ingestion service now re-encodes the image to PNG via `sips` and retries once before falling back to the heavy path. Controlled by `FOLIO_VLM_IMAGE_REENCODE_RETRY_ENABLED` (default `true`). Retry metrics (attempted / succeeded / failed / skipped) are emitted to the logger and LiveTerminal.

### Fixed
- Removed `"invalid model"` from realtimexai provider capability hints for both image and PDF modalities. The realtimexai SDK rejects `image_url` and `input_file` content blocks at the SDK layer for all models, including genuinely multimodal ones, making the error unreliable as a capability signal.
- Added manual override protection in `writeCapability`: auto-learning (failure or success) now skips writing if the current entry carries `reason: "manual_override"` and the override has not expired. This prevents repeated VLM errors from silently overwriting a user-set capability state.
- `learnVisionFailure` and `learnVisionSuccess` in `IngestionService` now pass `resolvedProvider`/`resolvedModel` (the effective values from `llmSettings`) instead of the pre-resolution `llmProvider`/`llmModel` variables.

### Tests
- Added regression for manual support override not overwritten by automatic failure learning.
- Added regression for manual unsupported override not overwritten by automatic success learning.

## [0.1.12] - 2026-03-01
### Added
- PDF modality support for multimodal capability learning. The capability system now tracks image and PDF support independently per model, using separate keys (`provider:model` for image, `provider:model:pdf` for PDF).
- PDF multimodal fast path in ingestion triage: when text extraction yields weak coverage, PDFs are now routed to a VLM fast path via `[VLM_PDF_DATA:...]` marker and the result is learned against the PDF modality.
- Modality-aware classification hints and scoring in `ModelCapabilityService`: separate document-specific patterns, capability codes, high-precision phrases, weak hints, and provider-specific hints for image vs. PDF.
- `VisionCapabilityModality` type exported for use across services.
- Modality badge in the Intelligence settings UI capability rows.

### Changed
- `PolicyEngine` now handles both `[VLM_IMAGE_DATA:...]` and `[VLM_PDF_DATA:...]` markers, emitting an `image_url` block for images and an `input_file` block for PDFs.
- `RAGService` chunking guard updated from a string prefix check to a regex covering both marker types.
- `resolveVisionSupport` and `getVisionState` accept an optional `modality` parameter (default `"image"`) for backward compatibility.
- PDF data URL in the ingestion fast path reuses the already-loaded parse buffer to avoid a redundant file read.
- Intelligence settings UI capability row parser extended to handle the `provider:model:pdf` key format and `pending_unsupported` state.

### Tests
- Added regression tests for PDF modality key isolation, PDF document-specific error classification, and the weak-hints-plus-provider-specific scoring path for PDF.

## [0.1.11] - 2026-03-01
### Changed
- Replaced binary vision capability classification with a weighted, confidence-scored approach. Errors are now evaluated across three ordered tiers — transient/auth, document-specific, and capability — before a score is computed against a threshold.
- A model is now placed in a `pending_unsupported` state on the first capability signal and only marked `unsupported` after a second confirmed failure within the rolling 24-hour window, preventing single-failure blacklisting.

### Fixed
- HTTP 415 and 422 status codes no longer short-circuit to document-specific classification on their own; they now require a corroborating error code or message, preventing clear capability rejection messages (e.g. "does not support images") from being suppressed by an ambiguous status code.
- `"invalid model"` evidence no longer inflates the capability score for realtimexai by appearing in multiple independent scoring paths simultaneously.
- Added `"vision is not supported"` and `"vision not supported"` as high-precision capability phrases so generic vision rejection messages score above the confirmation threshold without requiring provider-specific wording.

### Tests
- Added regression coverage for: transient precedence over capability hints, document-specific payload isolation, two-failure confirmation flow, structured error code scoring, success resetting pending state, 422 non-short-circuit, realtimexai deduplication, and generic vision-not-supported phrasing.

## [0.1.1] - 2026-02-28
### Added
- Dynamic RAG retrieval capabilities with support for multiple embedding models.
- Policy synthesis and learning with manual match feedback and UI integration.
- Robust Google Sheets integration via `AppendToGSheetAction`, including error parsing and remediation.
- Vision model capabilities and updated intelligence settings.
- Real-time event tracing for ingestion processes displayed in LiveTerminal.

### Changed
- Improved ingestion summary and duplicate file detection.
- Refactored policy learning result structure and Actuator logging.
- Extracted entities are now used to enrich documents before policy processing.

### Fixed
- Fixed renaming action type naming and ensured path persistence.

# Changelog

All notable changes to Folio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

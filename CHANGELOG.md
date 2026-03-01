# Changelog

All notable changes to Folio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

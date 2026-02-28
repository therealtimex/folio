# Changelog

All notable changes to Folio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

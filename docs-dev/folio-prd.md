Product Requirement Document (PRD)

**Project Name:** Folio
**Version:** 1.0
**Status:** Draft
**Owner:** Product Lead (You)

## 1. Executive Summary
Folio is an AI-powered "Chief of Staff" for personal documentation. It automates the lifecycle of physical and digital documents—from ingestion to data extraction—eliminating the manual labor of sorting mail, renaming files, and typing data into spreadsheets.

## 2. Problem Statement
Residents and professionals receive high volumes of physical mail and digital invoices.
*   **The Bottleneck:** Manual digitization (scanning) is disconnected from organization (filing).
*   **The Risk:** Critical documents (Tax forms, legal notices) are lost in "Downloads" folders or physical piles.
*   **The Waste:** Valuable data (medical expenses, tax deductions) remains trapped on paper, requiring manual entry during tax season.

## 3. User Personas
*   **The "Sunnyvale Local":** High net worth, complex taxes (RSUs, Investments), receives 20+ pieces of mail/week. Values time over money. Privacy-conscious.
*   **The Expat/Immigrant:** Dealings with visa documents, government notices, and international banking. Needs precise record-keeping.

## 4. Functional Requirements

### 4.1 Ingestion (The Funnel)
*   **FR-01: Network Scanner Watch:** System must poll a local network folder (SMB/FTP) designated for a physical scanner (e.g., Fujitsu ScanSnap).
*   **FR-02: Email Watch:** System must monitor a specific email alias (e.g., `docs@folio.local`) for digital invoices.
*   **FR-03: Cloud Watch:** System must monitor a "Drop Zone" in Google Drive/Dropbox.

### 4.2 Classification (The Brain)
*   **FR-04: Doc Type Detection:** AI must classify documents into user-defined categories: *Tax, Legal, Medical, Utility, Insurance, Personal, Junk.*
*   **FR-05: Junk Filtering:** System must identify "Marketing/Spam" with >99% accuracy and move to a `/Trash` folder for auto-deletion after 30 days.
*   **FR-06: Multi-Page Splitting:** If a 20-page PDF contains 3 different letters, the system must split them into 3 separate files.

### 4.3 Organization (The Librarian)
*   **FR-07: Smart Renaming:** Files must be renamed using a consistent convention: `YYYY-MM-DD_[Entity]_[Type]_[Amount/Ref].pdf`.
*   **FR-08: Dynamic Directory Routing:** Files must be moved to a directory structure based on content:
    *   *Input:* PG&E Bill $\rightarrow$ *Output:* `/Utilities/Electricity/2024/`
    *   *Input:* W-2 Form $\rightarrow$ *Output:* `/Financial/Taxes/2024/Income/`

### 4.4 Data Extraction (The Analyst)
*   **FR-09: Entity Extraction:** System must extract specific fields based on document type (Amount, Due Date, Tax Year, Box 1 Wages).
*   **FR-10: CSV/Spreadsheet Append:** Extracted data must be appended to a "Master Ledger" (CSV or Google Sheet).
*   **FR-11: Calendar Integration:** If a document has a future "Due Date" or "Appearance Date," create a calendar event (via `.ics` file or API).

## 5. Non-Functional Requirements
*   **NFR-01: Privacy:** No data sent to public LLM APIs without PII scrubbing OR use of Zero-Retention enterprise APIs.
*   **NFR-02: Latency:** Document processing time < 60 seconds per page.
*   **NFR-03: Reliability:** "Human-in-the-loop" folder for documents with low classification confidence (<80%).

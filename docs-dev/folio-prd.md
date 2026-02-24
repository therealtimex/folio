# Part 1: Product Requirement Document (PRD)

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

---

# Part 2: Technical Specification (Tech Spec)

**Project:** Folio Core Engine
**Tech Stack:** Python 3.10+, LangChain, Docker

## 1. System Architecture

The system follows a **Pipeline Architecture**:
`Watcher` $\rightarrow$ `Preprocessor` $\rightarrow$ `Intelligence Engine` $\rightarrow$ `Actuator`

### 1.1 Component Diagram
1.  **Watcher Service:** Python `watchdog` library monitoring local paths.
2.  **OCR/Vision Module:** Converts PDF/Images to text/layout data.
3.  **LLM Router:** The decision maker (OpenAI GPT-4o via API or Local Llama 3 via Ollama).
4.  **File System Manager:** Python `shutil` / `os` for moving/renaming.
5.  **Integration Manager:** APIs for Google Sheets, Notion, or CalDAV.

## 2. Data Flow & Logic

### Step 1: Ingestion & Pre-processing
*   **Trigger:** New file detected in `/input`.
*   **Action:**
    *   Generate SHA-256 hash (to prevent duplicate processing).
    *   Convert PDF to Image (for Vision models) using `pdf2image`.
    *   **Text Extraction:** Use `Tesseract` (Local) for basic text or send Image to Multimodal LLM.

### Step 2: The "Reasoning Loop" (LLM Prompt Strategy)
*   **Input:** Raw OCR text + Image.
*   **Prompt Structure (System Prompt):**
    > "You are Folio, a document assistant. Analyze the attached image.
    > 1. Classify the document (Tax, Bill, Junk, Medical).
    > 2. Extract the Document Date (YYYY-MM-DD).
    > 3. Identify the Vendor/Sender Entity.
    > 4. If Bill: Extract Total Amount.
    > 5. If Tax: Extract Form Type (e.g., 1099-DIV).
    > Return response STRICTLY as JSON."

### Step 3: Validation & Routing
*   **JSON Validation:** Python `Pydantic` validates the LLM output.
    *   *Check:* Is the date valid? Is the amount a float?
*   **Confidence Check:** If critical fields are missing, move file to `/Needs_Review`.

### Step 4: Execution (The "Actuator")
*   **Renaming Logic:**
    ```python
    new_filename = f"{date}_{entity}_{doc_type}.pdf"
    # Example: 2023-12-01_Kaiser_MedicalBill.pdf
    ```
*   **Filing Logic:**
    *   Map `Tax` $\rightarrow$ `/Server/Docs/Financial/Taxes/{Year}/`
    *   Map `Junk` $\rightarrow$ `/Server/Trash/`
*   **Side Effects:**
    *   Update `ledger.csv` with `[Date, Entity, Type, Amount, FilePath]`.

## 3. Data Schema (The "Manifest")

Every processed document generates a "Sidecar JSON" metadata file stored in a hidden `.folio` folder for searchability.

```json
{
  "id": "a1b2c3d4",
  "original_name": "scan_001.pdf",
  "processed_name": "2024-02-14_Chase_Statement.pdf",
  "classification": "Financial_Statement",
  "confidence_score": 0.98,
  "metadata": {
    "entity": "Chase Bank",
    "account_last_4": "4490",
    "statement_period": "Jan 2024",
    "total_balance": 4500.00
  },
  "actions_taken": [
    "Renamed",
    "Moved to /Financial/Bank/Chase",
    "Logged to SQLite DB"
  ]
}
```

## 4. API & Integration Design

### 4.1 Internal APIs (Python Classes)
*   `DocumentProcessor.process(file_path)`
*   `Classifier.predict(text_content)`
*   `Extractor.get_entities(text_content, schema)`

### 4.2 External Hooks
*   **Google Sheets:** Use `gspread` library to append rows for tax tracking.
*   **Notion:** Use Notion API to create a database entry for every "Legal" document found.

## 5. Security & Privacy Implementation

To handle the "Sunnyvale Resident" requirement (SSN, Financials):

1.  **Tier 1 (Junk/Generic):** Can use Cloud LLM (OpenAI/Anthropic) for high accuracy.
2.  **Tier 2 (Sensitive - Tax/Medical):**
    *   **Option A:** Use **Local LLM** (Mistral-7B or Llama-3 running on local Mac Studio/PC). **Zero data leaves the house.**
    *   **Option B:** Redact PII (Regex for SSN patterns) before sending to Cloud API.


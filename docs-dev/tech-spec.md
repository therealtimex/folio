# Technical Specification (Tech Spec)

**Project:** Folio Core Engine

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


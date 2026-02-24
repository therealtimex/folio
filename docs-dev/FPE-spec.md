# Folio Policy Engine (FPE) Specification
**Version:** 1.0.0
**Status:** Final
**Scope:** Core Logic & Schema Definition

## 1. System Architecture
The Policy Engine is a pipeline execution environment. It does not "guess"; it evaluates documents against a prioritized list of user-defined definitions (Policies).

### The 4-Stage Pipeline
1.  **Ingest & Normalize:** Convert incoming file (PDF/Img) into a standardized `Document Object` (Text + Vector Embeddings).
2.  **Match (The Router):** Iterate through active Policies to find the *Best Fit*.
3.  **Extract (The Parser):** Use the specific schema defined in the matched Policy to query the LLM.
4.  **Execute (The Actuator):** Perform the side-effects defined in the Policy (Move, Rename, API Call).

---

## 2. The Policy Definition Schema (YAML)
All policies must adhere to the `folio/v1` standard.

### 2.1 Header & Metadata
Defines the identity and priority of the policy.

```yaml
apiVersion: folio/v1
kind: Policy
metadata:
  id: "pge-residential-bill"
  name: "PG&E Utility Bill"
  version: "1.0.0"
  description: "Handles residential electricity statements from Pacific Gas & Electric."
  priority: 100  # Higher numbers evaluated first. (e.g., Junk Filter = 900)
  tags: ["utility", "household", "tax-deductible"]
```

### 2.2 The Matcher (Logic Gate)
Defines *if* this policy applies to the document. Supports Boolean logic.

```yaml
spec:
  match:
    strategy: "ALL" # Options: ALL (AND), ANY (OR)
    conditions:
      - type: "keyword"
        value: ["Pacific Gas and Electric Company", "PG&E"]
        case_sensitive: false
      
      - type: "keyword"
        value: ["Service For:", "Account Number"]
        
      - type: "llm_verify"
        prompt: "Is this a monthly utility bill statement?"
        confidence_threshold: 0.85
```

### 2.3 The Extractor (Data Schema)
Defines *what* data points to pull. This generates the prompt for the LLM.

```yaml
  extract:
    - key: "total_amount"
      type: "currency"
      description: "The 'Total Amount Due' for this billing period. Exclude past due balances."
      required: true
      
    - key: "due_date"
      type: "date"
      format: "YYYY-MM-DD"
      description: "The date payment must be received to avoid penalties."
      required: true
      
    - key: "usage_kwh"
      type: "number"
      description: "Total electricity usage in kWh."
      required: false
```

### 2.4 The Actions (Workflow)
Defines *what happens* after data is extracted.

```yaml
  actions:
    # 1. Rename the file using extracted variables
    - type: "rename"
      pattern: "{due_date}_PGE_Bill_{total_amount}.pdf"
      
    # 2. Move to structured directory
    - type: "move"
      destination: "/Documents/Home/Utilities/Electricity/{year}/"
      
    # 3. Append to CSV Ledger
    - type: "log_csv"
      path: "/Finance/2024_Household_Expenses.csv"
      columns: ["due_date", "PGE", "total_amount", "usage_kwh"]
      
    # 4. Create Calendar Event (Optional)
    - type: "integration/calendar"
      provider: "google_calendar"
      title: "Pay PG&E Bill: ${total_amount}"
      date: "{due_date}"
      description: "Link to file: {folio_link}"
```

---

## 3. The "Global" Policies (Standard Pack)
Folio ships with 3 fundamental policies that handle the lifecycle of most documents.

### Policy A: The "Garbage Collector" (Priority: 999)
*   **Match:** Keywords ["Presorted Standard", "Current Resident", "Apply Now", "0% APR"].
*   **Extract:** None.
*   **Action:** Move to `/Trash/Auto_Delete_30Days`. Log "Blocked Junk Mail".

### Policy B: The "Inbox Zero" Fallback (Priority: 0)
*   **Match:** `*` (Matches everything that failed previous policies).
*   **Extract:** `Summary` (1-sentence description).
*   **Action:** Move to `/_Needs_Review`. Notify User: "Unrecognized document found."

### Policy C: The "Tax Dragnet" (Priority: 500)
*   **Match:** Keywords ["Form W-2", "1099-INT", "1098-T", "Internal Revenue Service"].
*   **Extract:** Tax Year, Form Type, Issuer, SSN (Last 4).
*   **Action:** Move to `/Financial/Taxes/{tax_year}/Raw_Docs/`. Alert User: "Tax Document Detected."

---

## 4. Execution Logic (The Engine Code)

When a document enters the system, the Engine runs this exact logic loop:

1.  **Load Policies:** Fetch all active YAML files (Local + Imported Packs).
2.  **Sort Policies:** Order by `metadata.priority` (Descending).
3.  **Iterate:**
    *   Run `match.conditions` for Policy 1.
    *   If **Match = True**:
        *   Stop iteration (First Match Wins strategy).
        *   Execute `extract`.
        *   **Derive Variables:** Run computed transformers (e.g., extract `year` from `due_date`).
        *   Validate `required` fields are present.
        *   Execute `actions`.
        *   Generate `manifest.json` sidecar file.
    *   If **Match = False**:
        *   Proceed to Policy 2.
4.  **Fallback:** If no match found by end of list $\rightarrow$ Execute **Policy B (Inbox Zero)**.

---

## 5. Advanced Features

### 5.1 Computed Variables (Transformers)
To keep paths clean, Folio automatically derives common variables from extracted data.

```yaml
  # In section 2.3
  extract:
    - key: "bill_date"
      type: "date"
      transformers:
        - name: "get_year"
          as: "year"   # Creates {year} for use in paths
        - name: "get_month_name"
          as: "month"  # Creates {month} (e.g., "January")
```

### 5.2 Multi-Page Splitting
If a policy is marked as `kind: Splitter`, it identifies page boundaries.
*   **Strategy:** "LLM-Boundary" (LLM looks at first/last lines of pages to find new document headers).

---

## 6. UX & Distribution Patterns

### 6.1 Policy Packs (The "Packs" System)
Policies can be bundled into JSON/YAML collections for easy sharing.
*   **Discovery:** Users can "Search for Packs" (e.g., "Sunnyvale Utilities").
*   **Pre-Configured:** Packs include verified regex/keywords for specific localized entities.

### 6.2 Natural Language Generation (AI-to-YAML)
The Folio UI provides a "Chat-to-Policy" interface.
*   **Input:** "Put my Tesla invoices in a Car folder."
*   **Logic:** Folio uses an internal LLM agent to:
    1.  Draft the `metadata.id` (e.g., `tesla-invoice`).
    2.  Select `match.conditions` (keyword: "Tesla").
    3.  Define `actions.move` (destination: "/Car/").
    4.  Save the YAML to `~/.folio/policies/user/`.

---

## 7. Error Handling
*   **Validation Failure:** If `total_amount` is required but not found $\rightarrow$ Trigger "Human Review" workflow.
*   **Hallucination Check:** If extracted date is `2025` but document says `2023` $\rightarrow$ Flag as "Date Mismatch".

---

## 8. Development Guidelines for Policies
*   **Idempotency:** Running a policy twice on the same file should result in the same outcome (no duplicate CSV rows).
*   **Modularity:** Policies are self-contained. Deleting a policy simply stops Folio from recognizing that document type.
*   **Readability:** Variable names in `extract` (`{total_amount}`) must match exactly in `actions` (`pattern: ...{total_amount}...`).
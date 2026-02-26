# Folio Hybrid Routing Architecture

This document visualizes the "Fast Path" vs "Heavy Path" routing architecture when determining if a document should be processed locally within Folio's Node.js runtime or delegated to the RealTimeX GPU worker.

## Architecture Diagram

```mermaid
graph TD
    classDef folio fill:#4f46e5,stroke:#312e81,color:white;
    classDef realtimex fill:#ea580c,stroke:#9a3412,color:white;
    classDef db fill:#059669,stroke:#064e3b,color:white;

    %% Entry
    A[New File Ingestion (UI/Watcher)] --> B{MIME / Extension Check}
    
    %% Smart Triage
    subgraph "Folio Application Layer (Local Node.js)"
      B -->|"Fast Path (.txt, .md, csv)"| C[Local Memory / String Extract]
      
      B -->|"? Check .pdf File Type"| B1{Smart Triage pdf-parse}
      B1 -->|"Extractable Text / Small"| C
      
      C --> D[rxt_activities: Insert Task]
      D --> E[Status: 'processing', Lock: 'folio']
      E --> F[Direct LLM Inference via SDK]
      F --> G[JSON Match & Policy Exec]
      
    end

    %% Heavy Path
    subgraph "Local Dropzone"
      B -->|"Heavy Path (Images)"| H([Write to Physical Dropzone Folder])
      B1 -->|"Image-only Scan / Massive PDF"| H
    end

    subgraph "Database Layer (Supabase)"
      H --> I[(rtx_activities)]
      E -.-> I
      I --> J[Status: 'pending', Lock: null, Payload: 'file_path']
    end

    subgraph "RealTimeX Desktop App (Hardware Accelerated)"
      J -->|"Claim Task"| K[RealTimeX Worker Queue]
      K --> L[Read Physical File via 'file_path']
      L --> M[Docling OCR / VLM Processing]
      M --> N[JSON Output Structured]
      N -->|"RPC: Complete Task"| I
    end

    %% Actuation
    I -->|"Webhook / Subscription"| O[Folio Actuator]
    O --> P{Check Policy Matches}
    G --> O
    P -->|"Move / Rename / Webhook"| Q[Final Organized Destination]
    
    %% Styling
    class A,B,C,D,E,F,G,O,P folio;
    class K,L,M,N realtimex;
    class I,J db;
```

## Workflow Summary

1. **Ingestion & Triage:** Folio receives a file. Simple text files bypass physical storage natively. PDFs hit a **Smart Triage** step: Folio attempts a fast text extraction using `pdf-parse`. If successful and small, it joins the text Fast Path.
2. **Database State (`rtx_activities`):** 
    - Fast Path files get an entry but bypass the queue (locked instantly by Folio).
    - Heavy Path files (Images, Scanned-PDFs) go to the Dropzone and into the queue as pending with a physical pointer.
3. **Hardware Delegation:** The heavy RealTimeX Desktop App strictly listens for pending binary pointers, keeping expensive GPU VRAM free from mundane parsing tasks.
4. **Unified Actuation:** No matter who parsed it (Folio or RealTimeX), the final JSON execution step always funnels back centrally to Folio's Action runner.

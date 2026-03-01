# Folio

Folio is an intelligent document processing and automation platform that acts as your personal AI-powered filing cabinet. Powered by advanced AI and Vision-Language Models, Folio ingests your documents, understands their content, and automatically organizes them according to your custom rules.

If you deal with invoices, receipts, reports, or any unstructured documents, Folio handles the heavy lifting of reading, extracting, and routing your data where it belongs.

## ✨ Key Features

- **Intelligent Ingestion**: Simply drop in PDFs, images, or raw text. Folio automatically reads and extracts the context, using high-speed Vision-Language Models (VLMs) for images.
- **Folio Policies**: Create powerful "If X, then Y" automation rules. Teach Folio to recognize specific types of documents and run actions automatically.
- **Smart Auto-Renaming**: Say goodbye to messy file names like `scan_001.pdf`. Folio can intelligently suggest and automatically rename files based on their actual content (e.g., `2026-02-28_Amazon_Invoice.pdf`).
- **Seamless Cloud Integrations**: 
  - **Google Drive**: Automatically route and copy specific files into designated cloud folders.
  - **Google Sheets**: Accurately extract tabular data (like expenses or ledger entries) and automatically append new rows directly to your spreadsheets.
- **Semantic Search & AI Chat**: Stop hunting for files. Folio creates a dynamic semantic index (RAG) of your documents, allowing you to search by concept or chat directly with your entire document library.
- **Transparency & Control**: Watch exactly what the AI is doing in real-time with the **LiveTerminal** trace logs. 

## 🚀 Getting Started

Folio is designed to be run locally on your machine while securely syncing data to your own designated cloud backend. 

### Prerequisites
- The [RealTimeX Desktop App](https://realtimex.ai) installed on your machine.
- A [Supabase](https://supabase.com) account (for your dedicated database).

### Installation

1. **Install from Marketplace:**
   Open the RealTimeX Desktop App, navigate to the **Marketplace**, and install **Folio**.
   *(Folio runs natively inside the RealTimeX runtime, so no Node.js installation is required).*
2. **Configure your Database:**
   Follow the Setup Wizard in your browser. You can use **Zero-Config Cloud Provisioning** to automatically set up a secure Supabase project, or manually provide an existing Supabase URL and Key.
3. **Connect your Integrations:**
   Head to the **Configuration** tab in the Folio dashboard to connect your local LLM providers and authorize Google Drive/Sheets.

## 🛠️ For Developers

Folio is highly extensible and built on a robust, modern stack:
- **Frontend**: React + Vite + Tailwind CSS
- **Backend / API**: Local Express Runtime + RealTimeX SDK
- **Database**: Remote Supabase (PostgreSQL + pgvector for RAG)
- **Extensibility**: The Action Engine is modular, allowing easy creation of new plugin handlers.

### Local Development

To run the full stack locally for contribution:

```bash
# Install dependencies
npm install

# Start the local API backend
npm run dev:api

# Start the frontend dev server
npm run dev
```

If you modify the database schema, apply migrations using:
```bash
npm run migrate
```

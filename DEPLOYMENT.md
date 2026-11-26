# KRESNA — Self-Hosted Local Deployment Guide

KRESNA runs as a lightweight, self-hosted conversational AI stack using **Docker Compose** (`kresna` + `ollama` + `qdrant`) with disk-backed **SQLite (`data/kresna.db`)** and **Local Single-User Mode** (no sign-in or external cloud keys required).

> **Security Notice (Local Development & Testing Only)**
> `docker-compose.yml` binds all ports strictly to `127.0.0.1` (`127.0.0.1:3000`, `127.0.0.1:11434`, `127.0.0.1:6333`). Do **not** expose the administrative dashboard or `/api/*` admin endpoints to the public internet while `LOCAL_SINGLE_USER_MODE=true`.

---

## 1. Windows 10 / 11 Setup (Docker Desktop + PowerShell)

### Prerequisites
1. Install **Docker Desktop for Windows** (with WSL 2 backend enabled) and ensure it is running.
2. Open **PowerShell** and navigate to the cloned/extracted KRESNA directory:
   ```powershell
   cd C:\path\to\kresna
   ```
3. Copy `.env.example` to `.env` and optionally set a persistent encryption key:
   ```powershell
   Copy-Item .env.example .env
   ```

### Start the Stack
```powershell
docker compose up -d --build
```
Verify all three containers (`kresna-app`, `kresna-ollama`, `kresna-qdrant`) are running:
```powershell
docker compose ps
```

### Pull Recommended Local Ollama Models
KRESNA never hardcodes fake installed models. Pull at least one chat model and one embedding model into the local `ollama` container:
```powershell
# Recommended chat models (pick one or both)
docker compose exec ollama ollama pull llama3.1:8b
docker compose exec ollama ollama pull qwen2.5:7b

# Recommended embedding model for Qdrant Hybrid RAG
docker compose exec ollama ollama pull nomic-embed-text
```
Verify installed models:
```powershell
docker compose exec ollama ollama list
```

### Open & Verify KRESNA
1. Open your browser directly to:
   - `http://127.0.0.1:3000`
2. KRESNA opens directly into **My Workspace** as **Local Admin** (no login/registration).
3. Go to **AI Models** -> click **Refresh Installed Models** to verify Ollama (`http://ollama:11434`) discovers your pulled models and Qdrant (`http://qdrant:6333`) reports healthy.
4. Go to **Knowledge** to upload `.xlsx`, `.csv`, `.pdf`, `.docx`, `.txt`, `.html` files or ingest a URL, then test retrieval in the **Hybrid Retrieval Tester**.
5. Test a conversation in **Create Chatbot** or **My Chatbots -> Playground**, or run **Settings -> Regression Evaluation Suite (Scenarios A–J)**.

---

## 2. Linux / macOS Quick Start

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec ollama ollama pull llama3.1:8b
docker compose exec ollama ollama pull nomic-embed-text
```
Open `http://127.0.0.1:3000`.

---

## 3. Running Locally Without Docker (Node.js 22+)

If you run Ollama (`http://localhost:11434`) and Qdrant (`http://localhost:6333`) natively on your host:
```bash
npm install
npm run migrate
OLLAMA_BASE_URL=http://localhost:11434 QDRANT_URL=http://localhost:6333 npm run dev
```

---

## 4. Database Migrations, Backup & Restore

### Run Non-Destructive Schema Migrations
```bash
npm run migrate
```
Existing Phase 1 records in `data/kresna.db` are preserved and unchunked `knowledge_items` are backfilled into `knowledge_chunks` and `knowledge_chunks_fts`.

### Backup (Windows PowerShell)
```powershell
.\scripts\backup.ps1
```
Creates a timestamped consistent SQLite `VACUUM INTO` snapshot, copies `data/uploads`, and archives the `qdrant_data` volume into `.\backups\<timestamp>\`.

### Restore (Windows PowerShell)
```powershell
.\scripts\restore.ps1 -BackupDir .\backups\<timestamp>
```

### Backup & Restore (Linux / macOS)
```bash
chmod +x scripts/backup.sh scripts/restore.sh
./scripts/backup.sh
./scripts/restore.sh ./backups/<timestamp>
```

# 🛡️ Simplifyr

**Simplify the signal. Preserve the truth.**

![Python](https://img.shields.io/badge/Python-3.14-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-local_LLM-000000?style=for-the-badge&logo=ollama&logoColor=white)
[![Hugging Face](https://img.shields.io/badge/Hugging_Face-Simplifyr1.5b-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black)](https://huggingface.co/Sking0123/Simplifyr1.5b)
![Docker](https://img.shields.io/badge/Docker-compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Tests](https://img.shields.io/badge/tests-274_passing-brightgreen?style=for-the-badge)

**Simplifyr** is a Universal Log Pre-processing Framework (ULPF). It ingests messy,
heterogeneous logs from firewalls, servers and network boxes, figures out what each
field *means*, and emits clean, standardized, user-defined output — **without losing
the original event** and **without you hand-writing parsers**.

> Not a SIEM, firewall, data lake, or chatbot. Simplifyr is the
> **semantic-normalization layer** that sits between your noisy devices and your
> SIEM / analytics / ML downstream.

## ⚙️ How it works

## 🎥 Demo Video

[![Watch Demo](https://img.shields.io/badge/▶_Watch_Demo-Google_Drive-4285F4?style=for-the-badge&logo=google-drive&logoColor=white)](https://drive.google.com/file/d/19NJiCJb9eSOgWFk-ofpo5eyFZ0_P1zTD/view?usp=sharing)

```
raw log ──▶ DETECT ──▶ PARSE ──▶ NORMALIZE ──▶ OUTPUT ──▶ your SIEM / lake / webhook
  (syslog,      (format)    (fields)   (semantic      (your
   JSON, CEF,                                  fields)      schema)
   LEEF…)
                    │  unknown shape?       │  structure changed?
                    ▼                       ▼
              🟡 QUARANTINE ──────▶ 🟠 DRIFT QUEUE ──▶ approve ──▶ new mapping version
              (held, never lost)   (one item per field-shape, auto-named)
```

- **Known shape?** Normalizes instantly through the published mapping. Zero clicks.
- **New shape?** Held in quarantine + one drift item per *field-shape* (100 identical
  anomalies = 1 item, not 100). Approve once → mapping versioned, whole pile
  reprocesses itself out of quarantine.
- **Garbage?** Dead-letters separately. Purge-all per type, one confirm.

## ✨ What it does

| Area | Highlights |
|---|---|
| 📥 **Ingest** | Syslog UDP/TCP listeners, HTTP API, file tail, Kafka ingress, batch endpoint (100k lines), Trial Run panel with live throughput |
| 🧩 **Normalize** | Syslog / JSON / XML / CSV / CEF / LEEF parsers → 26-field semantic catalog (`source.ip`, `network.action`, …) + custom-typed fields |
| 🗺️ **Mappings** | Versioned per-source knowledge, one row per lineage, recipe auto-binding, mapping delete with safe unbind |
| 🔍 **Review** | Grouped Telemetry Inspection (approve-all / purge-all per type), drift queue with AI proposals + confidence, human override |
| 📊 **Analytics** | Threat hunting, group-by aggregation, anomaly + correlation rules, pattern-wise **log dedupe** (paste/drop → first log per shape) |
| 📤 **Export** | JSON / NDJSON / CSV, uncapped, counts baked into file + filename — whole system or one trial's exact rows |
| 🤖 **Local AI** | Heuristic baseline built in; fine-tuned **Qwen2.5-1.5B** (`simplifyr:1.5b`) serves suggestions offline via Ollama — no API keys, ever |

## 🖥️ Application

<p align="center">
  <img src="docs/screenshots/Home.png" alt="Simplifyr Dashboard" width="92%">
</p>

<p align="center"><em>Dashboard — operational overview of sources, processing and system activity.</em></p>

### Connect and onboard

<p align="center">
  <img src="docs/screenshots/NewConnectionWizard.png" alt="Simplifyr Connection Wizard" width="48%">
  <img src="docs/screenshots/IndetailConnectionInfo.png" alt="Simplifyr Connection Overview" width="48%">
</p>

<p align="center"><em>Source onboarding and detailed connection configuration.</em></p>

### Mappings and adaptive knowledge

<p align="center">
  <img src="docs/screenshots/MappingVersions.png" alt="Simplifyr Mapping Versions" width="48%">
  <img src="docs/screenshots/AIKnowledge.png" alt="Simplifyr AI Knowledge" width="48%">
</p>

<p align="center"><em>Versioned mappings and the knowledge layer used to support adaptive processing.</em></p>

### Inspect and analyze events

<p align="center">
  <img src="docs/screenshots/RawLogs.png" alt="Simplifyr Raw Logs" width="48%">
  <img src="docs/screenshots/LogAnalytics.png" alt="Simplifyr Log Analytics" width="48%">
</p>

<p align="center"><em>Raw event inspection and analytics for processed telemetry.</em></p>

### Configure outputs

<p align="center">
  <img src="docs/screenshots/OutputProfiles%20Settings.png" alt="Simplifyr Output Profiles" width="70%">
</p>

<p align="center"><em>Output profiles for controlling the shape of normalized events delivered downstream.</em></p>

## 🤖 The AI story (all-local, RTX 3050-friendly)

No cloud, no keys. Two providers, one switch (`AI_PROVIDER`):

| Model | Mapping F1 | Drift | Abstain |
|---|---|---|---|
| Heuristic (default, instant) | 0.9333 | 1.0 | 1.0 |
| Generic `qwen2.5:1.5b` | 0.0 | 0.75 | 0.0 |
| 🟢 **`simplifyr:1.5b` v2 (ours)** | **1.0** | **1.0** | **1.0** |

- Trained on 2,406 instruction pairs (human approvals + synthetic bootstrap) with
  QLoRA on a 4 GB RTX 3050; merged + GGUF'd to Ollama (~6 tok/s — plenty for
  short suggestions, heuristic fallback on every call).
- The eval gate (`tests/golden/`, `run_eval()`) fails any provider change that
  scores below baseline. Full runbook: [`training/README.md`](training/README.md).
- Serve it: `AI_PROVIDER=ollama OLLAMA_MODEL=simplifyr:1.5b` (or `backend/.env`),
  or `ollama pull hf.co/Sking0123/Simplifyr1.5b` on any machine.

### 🤗 Fine-tuned model on Hugging Face

[![Model on HF](https://img.shields.io/badge/🤗_Model-Sking0123/Simplifyr1.5b-FFD21E?style=for-the-badge)](https://huggingface.co/Sking0123/Simplifyr1.5b)
[![Mapping F1](https://img.shields.io/badge/Mapping_F1-1.0-brightgreen?style=for-the-badge)](https://huggingface.co/Sking0123/Simplifyr1.5b)
[![Drift](https://img.shields.io/badge/Drift-1.0-brightgreen?style=for-the-badge)](https://huggingface.co/Sking0123/Simplifyr1.5b)
[![Abstain](https://img.shields.io/badge/Abstain-1.0-brightgreen?style=for-the-badge)](https://huggingface.co/Sking0123/Simplifyr1.5b)
[![GGUF + safetensors](https://img.shields.io/badge/GGUF_+_safetensors-Ollama_·_Transformers-blue?style=for-the-badge)](https://huggingface.co/Sking0123/Simplifyr1.5b)

> **Sking0123/Simplifyr1.5b** — our Qwen2.5-1.5B fine-tune for log-field → semantic
> mapping, with GGUF (Ollama) + fp16 safetensors (Transformers), training details,
> eval scores, and one-line pull instructions. Star it if it helps your SOC. ⭐

## 🧰 Tech stack

| Layer | Tech |
|---|---|
| API | **FastAPI** + SQLAlchemy 2 + Alembic migrations (SQLite dev / Postgres prod) |
| Pipeline | Deterministic `ProcessingEngine`, asyncio workers, Kafka-swappable bus |
| AI | PyTorch + transformers + PEFT/QLoRA (train) · **Ollama** (serve) |
| UI | **React 18 + TypeScript + Vite + Tailwind**, WebSocket live views |
| Infra | Docker Compose (Postgres · Redis · MinIO · Kafka · Ollama), Prometheus `/metrics` |
| Quality | **274 pytest tests** (+3 PG-gated), `tsc` + `oxlint` clean per commit |

## 🚀 Quickstart

```powershell
# backend (from backend/ so backend/.env loads)
D:\...\SIMPLIFYR_2\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# frontend (from frontend/)
npm install
npm run dev        # → http://localhost:5173 (proxies /api → :8000)
```

```powershell
# or everything at once
docker compose up -d
docker compose exec ollama ollama pull hf.co/Sking0123/Simplifyr1.5b
```

```powershell
# tests (repo root)
.\.venv\Scripts\python.exe -m pytest tests -q
```

## 🗂️ Repo layout

```
backend/            FastAPI app (engine, APIs, AI layer, migrations)
frontend/           React console (Home, Connections, Analytics, Review Queue, Settings)
parsers/            Format detection + parsers (syslog, JSON, XML, CSV, CEF, LEEF…)
packages/           Shared domain libs (event/semantic/mapping/output-profile models)
training/           Fine-tune pipeline (data, scripts, Modelfile, runbook)
tests/              274 tests incl. golden AI gate + migration-chain pin
scripts/             Dev utilities (firehose log generator…)
sample-data/        Golden fixtures · docs/  design notes
```

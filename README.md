# Requirements Engine

A minimal, local demonstration of **stakeholder interviews → requirements → SDLC recommendations**, with retrieval from four real external PDFs. OpenRouter free models provide live generation. Local sentence embeddings provide retrieval without an embedding API key.

## Run the prepared project

Requires Node.js 24 or newer. On this machine the dependencies, PDFs, embedding model, and index have already been prepared.

```powershell
node --env-file-if-exists=.env server.js
```

Open **http://127.0.0.1:3000**. On Windows, `Start Engine.cmd` runs the same command. Set `PORT` in `.env` if port 3000 is occupied.

Source citations open a small page viewer showing a rendered image of the original PDF page, with previous/next controls and the original PDF download. This also works in browsers that cannot display native PDFs. Page images are generated on demand with Poppler and cached under `data/page-previews/`.

## A short professor demonstration

1. Click **New project** and **Try the example project** to load synthetic fraud-detection interviews. Or create a project and choose your own stakeholder roles.
2. Show the three stages: **Interview**, **Requirements**, **Recommendation**. The interface has no dashboard or sidebar.
3. Open **PDF sources (4)**. Show the real publications, their PDF links, and the optional RAG pipeline explanation.
4. Search the PDFs for `uncertain requirements and technical risks in spiral development`. Open a result at its cited PDF page.
5. In **Requirements**, inspect the original stakeholder evidence. For a new project, confirm proposals individually or with **Confirm all**.
6. In **Recommendation**, click **Recommend SDLC**. If evidence is incomplete, an explicitly provisional result is available instead.
7. Show the leading lifecycle approach, alternatives, original PDF passages, and the optional four specialist analyses. Download the Markdown report if useful.

**Demo mode runs real local PDF retrieval and the actual scoring rubric, but its extraction/follow-up text and specialist narratives are deterministic examples.** For a live agent demonstration, configure your key first. Do not present demo narratives as generated LLM analysis.

## Connect OpenRouter

Click **Connection**, enter your [OpenRouter API key](https://openrouter.ai/settings/keys), choose **Live**, and save. Leave the model as `openrouter/free` or enter an available model ID ending in `:free`. The app rejects paid model IDs and does not silently fall back to paid inference or demo output.

The key is held in local server memory and never returned by the API or included in project exports. It disappears on restart. For persistence, copy `.env.example` to `.env` and set `OPENROUTER_API_KEY` there. `.env` is ignored by Git.

Live generation sends project evidence and retrieved PDF passages to OpenRouter and its chosen provider. Use synthetic or appropriately redacted data for this demonstration. Free-provider quotas, availability, and JSON support vary; a rate limit receives one bounded retry and then a clear error.

## The concrete PDF corpus

The complete source manifest is `corpus/sources.json`. The downloaded PDFs retain their original rights and attribution notices.

| Publication | Publisher | Version | Physical PDF pages |
|---|---|---|---|
| [The Scrum Guide](https://scrumguides.org/docs/scrumguide/v2020/2020-Scrum-Guide-US.pdf) | Schwaber and Sutherland | November 2020 | 14 |
| [Spiral Development Experience Principles and Refinements](https://www.sei.cmu.edu/documents/5439/2000_003_001_13655.pdf) | Carnegie Mellon SEI | CMU/SEI-2000-SR-008 | 49 |
| [Secure Software Development Framework](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-218.pdf) | NIST | SP 800-218 v1.1, 2022 | 36 |
| [NASA Systems Engineering Handbook](https://www.nasa.gov/wp-content/uploads/2018/09/nasa_systems_engineering_handbook_0.pdf) | NASA | SP-2016-6105 Rev 2 | 297 |

There are **396 PDF pages and 1,282 indexed passages** in the prepared index. These are actual extracted passages, not model-written summaries. They provide general requirements/lifecycle/security guidance. They are not a financial-regulation corpus, and NASA-specific processes are not assumed to be binding on financial projects. Published page labels may differ from physical PDF page numbers; citations use the physical page counted from the first page.

## How RAG works

```text
Official PDF publications
  → pypdf extraction, preserving each PDF page
  → 160-word passages with 35-word overlap, never crossing pages
  → normalized 384-dimensional MiniLM sentence embeddings
  → persisted local vector index + document checksums

Stakeholder answer / specialist question
  → query embedding computed locally
  → cosine similarity + BM25 lexical retrieval
  → weighted reciprocal-rank fusion (70% dense / 30% lexical)
  → selected passages included in the OpenRouter prompt
  → findings cite chunk IDs and quote original text
  → validation and links back to source PDF pages
```

The embedding model is `Xenova/all-MiniLM-L6-v2`, using Transformers.js and a quantized CPU ONNX model. It downloads once during setup and is cached under `data/models/`. Runtime retrieval disables remote model downloads. Query text is embedded locally. There is no separate embedding API, vector hosting account, or paid dependency.

Vectors are persisted in `corpus/index.json` and searched with cosine similarity in-process; a separate vector database server is unnecessary for this small corpus. The lexical component complements semantic retrieval for exact terminology. Results include document identity, physical page, source URL, file SHA-256, passage ID, and retrieval scores. Source PDFs are checksum-verified when loading the index.

During interviews, the query combines the role, latest answer, and missing decision topics; up to four PDF passages enter the prompt. During analysis, an initial search and each specialist's focused query retrieve relevant passages. Each agent receives a frozen project snapshot, its passages, and earlier specialist findings. The app stores retrieved passages with the successful interview response or analysis run for later inspection.

Each specialist finding must cite valid stakeholder messages, valid retrieved PDF chunk IDs, and a verbatim quote found in the cited passage. Invalid IDs or invented quotes fail that agent and mark the run incomplete. **These checks establish provenance and literal quote correctness, not logical entailment or legal correctness.** Human review is still needed.

The previous starter-summary corpus is no longer used by retrieval. Existing saved analyses are retained and labelled as older runs; regenerate them to obtain PDF-grounded results.

## The agent and ranking

The interview agent extracts source-linked proposed requirements, decision factors, conflicts, and follow-up questions. It cannot invent stakeholder answers or approve requirements. The user chooses stakeholders and confirms extracted requirements.

The readiness gate checks eight decision factors, a confirmed requirement, closed/omitted selected interviews, and no unresolved conflicts. Unknown factors use 3/5 only in explicitly provisional runs. Conflicts can be resolved under **What information is still needed?**

Four bounded roles run sequentially to reduce free-tier concurrency pressure:

1. Requirements reviewer.
2. Risk and assurance analyst.
3. Delivery analyst.
4. Recommendation reviewer.

They may use the same underlying LLM. Their agreement is not independent evidence of correctness. No agent executes arbitrary tools or changes approved evidence.

The numerical ranking remains a separate, inspectable heuristic:

```text
score = 100 × weighted average(1 − abs(observed − ideal) / 4)
```

It compares Agile/incremental, Spiral, V-Model, Waterfall/sequential, and incremental delivery with assurance gates. Profiles and weights are in `src/engine.js`. DevSecOps/security practices complement the lifecycle. The PDFs inform agent reasoning; they do not turn the hand-authored rubric into a scientifically validated classifier. Scores are suitability values, not probabilities. The saved result includes one-factor sensitivity checks.

## Rebuild on a fresh machine

Use Node.js 24+, Python, Poppler, and the packages pinned by the lockfile / requirements file. Poppler is already available in this workspace. On another machine, install Poppler and put `pdftoppm` on PATH, or set its full path in `PDFTOPPM_PATH`. It is needed only for original-page image previews; PDF retrieval itself uses the prepared vector index.

```powershell
# npm can install the runtime library; alternatively use pnpm install.
npm install
python -m pip install -r requirements.txt

# Download official PDFs and extract their text.
python scripts/prepare-corpus.py

# Download the embedding model once and index all passages.
node scripts/index-corpus.js

# Start the local application.
node --env-file-if-exists=.env server.js
```

This workspace was installed with pnpm; `pnpm-lock.yaml` pins its dependencies and `pnpm-workspace.yaml` explicitly allows required native package installation scripts. If using pnpm on a CPU-only Linux machine, set `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` before installation to avoid optional CUDA downloads. Internet access is required during initial setup and for live OpenRouter generation, but not for prepared-corpus retrieval.

To change sources, edit `corpus/sources.json` and rerun both preparation scripts. The downloader reuses existing filenames; to intentionally replace an existing source, archive its old local PDF first. The extraction script does not implement OCR for scanned PDFs.

## Files and storage

| Path | Purpose |
|---|---|
| `public/app.js`, `public/styles.css` | Minimal three-stage UI |
| `server.js` | HTTP API, project workflow, provider orchestration |
| `src/rag.js` | Chunking, semantic/lexical fusion, retrieval and provenance |
| `src/embeddings.js` | Local embedding model |
| `src/pdf-preview.js` | Render original PDF pages for source inspection |
| `scripts/prepare-corpus.py` | PDF download and page text extraction |
| `scripts/index-corpus.js` | Build and persist passage vectors |
| `corpus/sources.json` | External publications and provenance |
| `corpus/pdfs/`, `corpus/pages.json`, `corpus/index.json` | Generated corpus assets, ignored by Git |
| `src/llm.js` | OpenRouter requests, structured prompts, errors |
| `src/engine.js` | Readiness, source validation and ranking |
| `src/store.js` | SQLite state and audit events |
| `src/export.js` | Frozen Markdown / JSON / CSV exports |
| `data/engine.sqlite` | Local projects; ignored by Git |

Snapshots preserve the requirements, transcripts, factors, retrieved passages, corpus fingerprint, and model information used for each run. Requirement edits retain prior versions. Failed interview calls leave saved state unchanged; the browser keeps the answer for retry. Analysis progress is saved role by role. Restarted analyses are marked interrupted. Same-project writes are locked while model operations run, and revision checks reject stale writes.

## Verify

```powershell
node --test test/*.test.js
node --check server.js
node --check public/app.js
```

The suite separates synthetic HTTP-contract fixtures from real PDF tests. The latter verify checksums, passage/page correspondence, normalized vectors, and retrieval against all four publications with the actual local embedding model. Real-corpus tests are skipped on a fresh clone before setup; for the demonstration, run them after setup with no skipped checks. Provider-generation tests use mocked OpenRouter responses; testing real generation requires your key.

This is a single-user, loopback-only academic MVP. It has no institutional accounts, production deployment, legal compliance verification, database encryption, speech input, or arbitrary PDF upload UI. Those features are outside the current demonstration scope.

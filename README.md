# SDLC Requirements Engineering Engine

An academic software engineering prototype for gathering stakeholder requirements and recommending a suitable Software Development Life Cycle (SDLC) approach. The project focuses on financial software scenarios and combines conversational requirement elicitation, Retrieval-Augmented Generation (RAG), and multi-agent analysis.

## Objectives

- Collect requirements through conversations with user-selected stakeholders.
- Identify functional and non-functional requirements, missing information, and conflicts.
- Maintain traceability between requirements and stakeholder statements.
- Support SDLC recommendations with evidence from published engineering documents.

## Methodology

The application follows three stages:

1. **Interview:** Gather stakeholder input and ask clarification questions.
2. **Requirements:** Review and confirm the extracted requirements.
3. **Recommendation:** Compare SDLC approaches using project characteristics and specialist analysis.

Four specialist roles review requirements, risk and assurance, delivery constraints, and the final recommendation. A separate weighted rubric ranks Agile/incremental, Spiral, V-Model, Waterfall, and incremental delivery with assurance gates. These scores represent heuristic suitability, not probabilities.

## RAG Knowledge Corpus

The system retrieves passages from four external PDFs:

- [The Scrum Guide](https://scrumguides.org/docs/scrumguide/v2020/2020-Scrum-Guide-US.pdf) — Schwaber and Sutherland, 2020.
- [Spiral Development Experience Principles and Refinements](https://www.sei.cmu.edu/documents/5439/2000_003_001_13655.pdf) — Carnegie Mellon SEI, 2000.
- [Secure Software Development Framework](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-218.pdf) — NIST SP 800-218 v1.1, 2022.
- [NASA Systems Engineering Handbook](https://www.nasa.gov/wp-content/uploads/2018/09/nasa_systems_engineering_handbook_0.pdf) — NASA, Revision 2, 2016.

PDF text is extracted by page, divided into overlapping passages, and embedded locally using `Xenova/all-MiniLM-L6-v2`. Semantic similarity and BM25 keyword retrieval select passages for the LLM context. Citations link findings to original PDF pages. Source metadata is recorded in `corpus/sources.json`.

These publications provide general engineering guidance; they do not constitute a financial-regulation corpus.

## Technology Stack

- **Interface:** HTML, CSS, and JavaScript.
- **Backend and storage:** Node.js 24+ and SQLite.
- **Generation:** OpenRouter free models.
- **Retrieval:** Transformers.js, local MiniLM embeddings, and BM25.
- **PDF processing:** Python with pypdf; Poppler for page previews.

## Installation and Execution

Install Node.js 24+, Python, and Poppler. Ensure `pdftoppm` is on PATH, or configure `PDFTOPPM_PATH` in `.env`.

```bash
npm install
python -m pip install -r requirements.txt
python scripts/prepare-corpus.py
node scripts/index-corpus.js
node --env-file-if-exists=.env server.js
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). PDF downloads and embedding-model preparation require internet access during initial setup. Generated corpus assets, model files, and local project data are excluded from Git.

## Usage

Create a project, select stakeholders, conduct interviews, and confirm the extracted requirements before requesting an SDLC recommendation. The supplied synthetic example can be used for demonstration.

Under **Connection**, enter an OpenRouter API key, select **Live**, and use `openrouter/free` as the model. Alternatively, configure the key through a local `.env` file using `.env.example` as a template. Never commit API keys.

**Demo mode** uses real PDF retrieval but scripted responses and keyword-based extraction. **Live mode** uses OpenRouter for requirement extraction, adaptive interviews, and specialist reasoning.

## Testing and Limitations

Run the automated tests with:

```bash
node --test test/*.test.js
```

Tests cover requirement provenance, readiness checks, retrieval, PDF citations, scoring, and API behaviour. Complete corpus setup first to run the real-PDF checks. OpenRouter generation is tested with mocked responses; real inference requires a valid key.

The project is a single-user academic prototype. Citation checks verify source IDs and quoted text, but do not establish that every conclusion follows from its source. Requirements and recommendations require human review, and the selection rubric requires independent expert validation.

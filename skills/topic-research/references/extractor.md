# Single-document extractor brief

Give this to a lightweight worker (e.g. `invoke_subagent(..., Model="flash")` on Antigravity, or a parallel worker in `run_workflow`) that screens and extracts verbatim evidence from **one or a small batch of individual documents** without polluting the main context.

```text
You are a single-document evidence extractor for topic-research. The run directory is <DIR>.
Your worker tag is `<WORKER_ID>`. Focus on questions: <QUESTION_IDS>.

Inputs:
- Read `<DIR>/brief.md` (scope, constraints, exclusions, Q1..Qn) and `<SKILL_DIR>/references/rubric.md` (acceptance axes).
- Target document(s) / raw file(s) to screen and extract:
  <LIST OF URLS / ARXIV IDS / REPOS / RAW JSON PATHS>

Tools:
- Retrieval CLI (only if target is not yet saved in raw/): `python3 "<SKILL_DIR>/scripts/research.py"`
  - Always pass `--save <DIR>/raw/<file>.json` (and `--brief` for search calls).
- Evidence CLI: `python3 "<SKILL_DIR>/scripts/report.py"`

Hard rules (single-document fidelity):
1. Screen for usefulness FIRST: judge each document against brief.md scope and rubric.md (must match topic AND be frontier,
   practical, or high-performance). Immediately drop navbars, SEO fluff, marketing copy, or off-topic pages (R <= 1) — do NOT
   pollute `evidence.jsonl` with low-signal quotes.
2. ONE document at a time — NEVER merge, summarize, or compress multiple documents into a combined quote. Every `evidence` row
   must carry the single source's own verbatim wording (or exact table cells).
3. Register each qualifying work once via:
   `python3 "<SKILL_DIR>/scripts/report.py" source "<DIR>" --url ... --title ... --kind ... --date ... --family ... --raw ... --by "<WORKER_ID>"`
   - Multiple pages of the same project/paper/repo MUST share the same `--family`.
   - `--date` is first publication (arXiv v1) or first release; omit if unknown.
4. For every quote that decides relevance, an axis, a number, or a question answer, record it immediately via:
   `python3 "<SKILL_DIR>/scripts/report.py" evidence "<DIR>" --source S# --quote ... --locator ... --claim ... --conditions ... --question Q# --stance supports|contradicts|context --by "<WORKER_ID>"`
   (Or batch via `--from <DIR>/raw/batch-<WORKER_ID>.jsonl`.)
   - `--locator` MUST name the exact page, section, table, figure, or README heading.
   - `--conditions` MUST capture dataset, version, model, judge, baseline, hardware, or date whenever numbers appear.
   - Explicitly extract negative results, failure modes, and caveats with `--stance contradicts`.
5. Never write `analysis.md`, `outline.md`, `draft.md`, or `report.md`. Put optional per-document reading notes in
   `<DIR>/notes/<WORKER_ID>.md`.

Reply concisely (<= 8 lines):
- Registered source IDs (`S#`) and count of evidence quotes (`E#`) added
- Dropped URLs/docs with 1-phrase rejection reasons
- Optional notes path (`notes/<WORKER_ID>.md`)
- Key remaining blind spots or missing full-text reads (do NOT paste raw quotes or source text into the reply).
```

"""Antigravity `run_workflow` script for Diamond 2 Part 1 (`topic-research` · 发散 2):
Parse prioritized `[核心必读]` leads from `outline.md` ->
Parallel isolated single-document full-text reading & usefulness extraction (`flash` workers via `references/extractor.md`) ->
Deterministic coverage & counter-evidence audit ->
Targeted Gap & Counter-Evidence Round (strong model).

Invoke via Antigravity's `run_workflow` tool:
    run_workflow(
        ScriptPath="/path/to/topic-research/scripts/gather_evidence_workflow.py",
        Description="Diamond 2 (Fan-out): parallel single-doc extraction and gap round",
        Args={
            "run_dir": "/abs/path/to/run_dir",
            # optional overrides:
            # "tier": "deep",              # auto-read from brief.md if omitted
            # "skill_dir": "/abs/path/to/topic-research",
            # "extractor_model": "flash",  # flash | inherit
            # "planner_model": "inherit",  # strong model for gap & counter-evidence round
            # "max_reads": 24,             # default 12 for quick, 24 for deep
            # "batch_size": 3,             # documents per isolated extractor batch
            # "min_quotes_per_q": 3,
            # "run_gap_round": True,
        },
    )
"""
from __future__ import annotations

import json
import os
import re
import subprocess


# ---------------------------------------------------------------- helpers

URL_RE = re.compile(r"https?://[^\s<>()\[\]{}\"'`“”‘’、，。；（）]+", re.I)


def _read_text(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def _read_jsonl(path: str) -> list:
    if not os.path.isfile(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _detect_tier(brief_text: str) -> str:
    m = re.search(r"^\s*-\s*Tier\s*[:：]\s*(quick|deep)\b", brief_text, re.I | re.M)
    return m.group(1).lower() if m else "deep"


def _brief_questions(brief_text: str) -> list:
    return re.findall(r"^\s*-\s*(Q\d+)\s*[:：]\s*\S", brief_text, re.M)


def _canon_url_key(url: str) -> str:
    u = url.rstrip(".,;:!?，。；：！？\"'`”’」』】》）)/")
    m_ax = re.search(r"(?:arxiv|alphaxiv)\.org/(?:abs|pdf|html)/(\d{4}\.\d{4,5})", u, re.I)
    if m_ax:
        return f"arxiv:{m_ax.group(1)}"
    m_gh = re.search(r"github\.com/([^/]+/[^/#?]+)", u, re.I)
    if m_gh:
        return f"gh:{m_gh.group(1).lower()}"
    return f"url:{u.lower()}"


def _parse_outline_leads(outline_text: str) -> list:
    """Extract leads from outline.md subsections, placing [核心必读]/[must-read] first."""
    subs = re.split(r"(?=^###\s+S\d+\.\d+)", outline_text, flags=re.M)[1:]
    must_reads, extended = [], []
    seen = set()
    for sub in subs:
        lines = sub.splitlines()
        hdr = lines[0].strip()
        sub_id_m = re.match(r"^###\s+(S\d+\.\d+)", hdr)
        sub_id = sub_id_m.group(1) if sub_id_m else "S?"
        qs = sorted(set(re.findall(r"\bQ\d+\b", sub)), key=lambda x: int(x[1:]))
        m_leads = re.search(r"^####\s+(?:来源线索|Source Leads?)\s*$\n(.*?)(?=^####\s+|^###\s+|^##\s+|\Z)", sub, re.I | re.M | re.S)
        if not m_leads:
            continue
        for ln in m_leads.group(1).splitlines():
            urls = [u.rstrip(".,;:!?，。；：！？\"'`”’」』】》）)") for u in URL_RE.findall(ln)]
            if not urls:
                continue
            is_core = bool(re.search(r"\[(?:核心必读|must-read)\]", ln, re.I))
            for u in urls:
                key = _canon_url_key(u)
                if key in seen:
                    continue
                seen.add(key)
                item = {
                    "url": u,
                    "key": key,
                    "subsection": sub_id,
                    "section_heading": hdr[4:].strip(),
                    "questions": qs,
                    "priority": "must-read" if is_core else "extended",
                    "note": ln.strip()[:220],
                }
                (must_reads if is_core else extended).append(item)
    return must_reads + extended


def _compute_coverage(run_dir: str, qs: list) -> dict:
    sources = _read_jsonl(os.path.join(run_dir, "sources.jsonl"))
    evidence = _read_jsonl(os.path.join(run_dir, "evidence.jsonl"))
    per_q = {q: 0 for q in qs}
    contradicts = 0
    for e in evidence:
        q = e.get("question")
        if q in per_q:
            per_q[q] += 1
        if e.get("stance") == "contradicts":
            contradicts += 1
    families = {s.get("family") or s.get("key") for s in sources}
    return {
        "sources_total": len(sources),
        "families_total": len(families),
        "evidence_total": len(evidence),
        "contradicts_total": contradicts,
        "per_question_counts": per_q,
    }


BATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "batch_id": {"type": "string"},
        "sources_added": {"type": "array", "items": {"type": "string"}},
        "evidence_count": {"type": "integer"},
        "dropped": {"type": "array", "items": {"type": "string"}},
        "js_blocked_urls": {"type": "array", "items": {"type": "string"}},
        "notes_path": {"type": "string"},
    },
    "required": ["batch_id", "sources_added", "evidence_count"],
}

GAP_SCHEMA = {
    "type": "object",
    "properties": {
        "sources_added": {"type": "array", "items": {"type": "string"}},
        "evidence_count": {"type": "integer"},
        "contradicts_added": {"type": "integer"},
        "resolved_hypotheses": {"type": "array", "items": {"type": "string"}},
        "remaining_gaps": {"type": "array", "items": {"type": "string"}},
        "outline_patched": {"type": "boolean"},
    },
    "required": ["sources_added", "evidence_count", "remaining_gaps"],
}


# ---------------------------------------------------------------- configuration

_run_dir_arg = args.get("run_dir")
if not _run_dir_arg:
    raise ValueError("Args must provide `run_dir` pointing to a Diamond 1 run directory with brief.md and outline.md.")

run_dir = os.path.abspath(os.path.expanduser(_run_dir_arg))
brief_path = os.path.join(run_dir, "brief.md")
outline_path = os.path.join(run_dir, "outline.md")
if not os.path.isfile(brief_path) or not os.path.isfile(outline_path):
    raise FileNotFoundError(f"brief.md and outline.md must exist in run_dir: {run_dir}")

_script_file = globals().get("__file__")
_default_skill = (
    os.path.dirname(os.path.dirname(os.path.abspath(_script_file)))
    if _script_file
    else os.path.expanduser("~/.gemini/config/skills/topic-research")
)
skill_dir = os.path.abspath(os.path.expanduser(args.get("skill_dir") or _default_skill))
research_script = os.path.join(skill_dir, "scripts", "research.py")
report_script = os.path.join(skill_dir, "scripts", "report.py")
extractor_brief_path = os.path.join(skill_dir, "references", "extractor.md")
rubric_path = os.path.join(skill_dir, "references", "rubric.md")

brief_text = _read_text(brief_path)
outline_text = _read_text(outline_path)
tier = (args.get("tier") or _detect_tier(brief_text)).lower()
if tier not in ("quick", "deep"):
    tier = "deep"

extractor_model = args.get("extractor_model") or "flash"
planner_model = args.get("planner_model") or "inherit"
max_reads = int(args.get("max_reads", 12 if tier == "quick" else 24))
batch_size = max(1, int(args.get("batch_size", 3)))
min_quotes_per_q = max(1, int(args.get("min_quotes_per_q", 2 if tier == "quick" else 4)))
run_gap_round = bool(args.get("run_gap_round", True))

os.makedirs(os.path.join(run_dir, "raw"), exist_ok=True)
os.makedirs(os.path.join(run_dir, "notes"), exist_ok=True)

qs = _brief_questions(brief_text)
log(f"Diamond 2 Gather start | tier={tier} | extractor={extractor_model} | max_reads={max_reads} | Qs={qs}")


# ---------------------------------------------------------------- Phase D0: Build Prioritized Lead Queue

phase("D0. 解析大纲 [核心必读] 线索队列")

existing_sources = _read_jsonl(os.path.join(run_dir, "sources.jsonl"))
existing_keys = {_canon_url_key(s.get("url", "")) for s in existing_sources if s.get("url")}
all_leads = _parse_outline_leads(outline_text)
pending_leads = [it for it in all_leads if it["key"] not in existing_keys][:max_reads]

batches = []
for idx in range(0, len(pending_leads), batch_size):
    chunk = pending_leads[idx : idx + batch_size]
    batches.append({"id": f"b{len(batches) + 1}", "items": chunk})

log(
    f"Parsed {len(all_leads)} unique outline leads "
    f"(already registered={len(existing_keys)}, queued={len(pending_leads)}, batches={len(batches)})"
)


# ---------------------------------------------------------------- Phase D1-D2: Parallel Single-Doc Extraction

phase("D1–D2. 并行整文精读与单文档抽取 (发散 2)")


async def extract_batch(batch: dict) -> dict:
    bid = batch["id"]
    target_lines = "\n".join(
        f"  {i}. [{it['priority']}] ({it['subsection']}, {', '.join(it['questions']) or 'Q1'}) {it['url']}\n     lead note: {it['note']}"
        for i, it in enumerate(batch["items"], 1)
    )
    prompt = f"""You are a single-document evidence extractor (`extract-{bid}`) in Diamond 2 of topic-research.
Follow `{extractor_brief_path}` strictly.

## Inputs
- Run directory: `{run_dir}`
- Brief: `{brief_path}`
- Acceptance rubric: `{rubric_path}`
- Extractor protocol: `{extractor_brief_path}`
- Retrieval CLI: `python3 "{research_script}"` (24h local cache is active on `fetch`/`pdf`; always pass `--save {run_dir}/raw/read-{bid}-<n>.json`)
- Evidence CLI: `python3 "{report_script}"`

## Target Documents (process strictly ONE document at a time)
{target_lines}

## Hard Rules
1. Choose the right full-text reader per document:
   - arXiv/alphaXiv paper URL -> `research.py pdf <arxiv_id> "<q1>" "<q2>" ... --save ...` (batch all questions about ONE paper in one call; falls back to `fetch` on arXiv HTML if needed).
   - GitHub repo URL -> `research.py repo OWNER/NAME --save ...`
   - Web/blog/docs/PDF URL -> `research.py fetch <url> --objective "<target focus>" --save ...`
   - If a page returns mostly navigation / JS-blocked empty text, record its URL in `js_blocked_urls` instead of guessing its content.
2. **Usefulness gate first**: drop off-topic, marketing-only, or `R <= 1` sources (list them in `dropped`).
3. **ONE document at a time — NEVER merge or summarize across multiple documents.** Register each qualifying source via `report.py source "{run_dir}" ... --by "extract-{bid}"` (shared `--family` for multi-page works), then log verbatim quotes via `report.py evidence "{run_dir}" --source S# --quote ... --locator ... --claim ... --conditions ... --question Q# --stance supports|contradicts|context --by "extract-{bid}"`.
4. Always extract explicit limitations, negative results, and caveats with `--stance contradicts`.
5. Never write `analysis.md`, `outline.md`, `draft.md`, or `report.md`. Return compact JSON via `finish`.
"""
    try:
        res = await agent(
            prompt,
            schema=BATCH_SCHEMA,
            role=f"Extractor {bid} ({len(batch['items'])} docs)",
            type_name="self",
            model=extractor_model,
        )
        return {"ok": True, "batch_id": bid, **res}
    except Exception as exc:
        log(f"Extractor batch `{bid}` failed (graceful degradation): {exc}")
        return {"ok": False, "batch_id": bid, "error": str(exc), "sources_added": [], "evidence_count": 0, "js_blocked_urls": []}


batch_results = await parallel(batches, extract_batch) if batches else []
batches_ok = [r["batch_id"] for r in batch_results if r["ok"]]
batches_failed = [r["batch_id"] for r in batch_results if not r["ok"]]
js_blocked = sorted({u for r in batch_results for u in (r.get("js_blocked_urls") or [])})
log(f"Extraction batches done: {len(batches_ok)}/{len(batches)} ok (failed={batches_failed}, js_blocked={len(js_blocked)})")


# ---------------------------------------------------------------- Phase D3a: Deterministic Coverage Audit

phase("D3a. 确定性覆盖度与反证统计")

cov_before_gap = _compute_coverage(run_dir, qs)
weak_qs = [q for q, cnt in cov_before_gap["per_question_counts"].items() if cnt < min_quotes_per_q]
needs_counter = cov_before_gap["contradicts_total"] < (1 if tier == "quick" else 2)
has_hypotheses = bool(re.search(r"待验证假设|to verify", outline_text, re.I))
log(
    f"Coverage before Gap Round: sources={cov_before_gap['sources_total']} (families={cov_before_gap['families_total']}), "
    f"evidence={cov_before_gap['evidence_total']}, contradicts={cov_before_gap['contradicts_total']}, "
    f"weak_qs={weak_qs}, needs_counter={needs_counter}, has_hypotheses={has_hypotheses}"
)


# ---------------------------------------------------------------- Phase D3b: Targeted Gap & Counter-Evidence Round

gap_ran = False
gap_res = {}
if run_gap_round and (weak_qs or needs_counter or has_hypotheses):
    phase("D3b. 定向 Gap Round 与反证补查")
    gap_ran = True
    gap_prompt = f"""You are the **Gap & Counter-Evidence Hunter** for Diamond 2 (`D3`).
Your job is to close remaining evidence gaps, test `待验证假设` in `{outline_path}`, and actively search for **counter-evidence** (failure modes, negative reproductions, outdated claims, license/cost caveats) so the final report does not suffer from confirmation bias.

## Current Deterministic Coverage
- Run directory: `{run_dir}`
- Brief: `{brief_path}`
- Outline (read `## 全局研究边界` exclusions + `待验证假设`): `{outline_path}`
- Coverage stats: {json.dumps(cov_before_gap, ensure_ascii=False)}
- Under-covered questions (< {min_quotes_per_q} quotes): {weak_qs}
- Needs more counter-evidence (`contradicts`): {needs_counter}
- JS-blocked URLs noticed during D1–D2: {js_blocked[:8]}

## Tools & Rules
- Retrieval CLI: `python3 "{research_script}"` (use `--provider parallel --mode advanced`, `--provider exa --category paper|github`, `papers`, `hn`, and full-text `pdf`/`fetch`/`repo`; save outputs to `{run_dir}/raw/gap-<n>.json`).
- Evidence CLI: `python3 "{report_script}"` (append single-document verbatim quotes via `source` and `evidence --by gap-hunter`; mark counter-evidence with `--stance contradicts`).
- Budget: keep this round targeted (at most 6 searches and 6 full reads). Respect ALL exclusions in `## 全局研究边界`.
- **Single-document red line**: NEVER merge quotes across multiple documents.
- **Controlled outline adjustment**: Keep top-level `## S1..Sn` sections frozen; ONLY if you uncover a major paradigm-shifting finding or refute a `待验证假设`, apply a minimal local update to the affected subsection in `{outline_path}` and set `outline_patched: true`.
- If a gap still has no qualifying evidence within budget, list it honestly in `remaining_gaps` instead of padding. Return summary JSON via `finish`.
"""
    try:
        gap_res = await agent(
            gap_prompt,
            schema=GAP_SCHEMA,
            role="Gap & Counter-Evidence Hunter",
            type_name="self",
            model=planner_model,
        )
        log(f"Gap Round complete: +{gap_res.get('evidence_count', 0)} quotes, contradicts=+{gap_res.get('contradicts_added', 0)}")
    except Exception as exc:
        log(f"Gap Round failed ({exc}); keeping D1–D2 evidence intact.")

cov_final = _compute_coverage(run_dir, qs)
summary = {
    "status": "ok" if cov_final["evidence_total"] > 0 else "empty",
    "tier": tier,
    "run_dir": run_dir,
    "batches_ok": batches_ok,
    "batches_failed": batches_failed,
    "js_blocked_urls": js_blocked,
    "gap_round_ran": gap_ran,
    "remaining_gaps": gap_res.get("remaining_gaps", []),
    "outline_patched": bool(gap_res.get("outline_patched", False)),
    "coverage": cov_final,
}
print(json.dumps(summary, ensure_ascii=False, indent=2))

"""Antigravity `run_workflow` script for Diamond 2 Part 2 (`topic-research` · 收束 2):
Macro analysis & dynamic `[E#]` binding (`D4a`) ->
ID-grounded parallel section writing (`D4b`, via `references/writer.md`) ->
Deterministic `report.py check` gate (`D5a`) ->
Independent raw-reading semantic audit (`D5b`, via `references/reviewer.md`, anti Evidence-View Gaming) ->
Targeted local patch revision with pre-audit baseline rollback ->
Final `report.py render` (`D6`).

Invoke via Antigravity's `run_workflow` tool:
    run_workflow(
        ScriptPath="/path/to/topic-research/scripts/synthesize_verify_workflow.py",
        Description="Diamond 2 (Converge): analyze, write, audit, patch, and render report.md",
        Args={
            "run_dir": "/abs/path/to/run_dir",
            # optional overrides:
            # "tier": "deep",              # auto-read from brief.md if omitted
            # "skill_dir": "/abs/path/to/topic-research",
            # "model": "inherit",          # keep strong model for synthesis & verification
            # "max_fix_rounds": 2,
        },
    )
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess


# ---------------------------------------------------------------- helpers

def _read_text(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def _detect_tier(brief_text: str) -> str:
    m = re.search(r"^\s*-\s*Tier\s*[:：]\s*(quick|deep)\b", brief_text, re.I | re.M)
    return m.group(1).lower() if m else "deep"


def _detect_started(brief_text: str) -> str:
    m = re.search(r"^\s*-\s*Started\s*[:：]\s*(\S+)", brief_text, re.I | re.M)
    return m.group(1).strip() if m else ""


def _parse_main_sections(outline_text: str) -> list:
    """Parse `## S<k>｜...` sections from outline.md for parallel isolated writing."""
    matches = list(re.finditer(r"^##\s+(S\d+)\s*(?:[｜|:：]|\s+)(.+?)\s*$", outline_text, re.M))
    sections = []
    for idx, m in enumerate(matches):
        start = m.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(outline_text)
        body = outline_text[start:end]
        eids = sorted(set(re.findall(r"\bE\d+\b", body)), key=lambda x: int(x[1:]))
        sections.append({
            "id": m.group(1),
            "title": m.group(2).strip(),
            "heading": m.group(0).strip(),
            "evidence_ids": eids,
        })
    return sections


def _run_report_cli(report_script: str, *cli_args: str) -> dict:
    proc = subprocess.run(["python3", report_script, *cli_args], capture_output=True, text=True)
    raw = (proc.stdout or "").strip()
    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        data = {"errors": [f"report.py returned non-JSON (exit {proc.returncode}): {raw[:300]} {proc.stderr[:200]}"]}
    if proc.returncode == 2 and "error" in data and not data.get("errors"):
        data["errors"] = [data["error"]]
    data.setdefault("errors", [])
    data.setdefault("warnings", [])
    data["returncode"] = proc.returncode
    return data


ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis_path": {"type": "string"},
        "outline_path": {"type": "string"},
        "sections_mapped": {"type": "integer"},
        "unresolved_conflicts": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["analysis_path", "outline_path", "sections_mapped"],
}

SECTION_SCHEMA = {
    "type": "object",
    "properties": {
        "section_id": {"type": "string"},
        "output_path": {"type": "string"},
        "gaps": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["section_id", "output_path"],
}

DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "draft_path": {"type": "string"},
        "sections_assembled": {"type": "integer"},
    },
    "required": ["draft_path"],
}

PATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "draft_path": {"type": "string"},
        "fixes_applied": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["draft_path", "fixes_applied"],
}

AUDIT_SCHEMA = {
    "type": "object",
    "properties": {
        "audit_path": {"type": "string"},
        "checked": {"type": "integer"},
        "sampled": {"type": "integer"},
        "supports": {"type": "integer"},
        "partial": {"type": "integer"},
        "contradicts": {"type": "integer"},
        "unsupported": {"type": "integer"},
        "unavailable": {"type": "integer"},
        "fix_count": {"type": "integer"},
    },
    "required": ["audit_path", "checked", "fix_count"],
}


# ---------------------------------------------------------------- configuration

_run_dir_arg = args.get("run_dir")
if not _run_dir_arg:
    raise ValueError("Args must provide `run_dir` pointing to a topic-research run directory.")

run_dir = os.path.abspath(os.path.expanduser(_run_dir_arg))
brief_path = os.path.join(run_dir, "brief.md")
outline_path = os.path.join(run_dir, "outline.md")
sources_path = os.path.join(run_dir, "sources.jsonl")
evidence_path = os.path.join(run_dir, "evidence.jsonl")
for req in (brief_path, outline_path, sources_path, evidence_path):
    if not os.path.isfile(req):
        raise FileNotFoundError(f"Required input missing for synthesis: {req}")

_script_file = globals().get("__file__")
_default_skill = (
    os.path.dirname(os.path.dirname(os.path.abspath(_script_file)))
    if _script_file
    else os.path.expanduser("~/.gemini/config/skills/topic-research")
)
skill_dir = os.path.abspath(os.path.expanduser(args.get("skill_dir") or _default_skill))
research_script = os.path.join(skill_dir, "scripts", "research.py")
report_script = os.path.join(skill_dir, "scripts", "report.py")
writer_brief_path = os.path.join(skill_dir, "references", "writer.md")
reviewer_brief_path = os.path.join(skill_dir, "references", "reviewer.md")
template_path = os.path.join(skill_dir, "references", "report-template.md")

brief_text = _read_text(brief_path)
tier = (args.get("tier") or _detect_tier(brief_text)).lower()
if tier not in ("quick", "deep"):
    tier = "deep"
started = _detect_started(brief_text)
model = args.get("model") or "inherit"
max_fix_rounds = max(1, int(args.get("max_fix_rounds", 2)))

analysis_path = os.path.join(run_dir, "analysis.md")
draft_path = os.path.join(run_dir, "draft.md")
pre_audit_path = os.path.join(run_dir, "notes", "draft.pre-audit.md")
audit_path = os.path.join(run_dir, "audit.md")
report_path = os.path.join(run_dir, "report.md")
os.makedirs(os.path.join(run_dir, "notes"), exist_ok=True)

log(f"Diamond 2 Synthesize & Verify start | tier={tier} | model={model} | run_dir={run_dir}")


# ---------------------------------------------------------------- Phase D4a: Macro Analysis & Dynamic [E#] Binding

phase("D4a. 宏观分析定调与动态回填 [E#]")

analyst_prompt = f"""You are the **Lead Analyst** for Diamond 2 (`D4a`).
Prevent the "locally accurate, globally incoherent" failure mode by establishing the report's macro thesis, conflict adjudication, and section ownership BEFORE section writing begins.

## Inputs (read from disk, never from memory)
- `{brief_path}`
- `{outline_path}`
- `{sources_path}`
- `{evidence_path}`
- `{template_path}`

## Tasks
1. Write `{analysis_path}` covering every `Q1..Qn`:
   - Direct answer grounded in `[E#]` IDs
   - Cross-source conflicts and WHY they occur (different conditions/benchmarks vs real contradiction; sources sharing a `family` count once)
   - Explicit conditions, remaining unknowns, and your own inferences clearly marked `[推断]` / `[inference]`
   - **Section ownership map**: each flagship system/method owned by exactly ONE primary section (cross-referenced elsewhere to prevent duplication)
2. Update `{outline_path}` in place (keep top-level `## S1..Sn` intact; bounded local subsection edits allowed):
   - Under every section/subsection, attach its one-sentence argument, the exact verified `[E#]` IDs it will cite, remaining gaps, and target length range.
   - Only reference `[E#]` IDs that ACTUALLY exist in `{evidence_path}`.
3. Return structured summary via `finish`.
"""
analyst_res = await agent(
    analyst_prompt,
    schema=ANALYSIS_SCHEMA,
    role="Lead Analyst (analysis.md + [E#] map)",
    type_name="self",
    model=model,
)
log(f"Analysis & [E#] binding complete: {analyst_res.get('sections_mapped')} sections mapped")


# ---------------------------------------------------------------- Phase D4b: ID-Grounded Section Writing

phase("D4b. 按节定点取证写作 (writer.md)")

updated_outline = _read_text(outline_path)
sections = _parse_main_sections(updated_outline)

if tier == "quick" or len(sections) <= 1:
    quick_prompt = f"""Write the complete `quick`-tier report draft to `{draft_path}`.
Read `{brief_path}`, `{analysis_path}`, `{outline_path}`, `{sources_path}`, `{evidence_path}`, `{template_path}`, and `{writer_brief_path}`.
Follow ALL accuracy, citation (`[E#]`), readability (conclusion-first, <=250-char paragraphs, <=90-char table cells, `<details>` for dense tables, section ownership), and no-references-list rules.
Include real ledger counts (`python3 "{research_script}" ledger --since "{started}"`) in `## Method and cost` / `## 方法与花费`.
Return summary via `finish`.
"""
    await agent(quick_prompt, schema=DRAFT_SCHEMA, role="Quick Report Writer", type_name="self", model=model)
else:
    async def write_section(sec: dict) -> dict:
        sid = sec["id"]
        out_file = os.path.join(run_dir, "notes", f"section-{sid}.md")
        eids_str = ", ".join(sec["evidence_ids"][:60]) or "(see outline.md)"
        sec_prompt = f"""Write ONLY the section `{sec['heading']}` of the research report to `{out_file}`.
Follow `{writer_brief_path}` strictly.

## Files to read (ID-grounded retrieval — read ONLY this section's evidence & raw passages)
- `{brief_path}`
- `{outline_path}` (focus on `{sec['heading']}` and its section ownership boundaries)
- `{analysis_path}`
- `{sources_path}` and ONLY the `{evidence_path}` lines bound to `{sid}` ({eids_str}) plus their referenced `raw/` passages

## Hard Rules
- Start `{out_file}` directly with `{sec['heading']}`.
- Lead with a 1–2 sentence takeaway; keep prose paragraphs `<= 250` Chinese chars (~3–4 lines) and table cells `<= 90` chars; move dense ablation/parameter breakdowns into `<details><summary>...</summary>...</details>` keeping every `[E#]` citation intact.
- Enforce section ownership: explain systems owned by `{sid}` in full; cross-reference other sections in one phrase.
- Put `[E#]` right after each claim; every number keeps its conditions; no references list, no whole-report summary.
- Return output path and any `<!-- gaps: ... -->` via `finish`.
"""
        try:
            res = await agent(
                sec_prompt,
                schema=SECTION_SCHEMA,
                role=f"Section Writer {sid}",
                type_name="self",
                model=model,
            )
            ok = os.path.isfile(out_file) and bool(_read_text(out_file).strip())
            return {"ok": ok, "section_id": sid, "output_path": out_file, "gaps": res.get("gaps") or []}
        except Exception as exc:
            log(f"Section Writer {sid} failed: {exc}")
            return {"ok": False, "section_id": sid, "output_path": out_file, "error": str(exc), "gaps": []}

    sec_results = await parallel(sections, write_section)
    written_files = [r["output_path"] for r in sec_results if r["ok"]]
    failed_secs = [r["section_id"] for r in sec_results if not r["ok"]]
    if not written_files:
        raise RuntimeError(f"All section writers failed: {failed_secs}")
    log(f"Parallel section writing done: {len(written_files)}/{len(sections)} written (failed={failed_secs})")

    sec_list_str = "\n".join(f"- `{p}`" for p in written_files)
    assemble_prompt = f"""Assemble the complete `{draft_path}` from the finished section files below and write the opening/closing wrapper sections last.

## Inputs
- `{brief_path}`, `{analysis_path}`, `{outline_path}`, `{template_path}`, `{writer_brief_path}`
- Finished section files (join in exact outline order, preserving their `[E#]` citations intact):
{sec_list_str}
- Run `python3 "{research_script}" ledger --since "{started}"` to get exact call counts & estimated spend for the Method section.

## Tasks
1. Write `{draft_path}` following `{template_path}`:
   - `# <Topic>` + Scope line
   - `## Conclusions` / `## 核心结论` (3–6 highest-impact takeaways with `[E#]`, recommendation, main open risk)
   - `## Background and map` / `## 背景与架构全景` (concise map/Mermaid if helpful, no duplication of S1..Sn)
   - Join all `notes/section-S*.md` verbatim in order (fix only obvious heading-level mismatches; do NOT compress or drop `[E#]` citations!)
   - `## Recommendations` / `## 建议与选型`, `## Materials to read first` / `## 优先精读材料`, `## Open questions and gaps` / `## 开放问题与空白`, `## Method and cost` / `## 方法与花费` (including `run_dir` path and ledger spend).
2. Do NOT write a `## References` / `## 参考文献` section (`report.py render` generates it).
3. Return summary via `finish`.
"""
    await agent(assemble_prompt, schema=DRAFT_SCHEMA, role="Report Assembler & Conclusions", type_name="self", model=model)


# ---------------------------------------------------------------- Phase D5a: Deterministic Check Gate

phase("D5a. 确定性机械校验 (report.py check)")

PATCH_SYSTEM = f"""You are a surgical **Local Patch Editor** for `{draft_path}`.
Rules:
- Anti "If It's Not Buggy, Don't Fix It": edit ONLY the specific lines/claims flagged by `report.py check` or `{audit_path}`.
- NEVER rewrite passing paragraphs or drop valid `[E#]` citations.
- Fix unsupported/partial claims by narrowing to what the raw source states, marking `[推断]`/`[inference]`, or marking unknown — NEVER attach a loosely related citation.
"""
patcher = agent(PATCH_SYSTEM, role="Local Patch Editor", type_name="self", model=model)

rolled_back = False
audit_res = {}
render_res = {}
check_res = _run_report_cli(report_script, "check", run_dir)

try:
    for r_idx in range(1, max_fix_rounds + 1):
        if not check_res["errors"]:
            break
        log(f"check found {len(check_res['errors'])} error(s); local patch round {r_idx}/{max_fix_rounds}")
        errs = "\n".join(f"- {e}" for e in check_res["errors"])
        warns = "\n".join(f"- {w}" for w in check_res.get("warnings", [])[:8])
        await patcher(
            f"`report.py check` failed on `{draft_path}`:\nErrors:\n{errs}\nWarnings:\n{warns}\n\n"
            f"Read `{evidence_path}` and apply minimal local patches to `{draft_path}` to reach 0 errors (and clear uncited-number warnings). Return fixes via `finish`.",
            schema=PATCH_SCHEMA,
        )
        check_res = _run_report_cli(report_script, "check", run_dir)

    pre_audit_ok = not check_res["errors"]
    pre_audit_cited = (check_res.get("stats") or {}).get("cited_evidence", 0)
    if os.path.isfile(draft_path):
        shutil.copyfile(draft_path, pre_audit_path)

    # ------------------------------------------------------------ Phase D5b: Independent Raw-Reading Audit + Patch/Rollback

    if pre_audit_ok:
        phase("D5b. 独立原文审校与防回归局部补丁 (reviewer.md)")
        review_prompt = f"""You are a **brand-new, completely independent Reviewer** auditing `{draft_path}` strictly per `{reviewer_brief_path}`.

## Anti Evidence-View Gaming Rule
- Read `{brief_path}`, `{draft_path}`, `{evidence_path}`, and `{sources_path}`.
- For EVERY key number, EVERY main recommendation, and a stated sample of other claims, read the **actual `raw/` source passage** (NOT only the stored quote!) to prevent Evidence-View Gaming.
- Check A. Citation review (supports/partial/contradicts/unsupported/unavailable), B. Coverage (every Q#), C. Counter-evidence (`deep` tier), and D. Presentation & readability (ownership duplication, walls of text >250 chars, bloated cells >90 chars, uncollapsed detail dumps).
- Write `{audit_path}` with a numbered `## Fix list` (`location | problem | exact fix`). Do NOT edit `{draft_path}` yourself.
- Return exact counts via `finish`.
"""
        try:
            audit_res = await agent(
                review_prompt,
                schema=AUDIT_SCHEMA,
                role="Independent Reviewer (raw/ audit)",
                type_name="self",
                model=model,
            )
            fix_count = int(audit_res.get("fix_count") or 0)
            log(f"Independent audit done: checked={audit_res.get('checked')}, fix_count={fix_count}")

            if fix_count > 0 and os.path.isfile(audit_path):
                await patcher(
                    f"Read `{audit_path}` (`## Fix list`) and apply ONLY the numbered fixes to `{draft_path}` using minimal local patches.\n"
                    f"Rules: do NOT rewrite passing sections; preserve all valid `[E#]` citations; then append a brief `## Revisions applied` note to `{audit_path}`. Return fixes via `finish`.",
                    schema=PATCH_SCHEMA,
                )
                post_check = _run_report_cli(report_script, "check", run_dir)
                if post_check["errors"]:
                    errs = "\n".join(f"- {e}" for e in post_check["errors"])
                    await patcher(
                        f"`report.py check` reported errors after applying audit fixes:\n{errs}\n"
                        f"Fix ONLY these errors in `{draft_path}` without breaking audit fixes. Return fixes via `finish`.",
                        schema=PATCH_SCHEMA,
                    )
                    post_check = _run_report_cli(report_script, "check", run_dir)

                post_cited = (post_check.get("stats") or {}).get("cited_evidence", 0)
                severe_drop = pre_audit_cited >= 10 and post_cited < int(pre_audit_cited * 0.75)
                if post_check["errors"] or severe_drop:
                    shutil.copyfile(pre_audit_path, draft_path)
                    rolled_back = True
                    log(
                        f"Fail-closed rollback to pre-audit draft: errors={post_check['errors']}, "
                        f"cited_evidence {pre_audit_cited}->{post_cited}"
                    )
                else:
                    check_res = post_check
                    log(f"Post-audit local patches passed check (0 errors, warnings={len(post_check['warnings'])}).")
        except Exception as exc:
            log(f"Independent review/patch encountered an error ({exc}); keeping verified pre-audit draft.")
finally:
    del patcher


# ---------------------------------------------------------------- Phase D6: Deterministic Render

if not check_res["errors"]:
    phase("D6. 渲染最终报告 (report.py render)")
    render_res = _run_report_cli(report_script, "render", run_dir)
    log(f"Rendered final report: {render_res.get('report')} (sources={render_res.get('sources_cited')}, evidence={render_res.get('evidence_cited')})")

summary = {
    "status": "ok" if (not check_res["errors"] and os.path.isfile(report_path)) else "failed",
    "tier": tier,
    "run_dir": run_dir,
    "report_path": report_path if os.path.isfile(report_path) else None,
    "audit_path": audit_path if os.path.isfile(audit_path) else None,
    "sources_cited": render_res.get("sources_cited", 0),
    "evidence_cited": render_res.get("evidence_cited", 0),
    "rolled_back": rolled_back,
    "check_errors": check_res.get("errors", []),
    "check_warnings": check_res.get("warnings", []),
    "audit_counts": {k: audit_res.get(k) for k in ("checked", "supports", "partial", "contradicts", "unsupported", "fix_count") if k in audit_res},
}
print(json.dumps(summary, ensure_ascii=False, indent=2))

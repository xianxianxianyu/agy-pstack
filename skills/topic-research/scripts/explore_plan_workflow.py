"""Antigravity `run_workflow` script for Diamond 1 (`topic-research-plan`):
Adaptive entry (anchored object disambiguation vs landscape survey) ->
Orthogonal isolated light exploration ->
Search/read-enabled 3-bucket Judge merge ->
Deterministic `check-outline` gate & local repair/fallback ->
Optional Critic HP# pass (default OFF per LongCat Table 3 evidence).

Invoke via Antigravity's `run_workflow` tool:
    run_workflow(
        ScriptPath="/path/to/topic-research/scripts/explore_plan_workflow.py",
        Description="Diamond 1: adaptive explore and dynamic outline",
        Args={
            "run_dir": "/abs/path/to/run_dir",
            # optional overrides:
            # "tier": "deep",              # auto-read from brief.md if omitted
            # "mode": "anchored",          # auto-classified: anchored | landscape
            # "skill_dir": "/abs/path/to/topic-research",
            # "enable_critic": False,      # default False; set True for ultra-broad surveys
            # "max_repair_rounds": 2,
            # "explorer_model": "inherit", # inherit | pro | flash | flash_lite
            # "judge_model": "inherit",
            # "views": [{"id": "...", "name": "...", "angle": "...", "channels": "..."}],
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


def _slug_id(value: str, fallback: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "-", (value or "").strip().lower()).strip("-_")
    return s[:24] or fallback


def _run_check_outline(
    report_script: str,
    run_dir: str,
    outline_path: str,
    *,
    critique_path: str | None = None,
    baseline_path: str | None = None,
    min_subsections: int | None = None,
) -> dict:
    cmd = ["python3", report_script, "check-outline", run_dir, "--outline", outline_path]
    if critique_path:
        cmd.extend(["--critique", critique_path])
    if baseline_path:
        cmd.extend(["--baseline", baseline_path])
    if min_subsections is not None:
        cmd.extend(["--min-subsections", str(min_subsections)])
    proc = subprocess.run(cmd, capture_output=True, text=True)
    raw = (proc.stdout or "").strip()
    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        data = {"errors": [f"check-outline returned non-JSON (exit {proc.returncode}): {raw[:300]} {proc.stderr[:200]}"]}
    if proc.returncode == 2 and "error" in data and not data.get("errors"):
        data["errors"] = [data["error"]]
    data.setdefault("errors", [])
    data.setdefault("warnings", [])
    data["returncode"] = proc.returncode
    return data


def _extract_hp_ids(text: str) -> list:
    return sorted({f"HP{m}" for m in re.findall(r"\bHP(\d+)\b", text, re.I)}, key=lambda x: int(x[2:]))


DEFAULT_VIEWS = [
    {
        "id": "mechanism",
        "name": "前沿机制与核心路线",
        "angle": (
            "三阶锚定主流路线：① 定向搜近 18–24 个月综述/分类学论文（survey/taxonomy/systematic review）定骨架；"
            "② 若高质量综述 < 2 篇，回退 OpenAlex 带时间窗高引论文（--sort citations --after，优先近期引速 citations_this_year 并滤除仅顺带提及的老论文）与官方技术报告；"
            "③ 必补 1 次近 6 个月前沿检索（alphaxiv/hf --sort date）对冲滞后。综述仅作寻路地图，线索须指向一手原论文。"
        ),
        "channels": "papers (survey -> openalex citations -> alphaxiv/hf recent), web (--provider exa --category paper / parallel 官方技术报告)",
        "seed_queries": [],
    },
    {
        "id": "engineering",
        "name": "工程实现与基准成本",
        "angle": "聚焦开源代码库、系统架构、可部署约束、延迟/成本与真实评测基准。",
        "channels": "repos, web (--provider exa --category github / parallel 工程博客与基准页), papers",
        "seed_queries": [],
    },
    {
        "id": "counter",
        "name": "反证、失效边界与争议",
        "angle": "聚焦负面复现、已知失效模式、从业者批判、过时结论与竞争替代路线。",
        "channels": "hn, web (批判与复盘), papers (消融与局限)",
        "seed_queries": [],
    },
]

VIEWS_SCHEMA = {
    "type": "object",
    "properties": {
        "mode": {"type": "string", "enum": ["anchored", "landscape"]},
        "anchor_reason": {"type": "string"},
        "anchor_queries": {"type": "array", "items": {"type": "string"}},
        "views": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "angle": {"type": "string"},
                    "channels": {"type": "string"},
                    "seed_queries": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["id", "name", "angle", "channels"],
            },
        },
    },
    "required": ["mode", "views"],
}

ANCHOR_SCHEMA = {
    "type": "object",
    "properties": {
        "anchor_path": {"type": "string"},
        "canonical_terms": {"type": "array", "items": {"type": "string"}},
        "predecessors": {"type": "array", "items": {"type": "string"}},
        "exclusions": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string"},
    },
    "required": ["anchor_path", "canonical_terms", "exclusions", "summary"],
}

EXPLORER_SCHEMA = {
    "type": "object",
    "properties": {
        "view_id": {"type": "string"},
        "path": {"type": "string"},
        "entities": {"type": "array", "items": {"type": "string"}},
        "key_leads": {"type": "array", "items": {"type": "string"}},
        "blind_spots": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["view_id", "path", "entities"],
}

JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "outline_path": {"type": "string"},
        "sections": {"type": "integer"},
        "subsections": {"type": "integer"},
        "resolved_conflicts": {"type": "array", "items": {"type": "string"}},
        "excluded_homonyms": {"type": "array", "items": {"type": "string"}},
        "verification_reads": {"type": "integer"},
    },
    "required": ["outline_path", "sections", "subsections"],
}

REPAIR_SCHEMA = {
    "type": "object",
    "properties": {
        "outline_path": {"type": "string"},
        "fixed": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["outline_path", "fixed"],
}

CRITIC_SCHEMA = {
    "type": "object",
    "properties": {
        "critique_path": {"type": "string"},
        "has_gaps": {"type": "boolean"},
        "hp_ids": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string"},
    },
    "required": ["critique_path", "has_gaps", "hp_ids"],
}


# ---------------------------------------------------------------- configuration

_run_dir_arg = args.get("run_dir")
if not _run_dir_arg:
    raise ValueError("Args must provide `run_dir` pointing to an initialized topic-research run directory.")

run_dir = os.path.abspath(os.path.expanduser(_run_dir_arg))
brief_path = os.path.join(run_dir, "brief.md")
if not os.path.isfile(brief_path):
    raise FileNotFoundError(f"brief.md not found in run_dir: {run_dir}")

_script_file = globals().get("__file__")
_default_skill = (
    os.path.dirname(os.path.dirname(os.path.abspath(_script_file)))
    if _script_file
    else os.path.expanduser("~/.gemini/config/skills/topic-research")
)
skill_dir = os.path.abspath(os.path.expanduser(args.get("skill_dir") or _default_skill))
research_script = os.path.join(skill_dir, "scripts", "research.py")
report_script = os.path.join(skill_dir, "scripts", "report.py")
outline_spec_path = os.path.join(skill_dir, "references", "outline-spec.md")

brief_text = _read_text(brief_path)
tier = (args.get("tier") or _detect_tier(brief_text)).lower()
if tier not in ("quick", "deep"):
    tier = "deep"

view_count = 2 if tier == "quick" else 3
min_subsections = 3 if tier == "quick" else 6
# Default OFF per LongCat Table 3 ablation (J0 beats R1/R2 on total score); opt-in for ultra-broad surveys.
enable_critic = bool(args.get("enable_critic", False))
max_repair_rounds = max(1, int(args.get("max_repair_rounds", 2)))
explorer_model = args.get("explorer_model") or "inherit"
judge_model = args.get("judge_model") or "inherit"
explicit_mode = (args.get("mode") or "").strip().lower()
if explicit_mode not in ("", "anchored", "landscape"):
    raise ValueError("Args `mode` must be 'anchored' or 'landscape' when set.")

plan_dir = os.path.join(run_dir, "notes", "plan")
raw_dir = os.path.join(run_dir, "raw")
os.makedirs(plan_dir, exist_ok=True)
os.makedirs(raw_dir, exist_ok=True)

anchor_path = os.path.join(plan_dir, "anchor.md")
outline_path = os.path.join(run_dir, "outline.md")
baseline_path = os.path.join(plan_dir, "judge-baseline.md")
critic_path = os.path.join(plan_dir, "critic.md")

log(f"Diamond 1 start | tier={tier} | views={view_count} | critic={enable_critic} | run_dir={run_dir}")


# ---------------------------------------------------------------- State S1: Mode Routing & Orthogonal Perspectives

phase("S1. 模式判别与正交视角生成")

mode = explicit_mode or "landscape"
anchor_queries = []
custom_views = args.get("views")

if isinstance(custom_views, list) and custom_views:
    views = []
    for idx, v in enumerate(custom_views, 1):
        views.append({
            "id": _slug_id(v.get("id", ""), f"view{idx}"),
            "name": v.get("name") or f"Perspective {idx}",
            "angle": v.get("angle") or "",
            "channels": v.get("channels") or "web, papers, repos",
            "seed_queries": v.get("seed_queries") or [],
        })
    log(f"Using {len(views)} caller-supplied perspectives (mode={mode}): {[v['id'] for v in views]}")
else:
    designer_prompt = f"""Classify the planning entry mode and design {view_count} orthogonal, non-overlapping exploration perspectives for Diamond 1 of a `{tier}` research run.

Read the research brief below:
---
{brief_text}
---

Rules:
1. Choose `mode`:
   - `"anchored"`: the request targets a SPECIFIC named algorithm, paper, optimization variant, or tightly scoped technical lineage where generic keyword search risks homonym drift (e.g., "a subspace optimization variant of RL quantization algorithm X"). Supply 1-2 `anchor_queries` to verify the exact object & predecessor first.
   - `"landscape"`: the request is a broad domain survey, architecture landscape, or multi-route selection study with no single narrow anchor object.
2. Produce exactly {view_count} orthogonal perspectives so parallel explorers do NOT converge on the same search trajectory:
   - Lens 1 (`mechanism`): Core mechanisms & taxonomy — MUST use a 3-step ladder: targeted survey/taxonomy search first -> if <2 strong surveys, fall back to time-windowed high-citation papers (`--source openalex --sort citations --after`) & flagship tech reports -> plus 1 recent-6-month recency check (`--source alphaxiv --sort date`).
   - Lens 2 (`engineering`): Engineering implementation, code, benchmarks, deployment constraints & cost.
   - Lens 3 (`counter`, deep tier): Counter-evidence, failure modes, negative reproductions & competing paradigms.
   - For `quick` tier, keep 2 crisp orthogonal lenses (keeping the survey-first ladder in lens 1).
3. Keep each `id` short ASCII lowercase (`mechanism`, `engineering`, `counter`, etc.) and provide 2-3 concrete `seed_queries` per perspective.
4. Do NOT run searches in this step; return structured JSON via `finish`.
"""
    try:
        designed = await agent(
            designer_prompt,
            schema=VIEWS_SCHEMA,
            role="Mode & Perspective Designer",
            type_name="self",
            model=judge_model,
        )
        if not explicit_mode and designed.get("mode") in ("anchored", "landscape"):
            mode = designed["mode"]
        anchor_queries = designed.get("anchor_queries") or []
        raw_views = designed.get("views") or []
        if len(raw_views) >= 2:
            views = []
            seen_ids = set()
            for idx, v in enumerate(raw_views[:view_count], 1):
                vid = _slug_id(v.get("id", ""), f"view{idx}")
                if vid in seen_ids:
                    vid = f"{vid}-{idx}"
                seen_ids.add(vid)
                views.append({
                    "id": vid,
                    "name": v.get("name") or f"Perspective {idx}",
                    "angle": v.get("angle") or "",
                    "channels": v.get("channels") or "web, papers, repos",
                    "seed_queries": v.get("seed_queries") or [],
                })
            log(f"Mode={mode} ({designed.get('anchor_reason', '')[:80]}) | views={[v['name'] for v in views]}")
        else:
            views = DEFAULT_VIEWS[:view_count]
            log(f"Designer returned <2 views; falling back to default orthogonal triad (mode={mode}).")
    except Exception as exc:
        views = DEFAULT_VIEWS[:view_count]
        log(f"Perspective Designer failed ({exc}); falling back to defaults (mode={mode}).")


# ---------------------------------------------------------------- State S1b: Optional Anchor Disambiguation

anchor_summary = ""
anchor_created = False
if mode == "anchored":
    phase("S1b. 目标对象锚定与消歧 (Anchor)")
    aq_lines = "\n".join(f"  - {q}" for q in anchor_queries) or "  - (derive exact target & predecessor from brief.md)"
    anchor_prompt = f"""You are the **Anchor Reader** for an `anchored` research task.
Before parallel explorers fan out, verify the EXACT target object, its domain context, its predecessor(s), and homonym exclusions so downstream explorers do not drift into unrelated domains sharing the same term.

## Inputs & Paths
- Brief: `{brief_path}`
- Retrieval CLI: `python3 "{research_script}"`
- Save searches/reads to `{raw_dir}/explore-anchor-<n>.json` (`--brief` for searches)
- Write a concise Markdown anchor card to: `{anchor_path}`
- Suggested anchor queries:
{aq_lines}

## Budget & Rules
1. Run at most **2** targeted searches (`papers`/`web`/`repos`) and at most **2** quick primary reads (`pdf` abstract/intro pages, `fetch`, or `repo` README) of the target work and/or its direct predecessor.
2. In `{anchor_path}`, write 4 short sections:
   - `## 目标对象与精确术语` (canonical names, aliases, primary URL)
   - `## 所属问题域与硬约束` (exact domain/context from brief.md)
   - `## 纵向血缘基线` (verified predecessor / pre-optimization method -> this optimization; mark unverified links as `待验证假设`)
   - `## 同名异域排除词` (unrelated domains/methods sharing keywords that explorers MUST ignore)
3. Do NOT write `sources.jsonl` or `evidence.jsonl` yet. Return structured summary via `finish`.
"""
    try:
        anc = await agent(
            anchor_prompt,
            schema=ANCHOR_SCHEMA,
            role="Anchor Reader",
            type_name="self",
            model=judge_model,
        )
        if os.path.isfile(anchor_path) and _read_text(anchor_path).strip():
            anchor_created = True
            anchor_summary = anc.get("summary") or ""
            log(f"Anchor card written: {anchor_path} | exclusions={anc.get('exclusions', [])[:5]}")
        else:
            log("Anchor Reader did not write anchor.md; continuing to S2 without anchor card.")
    except Exception as exc:
        log(f"Anchor Reader failed ({exc}); gracefully continuing to S2 without anchor card.")


# ---------------------------------------------------------------- State S2: Parallel Isolated Exploration

phase("S2. 多视角隔离轻探索 (发散 1)")


async def explore_one(view: dict) -> dict:
    vid = view["id"]
    out_file = os.path.join(plan_dir, f"view-{vid}.md")
    seeds = "\n".join(f"  - {q}" for q in (view.get("seed_queries") or [])) or "  - (derive from brief.md)"
    is_mech = vid == "mechanism" or any(
        k in f"{vid} {view['name']}".lower()
        for k in ("mech", "survey", "taxonomy", "theory", "paradigm", "机制", "路线", "原理", "综述")
    )
    mech_ladder = (
        "\n## Survey-First Taxonomy Ladder (for this perspective)\n"
        "- Step A (Map): Search recent surveys/taxonomies first (`papers \"<topic> survey, <topic> taxonomy, systematic review\" --source all --after <window>`).\n"
        "- Step B (Consensus fallback): If `< 2` high-quality surveys exist, run `--source openalex --sort citations --after <window>` (prioritize `citations_this_year`; drop off-topic mega-cited classics that only mention the keyword in passing) plus flagship tech reports.\n"
        "- Step C (Anti-lag patch): Always run 1 recency search (`--source alphaxiv --sort date --after <last 6 months>` or `--source hf`) to capture post-survey paradigms.\n"
        "- Map != Evidence: Use surveys strictly to anchor taxonomy and census entities; put **primary paper / official tech-report URLs** in `来源线索 / Source Leads` so Diamond 2 reads originals rather than second-hand survey summaries.\n"
        if is_mech
        else ""
    )
    anchor_block = (
        f"\n## Anchor Card (READ FIRST — hard scope guard)\n"
        f"- File: `{anchor_path}`\n"
        f"- Summary: {anchor_summary}\n"
        f"- Stay anchored to this target object & domain; drop homonym noise listed under `同名异域排除词`.\n"
        if anchor_created
        else ""
    )
    prompt = f"""You are an **independent Planning Explorer** (`{vid}`: {view['name']}) running in an isolated context.
Do NOT assume any other explorer will cover your gaps — build a complete candidate dynamic outline grounded in real light retrieval from your assigned perspective.

## Assigned Perspective
- Name: {view['name']}
- Focus angle: {view['angle']}
- Priority channels: {view['channels']}
- Suggested seed queries:
{seeds}
{anchor_block}{mech_ladder}
## Inputs & Paths
- Brief: `{brief_path}` (read it first)
- Outline contract: `{outline_spec_path}` (follow the exact 4-block Markdown contract)
- Retrieval CLI: `python3 "{research_script}"`
- Save every search JSON to `{raw_dir}/explore-{vid}-<n>.json` with `--brief` (never dump raw JSON into context)
- Write your candidate blueprint Markdown to: `{out_file}`

## Light Exploration Budget & Rules
1. Run **2–4** complementary searches via `research.py` (`web`, `papers`, `repos`, `hn` matching your channels). For paper-heavy or GitHub/docs-heavy `web` queries, route at least 1 call via `--provider exa --category paper` or `--provider exa --category github` (using Exa's free monthly index alongside default Parallel). Optional: at most **2** quick `pdf`/`fetch`/`repo` inspections if needed to confirm flagship entities or lineage.
2. Perform an **entity / method / project census** for your angle so Diamond 2 deep retrieval does not miss central works.
3. **Do NOT register `sources.jsonl` or `evidence.jsonl` yet**, and **NEVER place `[E#]` citations** in your outline. Diamond 1 URLs under `来源线索 / Source Leads` are fetch targets, not verified evidence.
4. Your Markdown at `{out_file}` MUST:
   - Start with `# <Topic>`
   - Cover every `Q#` listed in `brief.md`
   - Use consecutive `## S1｜...` and `### S1.1｜...` headings (`>= {min_subsections}` total subsections)
   - Include all 4 literal non-empty `####` blocks under every `###`: `内容范围`, `研究问题`, `必需实体 / 案例`, `来源线索` (or their English equivalents in `outline-spec.md`).
5. Return `{{"view_id": "{vid}", "path": "{out_file}", "entities": [...], "key_leads": [...], "blind_spots": [...]}}` via `finish`.
"""
    try:
        res = await agent(
            prompt,
            schema=EXPLORER_SCHEMA,
            role=f"Explorer: {view['name']}",
            type_name="self",
            model=explorer_model,
        )
        if not os.path.isfile(out_file) or not _read_text(out_file).strip():
            return {"ok": False, "view_id": vid, "name": view["name"], "error": f"expected file not written: {out_file}"}
        return {
            "ok": True,
            "view_id": vid,
            "name": view["name"],
            "path": out_file,
            "entities": res.get("entities") or [],
            "key_leads": res.get("key_leads") or [],
            "blind_spots": res.get("blind_spots") or [],
        }
    except Exception as exc:
        log(f"Explorer `{vid}` failed (graceful degradation): {exc}")
        return {"ok": False, "view_id": vid, "name": view["name"], "error": str(exc)}


view_results = await parallel(views, explore_one)
usable_views = [r for r in view_results if r["ok"]]
failed_views = [r for r in view_results if not r["ok"]]

log(f"Explorers completed: {len(usable_views)}/{len(view_results)} usable (failed: {[r['view_id'] for r in failed_views]})")
if not usable_views:
    raise RuntimeError(f"All perspective explorers failed: {[r.get('error') for r in failed_views]}")


# ---------------------------------------------------------------- State S3: Three-Bucket Search/Read-Enabled Judge Merge

phase("S3. 查证式三桶裁判合并 (收束 1)")

JUDGE_SYSTEM = f"""You are the **Planning Judge** for Diamond 1 (`topic-research-plan`).
Your job is NOT mechanical concatenation or voting — you are the **semantic & anti-hallucination gate** that converges multi-perspective candidate outlines into one precise, non-duplicative dynamic research contract (`{outline_path}`) strictly following `{outline_spec_path}`.

Core rules:
1. **Three-bucket triage**:
   - **Core main-line bucket**: flagship routes/algorithms directly answering `brief.md` -> primary subsections with clear section ownership (each system explained once in its owner subsection, cross-referenced elsewhere).
   - **Vertical/Horizontal comparison bucket**: verified predecessors/evolution (vertical) and same-constraint alternative routes (horizontal) -> bounded contrast subsections without crowding out the core question.
   - **Homonym / out-of-scope noise bucket**: unrelated domains sharing keywords -> DROP from subsections AND explicitly list them under `## 全局研究边界` exclusions so Diamond 2 deep retrieval does not step into the same trap.
2. **Verify lineage by reading originals (anti-hallucination)**:
   - You have `python3 "{research_script}"` available (budget: up to **3** verification searches + **2** targeted primary reads via `pdf` abstract/intro/related-work pages, `fetch`, or `repo`, saved to `{raw_dir}/explore-judge-<n>.json`).
   - Whenever candidates disagree OR a claimed vertical lineage ("A is the pre-optimization version of B") or domain boundary is ambiguous, READ the primary abstract/intro/README to verify. NEVER guess lineage from titles, 300-char snippets, or model memory.
   - Any plausible but unverified link MUST be explicitly labeled `待验证假设` rather than stated as established fact.
3. **Markdown-first contract**:
   - Never emit JSON for `outline.md`; write pure Markdown.
   - Leads are NOT evidence: never place `[E#]` citations in `outline.md`.
"""

judge = agent(JUDGE_SYSTEM, role="Planning Judge", type_name="self", model=judge_model)

rolled_back = False
critic_ran = False
critic_hp_ids = []
final_check = {}
used_fallback_candidate = None

try:
    candidate_lines = "\n".join(
        f"- `{v['view_id']}` ({v['name']}): `{v['path']}` | entities: {', '.join(v['entities'][:10])}"
        for v in usable_views
    )
    anchor_ref = f"- Anchor card: `{anchor_path}` (preserve its verified scope and exclusions)\n" if anchor_created else ""
    merge_prompt = f"""Read `{brief_path}`, `{outline_spec_path}`,
{anchor_ref}and EVERY candidate outline below:
{candidate_lines}

Task:
1. Perform 3-bucket triage (core main-line / vertical-horizontal comparison / homonym exclusions) and verify any ambiguous lineage or disagreement with targeted `research.py` searches/reads (`pdf`/`fetch`/`repo`, saved to `{raw_dir}/explore-judge-<n>.json`).
2. Write the unified dynamic blueprint to `{outline_path}`:
   - Include `## 全局研究边界` explicitly recording time window, hard constraints, **excluded homonyms/out-of-scope domains**, and any unverified `待验证假设`.
   - Map every `Q1..Qn` from `brief.md` to at least one subsection's `研究问题` block.
   - Include `>= {min_subsections}` total `### S<k>.<m>` subsections, consecutive `## S1..Sn` and `### S<k>.1..`, and all 4 non-empty `####` blocks (`内容范围`, `研究问题`, `必需实体 / 案例`, `来源线索`) under every subsection.
   - Under each subsection's `来源线索`, preserve all high-signal primary leads without artificial hard truncation, and place the top 2–3 highest-priority primary sources first with a `[核心必读]` tag so Diamond 2 knows which originals to read first.
3. Return summary JSON via `finish`.
"""
    judge_res = await judge(merge_prompt, schema=JUDGE_SCHEMA)
    log(
        f"Judge merged outline: {judge_res.get('sections')} sections, "
        f"{judge_res.get('subsections')} subsections, "
        f"excluded_homonyms={len(judge_res.get('excluded_homonyms') or [])}"
    )

    # ------------------------------------------------------------ State S4: Deterministic Gate & Local Repair/Fallback

    phase("S4. 确定性门禁与局部修补 (check-outline)")

    check_res = _run_check_outline(report_script, run_dir, outline_path, min_subsections=min_subsections)
    for repair_idx in range(1, max_repair_rounds + 1):
        if not check_res["errors"]:
            break
        log(f"Outline check found {len(check_res['errors'])} error(s); repair round {repair_idx}/{max_repair_rounds}")
        err_bullets = "\n".join(f"- {e}" for e in check_res["errors"])
        repair_prompt = f"""`report.py check-outline` reported the following deterministic errors on `{outline_path}`:
{err_bullets}

Make **minimal, targeted edits** to `{outline_path}` to fix ONLY these errors.
- Do NOT rewrite passing sections.
- Do NOT drop any existing required entities, exclusions, or source-lead URLs.
- Return the fixed items via `finish`.
"""
        await judge(repair_prompt, schema=REPAIR_SCHEMA)
        check_res = _run_check_outline(report_script, run_dir, outline_path, min_subsections=min_subsections)

    if not check_res["errors"] and os.path.isfile(outline_path):
        shutil.copyfile(outline_path, baseline_path)
        log(f"Judge outline passed check-outline (stats={check_res.get('stats')}); saved validated baseline.")
    else:
        log(f"Judge outline still has errors after repair: {check_res['errors']}; attempting fail-closed fallback.")
        best_cand, best_err_count = None, 10**9
        for v in usable_views:
            c_res = _run_check_outline(report_script, run_dir, v["path"], min_subsections=min_subsections)
            if len(c_res["errors"]) < best_err_count:
                best_cand, best_err_count, best_res = v, len(c_res["errors"]), c_res
        if best_cand and best_err_count < len(check_res["errors"]):
            shutil.copyfile(best_cand["path"], outline_path)
            shutil.copyfile(best_cand["path"], baseline_path)
            used_fallback_candidate = best_cand["view_id"]
            check_res = best_res
            log(f"Fallback activated: restored candidate `{used_fallback_candidate}` ({best_err_count} errors).")
        elif os.path.isfile(outline_path):
            shutil.copyfile(outline_path, baseline_path)

    final_check = check_res

    # ------------------------------------------------------------ State S5: Optional Critic HP# Gap Pass (Default OFF)

    if enable_critic and os.path.isfile(baseline_path) and not check_res["errors"]:
        phase("S5. 可选 Critic 缺口核查与无损回退")
        critic_ran = True
        critic_prompt = f"""You are an independent **Outline Critic** auditing `{outline_path}` against `{brief_path}`.

Task:
1. Read `{brief_path}` and `{outline_path}` carefully (respecting all exclusions under `## 全局研究边界` — do NOT re-introduce excluded homonyms!).
2. Run **1–3** targeted adversarial searches with `python3 "{research_script}"` (`--save {raw_dir}/explore-critic-<n>.json --brief`) to check if the outline missed any mainstream flagship method/system/benchmark, critical failure mode, or counter-evidence angle.
3. Write a concise Markdown critique to `{critic_path}`.
   - Tag ONLY genuine high-priority gaps as `HP1`, `HP2`, ... (at most 5 `HP#` items).
   - For each `HP#`, state: target subsection (`S<k>.<m>`), missing entity/question, and concrete source URL or query evidence.
   - If the outline already has strong coverage and no genuine high-priority gaps, write `No high-priority gaps found.` (with zero `HP#` tags) and set `has_gaps: false`.
4. Return structured summary via `finish`.
"""
        try:
            crit_res = await agent(
                critic_prompt,
                schema=CRITIC_SCHEMA,
                role="Outline Critic",
                type_name="self",
                model=judge_model,
            )
            crit_text = _read_text(critic_path) if os.path.isfile(critic_path) else ""
            critic_hp_ids = _extract_hp_ids(crit_text)
            log(f"Critic finished: has_gaps={crit_res.get('has_gaps')} | HP leads={critic_hp_ids}")

            if critic_hp_ids:
                revise_prompt = f"""Read `{critic_path}` and update `{outline_path}` under the **binding HP# + lossless contract**:

1. For EVERY `HP#` in `{critic_path}` ({', '.join(critic_hp_ids)}):
   - Either **absorb** it into the target subsection's `必需实体 / 案例` and/or `来源线索`, keeping `(HP#)` inline next to the added item;
   - Or **explicitly reject** it under `## 已拒绝的高优线索` with an evidence- or scope-based reason mentioning `HP#`.
   - NEVER silently drop any `HP#`.
2. **Lossless rule**: Do NOT remove any existing required entity or source-lead URL already present in `{outline_path}`.
3. Keep all 4 required `####` blocks intact under every subsection and zero `[E#]` citations.
4. Return fixed/updated summary via `finish`.
"""
                await judge(revise_prompt, schema=REPAIR_SCHEMA)
                post_check = _run_check_outline(
                    report_script,
                    run_dir,
                    outline_path,
                    critique_path=critic_path,
                    baseline_path=baseline_path,
                    min_subsections=min_subsections,
                )
                if post_check["errors"]:
                    log(f"Post-Critic revision failed lossless/HP check ({len(post_check['errors'])} errors); attempting 1 repair.")
                    err_bullets = "\n".join(f"- {e}" for e in post_check["errors"])
                    fix_rev_prompt = f"""`report.py check-outline --critique --baseline` rejected your revision of `{outline_path}`:
{err_bullets}

Fix ONLY these issues in `{outline_path}` (restore any lost baseline URLs/entities and ensure every HP# is absorbed or explicitly rejected under `## 已拒绝的高优线索`). Return summary via `finish`.
"""
                    await judge(fix_rev_prompt, schema=REPAIR_SCHEMA)
                    post_check = _run_check_outline(
                        report_script,
                        run_dir,
                        outline_path,
                        critique_path=critic_path,
                        baseline_path=baseline_path,
                        min_subsections=min_subsections,
                    )
                if post_check["errors"]:
                    shutil.copyfile(baseline_path, outline_path)
                    rolled_back = True
                    log(f"Fail-closed rollback: restored validated Judge baseline due to errors: {post_check['errors']}")
                else:
                    final_check = post_check
                    log(f"Critic revision passed lossless + HP# check (stats={post_check.get('stats')}).")
        except Exception as exc:
            if os.path.isfile(baseline_path):
                shutil.copyfile(baseline_path, outline_path)
                rolled_back = True
            log(f"Critic/Reviser step failed ({exc}); kept validated Judge baseline intact.")
finally:
    del judge

summary = {
    "status": "ok" if not final_check.get("errors") else "degraded",
    "tier": tier,
    "mode": mode,
    "anchor_path": anchor_path if anchor_created else None,
    "outline_path": outline_path,
    "baseline_path": baseline_path if os.path.isfile(baseline_path) else None,
    "views_ok": [v["view_id"] for v in usable_views],
    "views_failed": [v["view_id"] for v in failed_views],
    "fallback_candidate": used_fallback_candidate,
    "critic_ran": critic_ran,
    "critic_hp_ids": critic_hp_ids,
    "rolled_back": rolled_back,
    "errors": final_check.get("errors", []),
    "warnings": final_check.get("warnings", []),
    "stats": final_check.get("stats", {}),
}
print(json.dumps(summary, ensure_ascii=False, indent=2))

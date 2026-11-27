#!/usr/bin/env python3
"""topic-research run directory: brief, source and evidence log, citation check, and report rendering.

Stdlib only (Python >= 3.9). Every command prints one JSON object to stdout; errors print {"command", "error", "hint"}
and exit 2, and `check` exits 1 when it finds errors. The run directory is the hand-off between stages: workers append
sources and evidence through this script (appends are serialized by a lock, so parallel workers share one log),
writers read files instead of the chat, and `render` turns evidence citations like [E12] in draft.md into numbered
source references in report.md.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import research  # noqa: E402  (shares URL identity and date normalization with the retrieval CLI)

SOURCES, EVIDENCE, BRIEF, OUTLINE, DRAFT, REPORT = "sources.jsonl", "evidence.jsonl", "brief.md", "outline.md", "draft.md", "report.md"
KINDS = ("paper", "repo", "web", "docs", "post", "data", "other")
STANCES = ("supports", "contradicts", "context")
CITE = re.compile(r"\[(E\d+(?:\s*[,，;；]\s*E\d+)*)\]")
LOOSE_CITE = re.compile(r"\[[^\]\n]*\bE\d+[^\]\n]*\]")
# Sections about the run itself (method, cost, appendix) carry our own counts, not claims needing a source.
NO_CITE_HEADING = re.compile(r"方法|花费|附录|method|cost|appendix", re.I)
NUMBER = re.compile(r"\d+(?:\.\d+)?\s*%|\b\d+\.\d+\b|\b\d{2,}\b")
PLACEHOLDER = re.compile(r"\bTODO\b|\bTBD\b|待补|待定|\?\?\?|<!--\s*gaps:")
OUTLINE_H2 = re.compile(r"^##\s+S(\d+)\s*(?:[｜|:：]|\s+)(.+?)\s*$")
OUTLINE_H3 = re.compile(r"^###\s+S(\d+)\.(\d+)\s*(?:[｜|:：]|\s+)(.+?)\s*$")
OUTLINE_EXEMPT_H2 = re.compile(
    r"^##\s+(?:全局研究边界|global\s+research\s+boundaries|已拒绝的高优线索|rejected\s+high-priority\s+leads|变更记录|revision\s+log)\b",
    re.I,
)
OUTLINE_REJECTED_H = re.compile(r"^#{2,3}\s+(?:已拒绝的高优线索|rejected\s+high-priority\s+leads)\b", re.I)
OUTLINE_H4_KEYS = (
    ("scope", re.compile(r"^(?:内容范围|what\s+to\s+cover|scope)\s*$", re.I)),
    ("questions", re.compile(r"^(?:研究问题|research\s+questions?)\s*$", re.I)),
    ("entities", re.compile(r"^(?:必需实体\s*/?\s*案例|必需实体与案例|required\s+entities(?:\s*/\s*cases)?)\s*$", re.I)),
    ("leads", re.compile(r"^(?:来源线索|source\s+leads?)\s*$", re.I)),
)
URL_RE = re.compile(r"https?://[^\s<>()\[\]{}\"'`“”‘’、，。；（）]+", re.I)
HP_RE = re.compile(r"\bHP(\d+)\b", re.I)
MIN_OUTLINE_SUBSECTIONS = {"quick": 3, "deep": 6}

BRIEF_TEMPLATE = """# {topic}

- Request (verbatim): {request}
- Tier: {tier}
- Scope: problem or task / technical object / hard constraints (environment, date window, license, language, scale) / exclusions
- Budget: searches ≤ {searches}, reads ≤ {reads}
- Started: {started} (this run's counts and estimated spend: `research.py ledger --since {started}`)

## Questions the report must answer
<!-- One line each, "- Q1: …". Write them before searching; add a Q when reading shows a question the user needs answered. -->
- Q1:

## Done when
- every Q has an answer, or an explicit "unknown" with what was tried
- load-bearing claims cite evidence, and counter-evidence was searched for
- `report.py check` passes and the semantic review is recorded in audit.md
- report.md is rendered
"""
TIER_BUDGET = {"quick": (20, 10), "deep": (40, 25)}


class Fail(Exception):
    def __init__(self, message: str, hint: str | None = None):
        super().__init__(message)
        self.hint = hint


# ---------------------------------------------------------------- files

def run_dir(path: str) -> str:
    path = os.path.abspath(os.path.expanduser(path))
    if not os.path.isfile(os.path.join(path, BRIEF)):
        raise Fail(f"not a run directory (no {BRIEF}): {path}", hint="create one with `report.py init \"<topic>\"`")
    return path


def base_dir(explicit: str | None) -> str:
    """--base, else $TOPIC_RESEARCH_DIR, else ~/Documents/research, else ./research."""
    chosen = explicit or os.environ.get("TOPIC_RESEARCH_DIR")
    if chosen:
        return os.path.abspath(os.path.expanduser(chosen))
    docs = os.path.expanduser("~/Documents")
    return os.path.join(docs, "research") if os.path.isdir(docs) else os.path.abspath("research")


def slug(topic: str) -> str:
    s = re.sub(r"[^\w]+", "-", topic.strip().lower()).strip("-_")
    return s[:48].strip("-_") or "topic"


@contextlib.contextmanager
def locked(run: str):
    with open(os.path.join(run, ".lock"), "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def read_jsonl(path: str) -> list:
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def append_jsonl(path: str, rows: list) -> None:
    with open(path, "a", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def read_text(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def write_atomic(path: str, text: str) -> None:
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def rows_from(file: str) -> list:
    """--from FILE: JSON Lines, one record per line, keys named like the command's options."""
    try:
        return read_jsonl(file)
    except (OSError, json.JSONDecodeError) as e:
        raise Fail(f"--from {file}: {e}") from e


def text_arg(value: str | None) -> str | None:
    """`-` reads the value from stdin (long quotes without shell-quoting trouble)."""
    return sys.stdin.read() if value == "-" else value


# ---------------------------------------------------------------- commands

def cmd_init(a):
    base = base_dir(a.base)
    name = f"{dt.date.today().isoformat()}-{slug(a.topic)}"
    path, n = os.path.join(base, name), 2
    while os.path.exists(path):
        path, n = os.path.join(base, f"{name}-{n}"), n + 1
    for sub in ("notes", "raw"):
        os.makedirs(os.path.join(path, sub))
    default_searches, default_reads = TIER_BUDGET[a.tier]
    searches, reads = a.searches or default_searches, a.reads or default_reads
    started = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    write_atomic(os.path.join(path, BRIEF), BRIEF_TEMPLATE.format(
        topic=a.topic, request=(a.request or a.topic).replace("\n", " "), tier=a.tier, searches=searches, reads=reads,
        started=started))
    for f in (SOURCES, EVIDENCE):
        open(os.path.join(path, f), "a").close()
    return {"dir": path, "tier": a.tier, "budget": {"searches": searches, "reads": reads}, "started": started,
            "spend": f"research.py ledger --since {started}"}


def source_key(url: str) -> str:
    if not re.match(r"https?://", url):
        raise Fail(f"--url must be an http(s) URL: {url}", hint="use the canonical page: arXiv abs URL, repo URL, DOI URL")
    return research.url_id(url)


def default_family(key: str) -> str:
    """Sources in one family are not independent (a README and the docs of one project count once)."""
    if key.startswith("url:"):
        host = re.sub(r"^url:https?://", "", key).split("/")[0]
        return host
    return key


def add_sources(run: str, records: list, by: str | None = None) -> list:
    out = []
    with locked(run):
        rows = read_jsonl(os.path.join(run, SOURCES))
        by_key = {r["key"]: r for r in rows}
        new = []
        for rec in records:
            url, title = (rec.get("url") or "").strip(), (rec.get("title") or "").strip()
            if not title:
                raise Fail(f"source {url}: --title is required")
            kind = rec.get("kind") or "web"
            if kind not in KINDS:
                raise Fail(f"source {url}: kind must be one of {', '.join(KINDS)}")
            key = source_key(url)
            if key in by_key:
                out.append({"id": by_key[key]["id"], "new": False, "key": key})
                continue
            raw = rec.get("raw")
            if raw and not os.path.isabs(raw):   # relative: inside the run directory if it is there, else from cwd
                raw = os.path.join(run, raw) if os.path.exists(os.path.join(run, raw)) else os.path.abspath(raw)
            row = research.prune({
                "id": f"S{len(rows) + len(new) + 1}", "key": key, "url": url, "title": title, "kind": kind,
                "date": research.day(rec.get("date")), "family": rec.get("family") or default_family(key),
                "raw": os.path.relpath(raw, run) if raw else None, "by": rec.get("by") or by, "added": now()})
            new.append(row)
            by_key[key] = row
            out.append({"id": row["id"], "new": True, "key": key})
        append_jsonl(os.path.join(run, SOURCES), new)
    return out


def cmd_source(a):
    run = run_dir(a.dir)
    records = rows_from(a.from_file) if a.from_file else [
        {"url": a.url, "title": a.title, "kind": a.kind, "date": a.date, "family": a.family, "raw": a.raw}]
    if not a.from_file and not a.url:
        raise Fail("--url is required (or --from FILE)")
    out = add_sources(run, records, a.by)
    return out[0] if not a.from_file else {"items": out}


def add_evidence(run: str, records: list, by: str | None) -> list:
    out = []
    with locked(run):
        sources = {r["id"] for r in read_jsonl(os.path.join(run, SOURCES))}
        count = len(read_jsonl(os.path.join(run, EVIDENCE)))
        new = []
        for rec in records:
            src, quote, locator = rec.get("source"), (rec.get("quote") or "").strip(), (rec.get("locator") or "").strip()
            if src not in sources:
                raise Fail(f"unknown source {src}", hint="register it first with `report.py source`")
            if not quote or not locator:
                raise Fail(f"evidence for {src}: --quote and --locator are required",
                           hint="quote the source text itself; the locator is a page, section, table, line, or README heading")
            stance = rec.get("stance") or "supports"
            if stance not in STANCES:
                raise Fail(f"stance must be one of {', '.join(STANCES)}")
            row = research.prune({
                "id": f"E{count + len(new) + 1}", "source": src, "quote": quote, "locator": locator,
                "claim": rec.get("claim"), "conditions": rec.get("conditions"), "question": rec.get("question"),
                "stance": stance, "by": rec.get("by") or by, "added": now()})
            new.append(row)
            out.append({"id": row["id"], "source": src})
        append_jsonl(os.path.join(run, EVIDENCE), new)
    return out


def cmd_evidence(a):
    run = run_dir(a.dir)
    if a.from_file:
        return {"items": add_evidence(run, rows_from(a.from_file), a.by)}
    if not a.source:
        raise Fail("--source is required (or --from FILE)")
    return add_evidence(run, [{"source": a.source, "quote": text_arg(a.quote), "locator": a.locator, "claim": a.claim,
                               "conditions": a.conditions, "question": a.question, "stance": a.stance}], a.by)[0]


def questions(run: str) -> list:
    """Filled-in Q lines of brief.md."""
    return re.findall(r"^\s*-\s*(Q\d+)\s*[:：]\s*\S", read_text(os.path.join(run, BRIEF)), re.M)


def brief_tier(run: str) -> str:
    m = re.search(r"^\s*-\s*Tier\s*[:：]\s*(quick|deep)\b", read_text(os.path.join(run, BRIEF)), re.I | re.M)
    return m.group(1).lower() if m else "deep"


def _norm_token(text: str) -> str:
    s = unicodedata.normalize("NFKC", str(text or "")).casefold()
    s = re.sub(r"[‐‑‒–—−]", "-", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip(" \t\r\n.,;:!?，。；：！？`*_[]()")


def _extract_urls(text: str) -> list:
    seen, out = set(), []
    for raw in URL_RE.findall(text):
        u = raw.rstrip(".,;:!?，。；：！？\"'`”’」』】》）)")
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _extract_entities(block_text: str) -> list:
    labels, seen = [], set()
    for line in block_text.splitlines():
        item = re.sub(r"^\s*[-*+]\s+", "", line).strip()
        if not item or re.search(r"^(?:none|none identified|暂无|待确认|无)\b", item, re.I):
            continue
        item = re.sub(r"\s*\(?\bHP\d+\b\)?\s*", " ", item, flags=re.I).strip()
        linked = re.match(r"\[([^]]+)\]\([^)]+\)", item)
        if linked:
            item = linked.group(1).strip()
        item = re.sub(r"[*_`]", "", item)
        item = re.split(r"\s*(?:—|–|\s-\s|:|：)\s*", item, maxsplit=1)[0].strip()
        key = _norm_token(item)
        if 2 <= len(key) <= 100 and key not in seen:
            seen.add(key)
            labels.append(item)
    return labels


def _parse_outline(text: str) -> dict:
    """Parse Markdown-first dynamic outline (## S1 / ### S1.1 / 4 literal H4 blocks)."""
    sections, subsections, non_exempt_h2 = [], [], []
    cur_h2, cur_sub, cur_h4 = None, None, None
    code = False
    for i, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("```"):
            code = not code
            if cur_sub and cur_h4:
                cur_sub["blocks"][cur_h4].append(line)
            continue
        if code:
            if cur_sub and cur_h4:
                cur_sub["blocks"][cur_h4].append(line)
            continue
        if line.startswith("## ") and not line.startswith("### "):
            cur_sub, cur_h4 = None, None
            m = OUTLINE_H2.match(line)
            if m:
                cur_h2 = {"num": int(m.group(1)), "id": f"S{m.group(1)}", "title": m.group(2).strip(), "line": i}
                sections.append(cur_h2)
            elif OUTLINE_EXEMPT_H2.match(line):
                cur_h2 = None
            else:
                cur_h2 = None
                non_exempt_h2.append((i, line.strip()))
            continue
        if line.startswith("### ") and not line.startswith("#### "):
            cur_h4 = None
            m = OUTLINE_H3.match(line)
            if m:
                cur_sub = {
                    "parent": int(m.group(1)), "num": int(m.group(2)),
                    "id": f"S{m.group(1)}.{m.group(2)}", "title": m.group(3).strip(),
                    "line": i, "enclosing_h2": cur_h2["num"] if cur_h2 else None,
                    "blocks": {},
                }
                subsections.append(cur_sub)
            else:
                cur_sub = None
            continue
        if line.startswith("#### ") and cur_sub is not None:
            heading = line[5:].strip()
            matched = next((k for k, pat in OUTLINE_H4_KEYS if pat.match(heading)), None)
            cur_h4 = matched
            if matched is not None:
                cur_sub["blocks"].setdefault(matched, [])
            continue
        if cur_sub is not None and cur_h4 is not None:
            cur_sub["blocks"][cur_h4].append(line)
    return {"sections": sections, "subsections": subsections, "non_exempt_h2": non_exempt_h2}


def check_outline(
    run: str,
    outline_path: str,
    critique_path: str | None = None,
    baseline_path: str | None = None,
    min_subsections: int | None = None,
) -> dict:
    if not os.path.isfile(outline_path):
        raise Fail(f"no outline to check: {outline_path}", hint="run Stage 1 exploration/merge to write outline.md")
    text = read_text(outline_path)
    errors, warnings = [], []
    stripped = text.lstrip()
    if stripped.startswith("{") or stripped.startswith("[") or re.match(r"^```json\b", stripped, re.I):
        errors.append("outline.md must be Markdown-first, not JSON")
    first_nonempty = next((ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("<!--")), "")
    if not first_nonempty.startswith("# "):
        errors.append("outline.md must begin with a level-1 Markdown title (`# ...`)")

    parsed = _parse_outline(text)
    sections, subs = parsed["sections"], parsed["subsections"]
    tier = brief_tier(run)
    min_subs = min_subsections if min_subsections is not None else MIN_OUTLINE_SUBSECTIONS.get(tier, 6)

    if not sections:
        errors.append("outline.md has no numbered main sections (`## S1｜...`)")
    else:
        nums = [s["num"] for s in sections]
        if nums != list(range(1, len(nums) + 1)):
            errors.append(f"main section IDs must be consecutive S1..S{len(nums)}, got {[s['id'] for s in sections]}")
    for line_no, heading in parsed["non_exempt_h2"]:
        warnings.append(f"line {line_no}: unnumbered H2 heading `{heading}` (use `## S<n>｜...` for main sections)")

    if len(subs) < min_subs:
        errors.append(f"outline.md has {len(subs)} subsection(s); need at least {min_subs} for {tier} tier")

    seen_sub, by_parent = set(), {}
    all_entities, all_lead_urls = [], []
    required_labels = {
        "scope": "内容范围 / What to Cover",
        "questions": "研究问题 / Research Questions",
        "entities": "必需实体 / 案例 / Required Entities / Cases",
        "leads": "来源线索 / Source Leads",
    }
    for sub in subs:
        sid = sub["id"]
        if sid in seen_sub:
            errors.append(f"line {sub['line']}: duplicate subsection ID {sid}")
        seen_sub.add(sid)
        if sub["enclosing_h2"] != sub["parent"]:
            errors.append(f"line {sub['line']}: subsection {sid} sits under S{sub['enclosing_h2']} instead of S{sub['parent']}")
        by_parent.setdefault(sub["parent"], []).append(sub["num"])
        for key, label in required_labels.items():
            body = "\n".join(sub["blocks"].get(key, [])).strip()
            if key not in sub["blocks"]:
                errors.append(f"{sid}: missing required H4 block `#### {label}`")
            elif not body:
                errors.append(f"{sid}: required H4 block `#### {label}` is empty")
        ent_body = "\n".join(sub["blocks"].get("entities", []))
        lead_body = "\n".join(sub["blocks"].get("leads", []))
        all_entities.extend(_extract_entities(ent_body))
        sub_urls = _extract_urls(lead_body)
        all_lead_urls.extend(sub_urls)
        if lead_body.strip() and not sub_urls and not re.search(r"待检索|待补查|to fetch|none identified", lead_body, re.I):
            warnings.append(f"{sid}: 来源线索 / Source Leads lists no http(s) URL (add search-grounded leads or mark `待检索`)")

    for parent, child_nums in sorted(by_parent.items()):
        if child_nums != list(range(1, len(child_nums) + 1)):
            errors.append(f"S{parent} subsections must be consecutive S{parent}.1..S{parent}.{len(child_nums)}, got {child_nums}")

    # Brief Q1..Qn coverage (error in Stage 1 so no user question is silently dropped)
    qs = questions(run)
    covered_qs = [q for q in qs if re.search(rf"\b{q}\b", text)]
    for q in qs:
        if q not in covered_qs:
            errors.append(f"{q} from brief.md is not mapped in outline.md")

    # Guard against fake [E#] citations in Stage 1 (leads != evidence)
    evidence_ids = {r["id"] for r in read_jsonl(os.path.join(run, EVIDENCE))}
    for i, line in enumerate(text.splitlines(), 1):
        for g in CITE.findall(line):
            for eid in (x.strip() for x in re.split(r"[,，;；]", g)):
                if eid not in evidence_ids:
                    errors.append(f"line {i}: unknown evidence citation [{eid}] in outline.md (leads are not evidence)")
        if PLACEHOLDER.search(line):
            warnings.append(f"line {i}: placeholder left in outline.md: {line.strip()[:80]}")

    # Optional Critic HP# disposition check
    hp_total, hp_resolved = 0, 0
    if critique_path:
        if not os.path.isfile(critique_path):
            raise Fail(f"critique file not found: {critique_path}")
        crit_text = read_text(critique_path)
        hp_ids = sorted({f"HP{m}" for m in HP_RE.findall(crit_text)}, key=lambda x: int(x[2:]))
        present_hp = {f"HP{m}" for m in HP_RE.findall(text)}
        hp_total = len(hp_ids)
        hp_resolved = len([h for h in hp_ids if h in present_hp])
        for h in hp_ids:
            if h not in present_hp:
                errors.append(f"Critic lead {h} was neither absorbed nor explicitly rejected in outline.md")

    # Optional lossless non-regression check against Judge baseline
    if baseline_path:
        if not os.path.isfile(baseline_path):
            raise Fail(f"baseline file not found: {baseline_path}")
        base_text = read_text(baseline_path)
        base_parsed = _parse_outline(base_text)
        after_urls = set(_extract_urls(text))
        after_norm = _norm_token(text)
        for u in _extract_urls(base_text):
            if u not in after_urls:
                errors.append(f"lossless guard: revision dropped baseline lead URL {u}")
        base_entities = []
        for sub in base_parsed["subsections"]:
            base_entities.extend(_extract_entities("\n".join(sub["blocks"].get("entities", []))))
        seen_e = set()
        for ent in base_entities:
            k = _norm_token(ent)
            if k in seen_e:
                continue
            seen_e.add(k)
            if k not in after_norm:
                errors.append(f"lossless guard: revision dropped baseline entity `{ent}`")

    return {
        "errors": errors,
        "warnings": warnings,
        "stats": {
            "tier": tier,
            "sections": len(sections),
            "subsections": len(subs),
            "questions_covered": len(covered_qs),
            "questions_total": len(qs),
            "entities": len(set(_norm_token(e) for e in all_entities)),
            "lead_urls": len(set(all_lead_urls)),
            "hp_total": hp_total,
            "hp_resolved": hp_resolved,
        },
    }


def cmd_check_outline(a):
    run = run_dir(a.dir)
    outline_path = os.path.abspath(a.outline) if a.outline else os.path.join(run, OUTLINE)
    critique_path = os.path.abspath(a.critique) if a.critique else None
    baseline_path = os.path.abspath(a.baseline) if a.baseline else None
    return check_outline(run, outline_path, critique_path, baseline_path, a.min_subsections)


def scan_draft(text: str):
    """Yield (line_no, line, cites, in_no_cite_section, in_code) for every line of the draft."""
    no_cite = code = False
    for i, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("```"):
            code = not code
            yield i, line, [], no_cite, True
            continue
        m = re.match(r"^(#{1,6})\s+(.*)", line)
        if m and not code:   # the title block (scope line) and method/cost/appendix sections hold the run's own counts
            no_cite = len(m.group(1)) == 1 or bool(NO_CITE_HEADING.search(m.group(2)))
        cites = [e.strip() for g in CITE.findall(line) for e in re.split(r"[,，;；]", g)]
        yield i, line, cites, no_cite, code


def check(run: str, draft: str) -> dict:
    sources = {r["id"]: r for r in read_jsonl(os.path.join(run, SOURCES))}
    evidence = {r["id"]: r for r in read_jsonl(os.path.join(run, EVIDENCE))}
    errors, warnings = [], []
    for e in evidence.values():
        if e["source"] not in sources:
            errors.append(f"{e['id']} points to unknown source {e['source']}")
    if not os.path.isfile(draft):
        raise Fail(f"no draft to check: {draft}", hint="writers produce draft.md; render makes report.md from it")
    text = read_text(draft)
    cited, uncited_numbers = [], []
    lines = list(scan_draft(text))
    # The number check works on units: a paragraph, a list item with its indented continuation, or a table row.
    # A unit passes if it cites anything, so one citation cannot cover a whole list or table.
    block, blocks = [], []
    for row in lines:
        line, code = row[1], row[4]
        starts_unit = not code and re.match(r"^\s*(\||[-*+]\s|\d+[.)]\s)", line)
        if not line.strip() or (not code and line.lstrip().startswith("#")) or starts_unit:
            if block:
                blocks.append(block)
            block = [row] if starts_unit else []
            continue
        block.append(row)
    if block:
        blocks.append(block)
    for i, line, cites, _, code in lines:
        if code:
            continue
        for e in cites:
            cited.append(e)
            if e not in evidence:
                errors.append(f"line {i}: unknown evidence {e}")
        for m in LOOSE_CITE.finditer(line):
            if not CITE.fullmatch(m.group(0)):
                warnings.append(f"line {i}: malformed citation {m.group(0)} (use [E3] or [E3, E7])")
        if PLACEHOLDER.search(line):
            warnings.append(f"line {i}: placeholder left in the draft: {line.strip()[:80]}")
        if re.match(r"^#{1,6}\s+(参考文献|references)\s*$", line.strip(), re.I):
            warnings.append(f"line {i}: draft has its own references heading; `render` writes the reference list")
    for b in blocks:
        if any(r[2] for r in b) or all(r[3] or r[4] for r in b):
            continue
        for i, line, _, no_cite, code in b:
            if not (no_cite or code) and NUMBER.search(line) and not re.match(r"^\s*\|?\s*:?-{3,}", line):
                uncited_numbers.append(f"line {i}: {line.strip()[:100]}")
                break
    if uncited_numbers:
        warnings.append(f"{len(uncited_numbers)} paragraph(s) or table row(s) state numbers with no citation; "
                        "cite them or mark them as your own inference")
    qs = questions(run)
    if not qs:
        warnings.append("brief.md lists no questions (- Q1: …)")
    outline = read_text(os.path.join(run, OUTLINE)) if os.path.isfile(os.path.join(run, OUTLINE)) else ""
    asked = {e.get("question") for e in evidence.values()}
    for q in qs:
        if outline and not re.search(rf"\b{q}\b", outline):
            warnings.append(f"{q} is not mapped to a section in outline.md")
        if q not in asked:
            warnings.append(f"{q} has no evidence recorded for it (evidence --question {q})")
    if outline:
        for e in sorted(set(re.findall(r"\bE\d+\b", outline)) - set(evidence), key=lambda x: int(x[1:])):
            warnings.append(f"outline.md references unknown evidence {e}")
    cited_set = set(cited)
    return {"errors": errors, "warnings": warnings, "uncited_numbers": uncited_numbers[:15],
            "stats": {"sources": len(sources), "evidence": len(evidence), "citations": len(cited),
                      "cited_evidence": len(cited_set & set(evidence)),
                      "cited_sources": len({evidence[e]["source"] for e in cited_set if e in evidence}),
                      "uncited_number_blocks": len(uncited_numbers)}}


def cmd_check(a):
    run = run_dir(a.dir)
    return check(run, os.path.abspath(a.draft) if a.draft else os.path.join(run, DRAFT))


def cmd_render(a):
    run = run_dir(a.dir)
    draft = os.path.abspath(a.draft) if a.draft else os.path.join(run, DRAFT)
    result = check(run, draft)
    if result["errors"]:
        raise Fail(f"{len(result['errors'])} check error(s): {result['errors'][:3]}", hint="run `report.py check` and fix them")
    sources = {r["id"]: r for r in read_jsonl(os.path.join(run, SOURCES))}
    evidence = {r["id"]: r for r in read_jsonl(os.path.join(run, EVIDENCE))}
    order, used = [], {}

    def number(m):
        nums = []
        for e in (x.strip() for x in re.split(r"[,，;；]", m.group(1))):
            s = evidence[e]["source"]
            if s not in order:
                order.append(s)
            used.setdefault(s, [])
            if evidence[e]["locator"] not in used[s]:
                used[s].append(evidence[e]["locator"])
            n = order.index(s) + 1
            if n not in nums:
                nums.append(n)
        return "[" + ", ".join(map(str, sorted(nums))) + "]"

    out, code = [], False
    for line in read_text(draft).splitlines():
        if line.lstrip().startswith("```"):
            code = not code
        out.append(line if code else CITE.sub(number, line))
    body = "\n".join(out).rstrip()
    zh = bool(re.search(r"[\u4e00-\u9fff]", body))
    sep, used_label, wrap = ("，", "用到：", "（{}）") if zh else ("; ", "used: ", " ({})")
    refs = []
    for n, sid in enumerate(order, 1):
        s = sources[sid]
        meta = [x for x in (s.get("kind"), s.get("date")) if x]
        if used[sid]:
            meta.append(used_label + ("；" if zh else "; ").join(used[sid][:6]))
        refs.append(f"- [{n}] {s['title']}. <{s['url']}>" + (wrap.format(sep.join(meta)) if meta else ""))
    text = body + "\n\n## " + ("参考文献" if zh else "References") + "\n\n" + "\n".join(refs) + "\n"
    path = os.path.join(run, REPORT)
    write_atomic(path, text)
    return {"report": path, "sources_cited": len(order), "evidence_cited": result["stats"]["cited_evidence"],
            "warnings": result["warnings"]}


# ---------------------------------------------------------------- CLI

class JsonArgParser(argparse.ArgumentParser):
    def error(self, message):
        raise Fail(message, hint=self.format_usage().strip())


def build_parser() -> argparse.ArgumentParser:
    p = JsonArgParser(prog="report.py", description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="command", required=True)

    i = sub.add_parser("init", help="create a run directory with brief.md, sources.jsonl, evidence.jsonl, notes/, raw/")
    i.add_argument("topic")
    i.add_argument("--request", help="the user's request, verbatim (default: the topic)")
    i.add_argument("--tier", choices=list(TIER_BUDGET), default="deep")
    i.add_argument("--searches", type=int, help="search budget when the user set one (default: by tier)")
    i.add_argument("--reads", type=int, help="read budget when the user set one (default: by tier)")
    i.add_argument("--base", help="parent directory (default: $TOPIC_RESEARCH_DIR, else ~/Documents/research)")

    s = sub.add_parser("source", help="register a source; the same URL identity returns the existing id")
    s.add_argument("dir")
    s.add_argument("--url")
    s.add_argument("--title")
    s.add_argument("--kind", choices=KINDS, default="web")
    s.add_argument("--date", help="first publication (arXiv v1) or first release, YYYY-MM-DD or YYYY; omit when unknown")
    s.add_argument("--family", help="independence group: sources of one project or one author count once")
    s.add_argument("--raw", help="saved full text of the source (a research.py --save file); stored relative to the run directory")
    s.add_argument("--by", help="worker name, when several agents share the run")
    s.add_argument("--from", dest="from_file", metavar="FILE", help="JSON Lines of {url,title,kind,date,family,raw}")

    e = sub.add_parser("evidence", help="record a quote from a source that supports or contradicts a claim")
    e.add_argument("dir")
    e.add_argument("--source", help="source id, e.g. S3")
    e.add_argument("--quote", help="the source's own words (or table cells); - reads stdin")
    e.add_argument("--locator", help="page, section, table, figure, line, or README heading")
    e.add_argument("--claim", help="what this evidence shows, in your words")
    e.add_argument("--conditions", help="dataset, version, hardware, judge, baseline the numbers depend on")
    e.add_argument("--question", help="brief.md question id, e.g. Q2")
    e.add_argument("--stance", choices=STANCES, default="supports")
    e.add_argument("--by", help="worker name, when several agents share the run")
    e.add_argument("--from", dest="from_file", metavar="FILE",
                   help="JSON Lines of {source,quote,locator,claim,conditions,question,stance}")

    c = sub.add_parser("check", help="mechanical checks of draft.md: citation ids, uncited numbers, question coverage")
    c.add_argument("dir")
    c.add_argument("--draft", help="file to check (default: <dir>/draft.md)")

    co = sub.add_parser("check-outline", help="deterministic validation of dynamic outline.md (4-block spec, Q coverage, Critic HP#, baseline non-regression)")
    co.add_argument("dir")
    co.add_argument("--outline", help="outline file to check (default: <dir>/outline.md)")
    co.add_argument("--critique", help="optional Critic report with HP1/HP2 leads; verifies each HP# is absorbed or explicitly rejected")
    co.add_argument("--baseline", help="optional Judge baseline outline; rejects revisions that silently drop baseline URLs or entities")
    co.add_argument("--min-subsections", type=int, help="override minimum subsection count (default: 3 for quick, 6 for deep)")

    r = sub.add_parser("render", help="draft.md -> report.md: [E12] becomes numbered source references plus a reference list")
    r.add_argument("dir")
    r.add_argument("--draft", help="file to render (default: <dir>/draft.md)")
    return p


COMMANDS = {
    "init": cmd_init, "source": cmd_source, "evidence": cmd_evidence,
    "check": cmd_check, "check-outline": cmd_check_outline, "render": cmd_render,
}


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    command, a = next((x for x in argv if not x.startswith("-")), None), None
    try:
        a = build_parser().parse_args(argv)
        payload = COMMANDS[a.command](a)
        out = {"command": a.command, **payload}
        code = 1 if payload.get("errors") else 0
    except Fail as e:
        out, code = {"command": getattr(a, "command", command), "error": str(e), "hint": e.hint}, 2
    except Exception as e:  # noqa: BLE001 - the contract is one JSON object, even for bugs
        out, code = {"command": getattr(a, "command", command), "error": f"{type(e).__name__}: {e}",
                     "hint": "unexpected failure in report.py"}, 2
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return code


if __name__ == "__main__":
    sys.exit(main())

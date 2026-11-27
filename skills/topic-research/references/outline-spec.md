# Dynamic Outline Contract (`outline.md`)

`outline.md` is a **living Markdown blueprint** (never JSON) created right after Stage 1 multi-perspective exploration and evolved into an evidence-bound writing map before `draft.md`.

## Two lifecycle stages

1. **Diamond 1 — Exploration Blueprint (`topic-research-plan`, before deep reading)**
   - Built by adaptive entry (`anchored` 1-step target disambiguation for specific named algorithms/lineages, or direct `landscape` fan-out for broad surveys) → 2 (`quick`) or 3 (`deep`) isolated orthogonal explorers → a search/read-enabled **3-bucket Judge** (with optional Critic gap pass, default OFF).
   - For the core mechanism/taxonomy perspective, anchor mainstream routes via a 3-step ladder: **recent surveys/taxonomies first → time-windowed high-citation papers (`citations_this_year`) if `< 2` strong surveys → 1 recent-6-month patch (`alphaxiv`/`hf`)** to counter lag. Treat surveys strictly as maps to locate **primary paper/tech-report leads**, never second-hand evidence.
   - Judge explicitly triages candidates into 3 buckets: **core main-line** (primary subsections + clear ownership), **vertical/horizontal comparison** (verified predecessors & same-constraint alternatives), and **homonym / out-of-scope exclusions** (recorded under `## 全局研究边界` so Diamond 2 does not step into the same noise). Ambiguous lineage MUST be verified by reading primary abstract/intro/README (`pdf`/`fetch`/`repo`), or else explicitly tagged `待验证假设`.
   - Drives deep retrieval: every subsection states exact scope, mapped `Q#` questions, must-check entities/cases, and **source leads**.
   - **Leads are NOT evidence.** URLs under `来源线索 / Source Leads` are fetch targets for Diamond 2, never final citations. Do not place `[E#]` citations in `outline.md` until those quotes are recorded in `evidence.jsonl`.
2. **Stage 2 — Evidence Map (Step 8, before writing `draft.md`)**
   - After deep reading and `analysis.md`, update `outline.md` (at most 2 structural revisions) to attach each subsection's one-sentence argument, verified `[E#]` evidence IDs, remaining gaps, and target length range.

## Required Markdown structure

Validated deterministically by `python3 scripts/report.py check-outline <run_dir>`.

- Starts with `# <Topic>` (level-1 heading).
- Optional `## 全局研究边界` / `## Global Research Boundaries` before `S1` (time window, constraints, exclusions).
- Consecutive main sections: `## S1｜<title>`, `## S2｜<title>`, …
- Consecutive subsections under each parent: `### S1.1｜<title>`, `### S1.2｜<title>`, …
  - Minimum subsections: `>= 3` (`quick`), `>= 6` (`deep`).
- **Every `### S<k>.<m>` MUST contain all 4 non-empty `####` blocks** (Chinese or English headings accepted):
  1. `#### 内容范围` / `#### What to Cover` — what belongs here and what stays out (avoid cross-section duplication).
  2. `#### 研究问题` / `#### Research Questions` — explicit `Q#` IDs from `brief.md` plus concrete sub-questions.
  3. `#### 必需实体 / 案例` / `#### Required Entities / Cases` — flagship papers, systems, repos, benchmarks, or counter-examples that deep retrieval must check.
  4. `#### 来源线索` / `#### Source Leads` — `URL — what it may establish` (fetched and verified later; place the top 2–3 highest-signal primary sources first tagged `[核心必读]` while preserving remaining valid leads below as an extended index; write `待检索` only if no URL was found in light exploration).
- Optional trailing section after Critic review: `## 已拒绝的高优线索` / `## Rejected High-Priority Leads`.

## Critic `HP#` binding contract (`deep` tier)

When an independent Critic raises high-priority gaps (`HP1`, `HP2`, … in `notes/plan/critic.md`):
- **Absorb**: add the entity/lead into the target subsection and keep `(HP#)` inline next to it, **OR**
- **Explicitly reject**: list `- HP#: <reason backed by scope or evidence>` under `## 已拒绝的高优线索`.
- **Never silently drop an `HP#`** and **never delete previously verified baseline URLs or entities** — `report.py check-outline --critique ... --baseline ...` enforces both and triggers automatic rollback to `notes/plan/judge-baseline.md` on failure.

## Minimal example

```markdown
# Deep Research Systems Architecture

## 全局研究边界
- 时间窗：2024-01 至 2026-11；聚焦多跳检索、上下文工程与评测闭环；排除纯 UI 包装产品。

## S1｜规划与多视角探索
### S1.1｜先探索再规划与动态大纲
#### 内容范围
分析为何静态大纲易漏主流方案，对比多视角并行轻探索与查证式合并机制；不展开底层检索引擎细节（归 S2.1）。

#### 研究问题
- Q1：现代 Deep Research 系统如何防止初始大纲遗漏关键路线？

#### 必需实体 / 案例
- LongCat-DeepResearch — 多 Writer 并行规划 + 查证式 Judge 合并
- Stanford STORM (HP1) — 同类目录启发式正交视角发现

#### 来源线索
- https://arxiv.org/abs/2506.xxxxx — LongCat 规划模块消融表与架构细节
- https://github.com/stanford-oval/storm (HP1) — Persona 生成与大纲合并实现

## 已拒绝的高优线索
- HP2：某闭源商业营销白皮书无架构细节与可复现数据，超出技术架构范围。
```

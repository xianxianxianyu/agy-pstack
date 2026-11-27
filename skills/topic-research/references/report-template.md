# Report template

Write in the user's language. Keep identifiers, titles, and quotes in their original form. This is the shape of `draft.md`; `report.py render` turns its `[E12]` citations into numbered references and appends the reference list, so the draft has no references section of its own.

The report explains and decides; it is not a list of links. Every main route gets the depth a reader needs to use it: what it is, why it works, how it works, the evidence, its limits, and how it relates to the alternatives. Length follows the questions in `brief.md`: when evidence is thin, say so instead of padding. Drop sections that have nothing to say (a quick report often has no "Disputes"), but keep "Open questions and gaps" and "Method and cost".

```markdown
# <Topic>: <report | 调研报告> (<date>)

> **Scope.** <one sentence: problem, constraints, date window, exclusions> · **Tier** quick|deep · **Search** <n> searches, <n> reads, <n> sources, <n> evidence quotes · **Estimated cost** $<ledger total_usd>

## Conclusions
<The 3–6 things the user should take away, each one or two sentences, most important first, each with its evidence [E..].
Then the recommendation for the user's situation and the main open risk. Mark anything beyond what the sources measured as [推断] / [inference].>

## Background and map
<The problem, the terms the field uses for it, and how the routes below relate (a small table or a mermaid diagram when it helps).
Only what a reader needs to follow the rest.>

## <Route, approach, or question 1>
<What it is · why it works · how it works (mechanism, data, architecture) · evidence (numbers with dataset, version, settings, baseline, date) ·
limits and failure modes · relation to the other routes. Cite each claim. Prose first; a table only where it compares.>

## <Route, approach, or question 2 …>

## Comparison
| Route | Best at | Evidence (conditions) | Cost / requirements | Maturity | Main risk |
|---|---|---|---|---|---|
<Each cell cites its evidence. Numbers from different benchmarks, judges, or versions are not put in one ranking column.>

## Disputes and counter-evidence
<Where sources disagree and why (different conditions vs real contradiction), negative results, outdated claims, single-source claims.>

## Recommendations
<By scenario: "if you need X under Y, use Z because …; check W first". Each one names its deciding evidence and how to verify it in the user's environment.>

## Materials to read first
| # | Work | Kind | Date | Axes (score, confidence) | Why it qualifies |
|---|---|---|---|---|---|
| 1 | <title> | paper+code | 2026-09-14 | F 85 confirmed · H 70 supported | <one line> [E..] |
<The accepted works under references/rubric.md, best first; 8–15 for a deep report, fewer for quick. Dates say first release or last update.>

## Open questions and gaps
- <question with no answer, or no qualifying evidence, and what was tried>
- To verify: <promising work whose gate is not cleared yet, and the missing evidence>
- Rejected but notable: <work and the reason: off-topic, marketing-only benchmark, empty repo, duplicate of #3>

## Method and cost
<Questions from brief.md, sources searched (providers), counts and spend from `research.py ledger`, what was read in full vs from excerpts,
the review done (how many claims checked, how many sampled, outcomes from audit.md), and anything not run. The run directory path.>
```

Rules:
- Every number names its conditions (dataset, version, hardware, judge, baseline, date) and is cited.
- One citation per claim, placed right after it; a table row or list item cites its own evidence.
- Facts, the authors' interpretations, and your inferences stay distinguishable.
- Mark "not run" for anything you did not execute; do not imply you deployed it.
- Every work has a date, and the text says whether it is first release or last update; "date unknown" when it is.
- High readability without losing information entropy: conclusion first per section, short paragraphs (≤ 250 Chinese chars / ~3–4 lines), compact table cells (≤ 90 chars), Mermaid diagrams for complex architectures/flows, and `<details>` collapsible blocks for dense ablation or raw parameter breakdowns (with all `[E#]` citations intact).
- Section ownership: explain each flagship method/system once in its primary section; cross-reference elsewhere instead of repeating.
- Counts and spend come from `research.py ledger --since <started>` (the time in brief.md); call the spend estimated (list prices).
- The run's own counts may appear only in the title block (the scope line) and in sections headed Method, Cost, or Appendix (方法 / 花费 / 附录); those are exempt from the uncited-number check.

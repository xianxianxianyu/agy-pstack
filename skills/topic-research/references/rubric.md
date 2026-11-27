# Evidence rubric

Decide one candidate at a time, after reading its source. A candidate is a **work**: a paper, its code, model, blog post, and benchmark entry are one work with several sources, not several items.

## 1. Relevance gate R (0–4)

Break the topic into: problem or task, technical object, hard constraints (environment, date window, license, language, scale, latency or cost target), and exclusions.

| R | Meaning |
|---|---|
| 0 | Unrelated |
| 1 | Shares vocabulary only |
| 2 | Adjacent or partially applicable |
| 3 | Directly addresses the problem; the source text supports it |
| 4 | Directly addresses the problem and fits the stated constraints |

- Accept only **R ≥ 3**. Every R ≥ 3 must cite a quote from the source. A title, snippet, or embedding hit is not enough.
- A hard constraint that is clearly violated rejects the work. An unknown constraint goes to the "to verify" list; never mark it passed.
- Citations, stars, and "SOTA" claims cannot rescue an off-topic work.

## 2. Three axes, scored independently (0–100 each)

**Accept = R ≥ 3 AND hard constraints pass AND (F ≥ 60 OR P ≥ 60 OR H ≥ 60), and the passing axis also clears its gate.** Do not average the axes; a strong practical tool must not lose to a weak new paper.

### Frontier F

| Signal | Points | Rule |
|---|---:|---|
| First release date | 0–40 | Age as a fraction of the frontier window W (default 365 days): ≤ W/12 → 40 · ≤ W/4 → 30 · ≤ W/2 → 20 · ≤ W → 10 · older 0. With the default window that is 30 / 90 / 180 / 365 days. Use first publication (arXiv v1) or a substantive new version, not the crawl date or a typo revision. Year-only dates get the points of the year's oldest possible day. |
| Concrete novelty vs prior work | 0–35 | Names the new method, capability, scale, or resource and compares to named prior work. Adjectives alone ("novel", "SOTA") ≤ 5. |
| Early independent attention | 0–15 | Citation velocity, HF Papers upvotes, independent technical discussion. Reposts of one announcement count once. |
| Checkable evidence | 0–10 | Paper or technical report is readable; method and limitations can be inspected. |

Gate: confirmed date inside the window **and** novelty shown in the primary source. A zero-citation new paper can pass on 40 + 35 + 10. Attention alone never passes.

### Practical P

| Signal | Points | Rule |
|---|---:|---|
| Usable artifact | 0–35 | Code, weights, or package exists and matches the work. Empty repo, "coming soon", or README only = 0. A tagged release with examples scores higher. |
| Deployability stated | 0–25 | License, dependencies, install and config, hardware/memory/quantization, data needs; checked against the user's environment. A GPU-cluster method is not "deployable on a VPS". |
| Usage evidence | 0–25 | Independent downstream code that really calls it (`research.py usage`), or a checkable production write-up (scale, latency, cost). Stars and downloads give at most 5 of these points. |
| Maintenance and reproducibility | 0–15 | Recent meaningful release, issue responses, pinned versions, runnable instructions, tests or eval scripts. |

Gate: (a real implementation **and** checkable deployment instructions) **or** independent production evidence. If you did not run it, write "code and docs available, not run". Closed-source work with verifiable production use can pass.

### High-performance H

| Signal | Points | Rule |
|---|---:|---|
| Same-task benchmark result | 0–35 | Same dataset, version, split, metric, and settings as the user's task; high points only for top-tier or a clear win over strong baselines. |
| Independence | 0–25 | Independent reproduction 25 · credible third-party leaderboard with full method 20 · author numbers with raw logs 10 · marketing only 0. |
| Re-runnable method | 0–25 | Code, config, revision, sample size, compute budget, variance or CI. |
| Relevant efficiency | 0–15 | Meaningful quality–latency–cost improvement for this topic, with no skipped work or hidden errors. |

Gate: at least one quantitative, directly relevant benchmark whose comparison conditions you confirmed. Self-declared SOTA with no setup fails. If the gap is within noise or the CIs overlap, write "same tier". Old work can pass on P or H; it does not need to be new.

## 3. Confidence, separate from score

For each axis that passes, attach a confidence level:

- `confirmed`: primary artifact or source text **plus** independent evidence or an auditable measurement.
- `supported`: clear author evidence, no independent check yet.
- `tentative`: abstract, aggregator, or incomplete material. Do not list it as satisfied; keep it in "to verify".

These void the claim instead of costing points: a retraction, code that does not match the paper, a fabricated citation, or benchmark leakage. Unknown is not negative, and it earns no points either.

## 4. Velocity, computed the same way every time

- **Citations**: `(C_now − C_then) / days` from the same provider and the same ID. With a single snapshot, use OpenAlex's `citations_this_year` / `citations_last_year` (calendar-year buckets) and say so. Never compare counts across providers.
- **Stars**: 30-day new stars (`stars_30d` from GitHub's aggregate history) next to the total. Never use stargazer identity lists.
- Compare within the same topic and age band. With fewer than 20 peers, do not claim "top percentile". Keep citations, stars, upvotes, and HN points in separate columns; never add them up.

## 5. Source traps

| Trap | Instead |
|---|---|
| Listicles, aggregators, vendor comparison pages | Follow through to the original paper, repo, or benchmark. |
| omp `web_search` snippets (cut at 240 chars) | Use `research.py web` excerpts or `fetch` the page. |
| Open LLM Leaderboard (retired 2025-03-13) | Use the task's official leaderboard, Artificial Analysis, or the paper's table. |
| paperswithcode.com links | The rebuilt site is paperswithcode.co. Verify every number against the original. |
| Arena scores for objective tasks | Arena is human preference; use it only as a supplement. |
| Bing Search API, Google CSE in tutorials | Retired or closing; skip those code paths. |
| One announcement counted many times | Paper + blog + repo + tweet = one work. |

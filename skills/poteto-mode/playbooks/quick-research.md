### Quick research

**You own a fast, grounded comparison table. Parallel search, verify top picks against primary sources, answer directly in chat.**

Read-only external lookup for tool, library, skill, or approach selection when a full Double-Diamond report is overkill. Reuse `skills/topic-research/scripts/research.py` directly without creating `brief.md`, `outline.md`, or a report directory. Keep any saved `--save` JSON inside the session scratch directory; never pollute the workspace.

1. **Parallel search (`parallel` + `exa`):** Run `research.py web --provider parallel --brief` (broad comparisons, recent reviews, Chinese/English community context) and `research.py web --provider exa --brief` (technical docs, primary sites, repos) in parallel in the same turn. For open-source tools, libraries, or skills, add `research.py repos --sort stars --brief` (and `hn` when community signal matters) in the same batch.
2. **One-hop primary check:** Never conclude from search snippets alone. For the top 3–5 candidates, run one parallel pass of `research.py repo <owner/repo> --brief` (real stars, recent activity, README scope) and/or `research.py fetch --brief` on 1–2 recent benchmarks or official docs.
3. **Compare and judge:** Present a compact comparison table (candidate with link, real metric/positioning, core mechanism, pros/cons and best-fit scenario), call out 2–3 non-obvious gotchas or counter-evidence found in primary sources, and give 1–2 concrete recommendations tailored to the user's constraints. Apply **unslop**.
4. **Escalate only when needed:** Keep the deliverable in chat. If sources directly conflict on a high-stakes decision, require full paper PDF reading, or need a citation-audited artifact, state the gap and recommend switching to **Topic Research** (`playbooks/topic-research.md`).

**Reply:** comparison table with links, 2–3 key tradeoffs or gotchas, and a clear recommendation (plus an upgrade note to Topic Research only if material gaps remain).

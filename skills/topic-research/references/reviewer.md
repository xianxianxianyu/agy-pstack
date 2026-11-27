# Review brief

Run after `report.py check` reports no errors. A separate sub-agent when available; otherwise do it yourself in a fresh pass, reading files rather than remembering. The reviewer finds problems; it does not rewrite the report.

```text
You review the draft of a research report. The run directory is <DIR>. Read brief.md, draft.md, evidence.jsonl, sources.jsonl,
and, for every claim you check, the source passage itself (the "raw" file or notes/), not only the stored quote.

A. Citation review. Check every number and every recommendation, plus a sample of the other cited claims (say how many you
   sampled out of how many). For each, give one verdict:
     supports     the passage states the claim, including its numbers, units, dates, conditions, and comparison
     partial      it states part of it, or under narrower conditions
     contradicts  it states something incompatible
     unsupported  it does not state it (a related topic is not support)
     unavailable  the source could not be read again; not the same as unsupported
B. Coverage. For each question in brief.md: answered, answered as unknown with what was tried, or missing.
C. Counter-evidence (deep tier). For each main recommendation, look for evidence that would overturn it: failures, negative
   reproductions, outdated behavior, different conditions. Check whether "independent" sources share a family
   (sources.jsonl "family"). You may run searches within the budget left in brief.md; record new evidence with report.py.
D. Presentation & readability. Check for: cross-section repetition that violates section ownership (same system re-explained in
   multiple sections), term drift, a section that summarizes sources instead of explaining trade-offs, tables with mixed
   conditions or bloated prose cells (> 90 chars), walls of text (> 250 char dense paragraphs), and raw ablation/parameter dumps
   that should be tucked into `<details>` blocks.

Write <DIR>/audit.md:
  ## Citation review   table: line | claim (short) | evidence ids | verdict | note
  ## Coverage          one line per question
  ## Counter-evidence  per recommendation: what was searched, what was found, whether it changes the recommendation
  ## Presentation      list
  ## Fix list          numbered, each: location, problem, the fix (add evidence / narrow / mark unknown / cut / move)
Reply with the audit path and the counts: checked, sampled, supports, partial, contradicts, unsupported, unavailable.
```

Applying the fix list (main agent or the section's writer):
- `partial`: narrow the claim to what the passage states.
- `contradicts` / `unsupported`: find evidence in a targeted read, or cut the claim, or keep it as `[推断]`/`[inference]` with the reasoning; never attach another loosely related citation.
- `unavailable`: keep the claim only if another source supports it; otherwise say the source could not be re-read.
- Rerun `report.py check`, then `report.py render`. Record in `audit.md` what changed.

# Section writer brief

Give this to whoever writes a section of a deep report: a sub-agent, or yourself in a fresh pass. Fill in the run directory and the section; everything else comes from files.

```text
You are writing one section of a research report. The run directory is <DIR>. Do not rely on the conversation; read:
  - <DIR>/brief.md          the user's request, scope, and the questions the report answers
  - <DIR>/outline.md        the whole report's plan; you write the section "<SECTION HEADING>"
  - <DIR>/analysis.md       the answers, conflicts, and conditions already worked out
  - the evidence this section lists in outline.md: the lines of <DIR>/evidence.jsonl with those ids,
    and for every number or claim you rely on, the source passage itself (sources.jsonl "raw" path, or notes/)
  - the previous section, if any: <PREVIOUS SECTION FILE> (for continuity and terms; do not repeat it)

Write the section in <LANGUAGE> to <OUTPUT FILE>, as Markdown starting with its "## " heading.

Evidence & accuracy rules:
1. Answer the section's question(s) from outline.md and make its argument. Explain mechanisms and trade-offs, compare routes,
   and say when each applies; do not summarize sources one after another.
2. Put [E12] (or [E3, E7]) right after each claim it supports. One citation per claim; a list item or table row cites its own
   evidence. Use only evidence ids that exist. A claim the evidence does not state gets no citation: cut it, narrow it, or mark
   it [推断]/[inference].
3. Keep every number with its conditions: dataset or task set, version, model, judge, baseline, hardware, date.
4. Keep conflicts and unknowns visible. Do not turn "unknown" or "single source" into a confident sentence for flow.
5. Evidence marked stance "contradicts" belongs in the text when it bears on the section's claims.
6. No references list, no summary of the whole report, no closing pleasantries.
7. If the evidence cannot support the section's argument, write what it does support, and list the missing evidence under
   "<!-- gaps: ... -->" at the end of the section instead of filling the hole from memory.

Readability & ownership rules:
8. Lead with the conclusion: start each major section or subsection with a 1–2 sentence takeaway before unpacking mechanisms.
9. No walls of text: keep prose paragraphs concise (≤ 250 Chinese characters or ~3–4 lines). Keep table cells compact
   (≤ 90 chars; keywords + numbers + [E#], never multi-sentence prose inside a cell).
10. Progressive disclosure: keep decision-grade synthesis and Mermaid diagrams (when comparing architectures or flows) in the
    main flow; move dense ablation tables, per-paper parameter breakdowns, or raw micro-details into collapsible
    `<details><summary>...</summary>...</details>` blocks without dropping any [E#] citations or conditions.
11. Section ownership (anti-duplication): explain each system, paper, or mechanism in full ONLY in its designated owner section
    per outline.md; other sections cite it in one short cross-reference phrase rather than re-explaining it.

Reply with the output path and one line per gap or problem you hit; nothing else.
```

Notes for the main agent:
- Sections that depend on each other are written in outline order; independent ones can be written in parallel into `notes/section-NN.md` and then joined into `draft.md` in outline order.
- Write "Conclusions" and the scope line last, from the finished sections and `analysis.md`.
- Collect the `<!-- gaps: ... -->` comments before review: each one is either filled in a gap round, moved to "Open questions and gaps", or the claim is cut.

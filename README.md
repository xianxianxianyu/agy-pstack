# agy-pstack (`pstack` for Antigravity)

A 100% native **Google Antigravity** adaptation of [Lauren Tan (`poteto`)'s `pstack`](https://github.com/cursor/plugins/tree/main/pstack) — rigorous engineering playbooks, 24 first-principles rules, multi-agent arenas, adversarial reviews, and verified shipping, wired directly into Antigravity's native primitives.

> *"If you want to go fast, go deep first. The goal is not to maximize LOC — in fact it's the opposite. pstack helps you write less, higher quality, verifiable code."*

## Why a native Antigravity fork?

Rather than wrapping Cursor instructions in a compatibility shim, every workflow, agent, script, and path in `agy-pstack` is adapted 1:1 to Antigravity's native runtime — and Cursor/Claude-only baggage (`.cursor-plugin`, `claude-code.md`, `automations/benny`, `make-bot-ui`, `cursor-team-kit`, `origin` CLI, hardcoded Cursor model slugs, and the duplicate `skills/swarm` that would shadow Antigravity's built-in `/swarm`) is stripped out.

### Native Antigravity Feature Mapping

| Workflow Need | Antigravity Native Feature Used |
|---|---|
| Parallel writers, owners & independent verifiers | Native **`/swarm`** (`swarm` tool, shared message board, `workspace: "share"`, `fork`, built-in `monitor`) |
| Programmatic fan-out & schema-validated aggregation | **`run_workflow`** (`parallel`, `pipeline`, `agent(..., schema=...)`, `phase`, `trajectory`) |
| Single-task delegation & read-only codebase research | **`invoke_subagent`** (`poteto-agent`, `comment-sicko`, built-in `research`, `browser`), reactive wakeup, `send_message` |
| Overnight & long-running autonomous execution | Native **`/goal`** + **`schedule`** tool (`DurationSeconds` / `CronExpression`) + **`show-me-your-work`** |
| Recurring scheduled maintenance | Native **`/automation`** (cron sidecars) & **`/schedule`** |
| Upfront planning & design alignment | Native **`/plan`** & **`/grill-me`** alongside `/architect`, `/arena`, and `prototype` |
| Live UI / desktop / CLI verification | Project `.agents/skills/verify-<app>/`, native **`/browser`** (`browser` subagent), **`cua-driver`** MCP, `run_command` |
| Structured user questions | Native **`ask_question`** |
| Conversation history, recall & eval verification | Native transcripts (`~/.gemini/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl`) & `conversation://` links |
| Capturing learnings & managing context | `/reflect` + `/correct` paired with native **`/learn`** and **`/compact`** |
| Model & tier configuration | `/setup-pstack` → `~/.gemini/config/rules/pstack-models.md` (`inherit` / `pro` / `flash` / `flash_lite` + live `swarm{action:"models"}`) |
| Visual Playbook & Skill Composer UI | **`pstack Studio`** Aux Pane sidecar (`sidecars/studio/`): interactive intent matcher, 22-playbook pipeline visualizer, close-call comparisons, and one-click dispatch to chat |
| Scripts & PR watcher | **Bun**-native (`watch-pr`, `statechart`, `worktree-audit.sh`) |

## Install

### Global install (recommended)

Clone directly into Antigravity's global plugins directory:

```bash
git clone https://github.com/ahmetdotsh/agy-pstack.git ~/.gemini/config/plugins/pstack
```

### Workspace install (per-repo)

```bash
git clone https://github.com/ahmetdotsh/agy-pstack.git .agents/plugins/pstack
```

Antigravity discovers the plugin automatically — no restart required. Manage, inspect, or toggle it anytime with **`/plugin`**.

## Get started

1. *(Optional)* Run [`/setup-pstack`](./skills/setup-pstack/SKILL.md) to pick your budget (`balanced`, `max`, or `lean`), configure subagent tiers and `/swarm` panel models in `~/.gemini/config/rules/pstack-models.md`, and optionally generate a project verification skill in `.agents/skills/verify-<app>/`.
2. Start any non-trivial task with [`/poteto-mode`](./skills/poteto-mode/SKILL.md):

```text
/poteto-mode this PR has a subtle bug where scroll drifts every 750ms even when idle. repro first, then fix and verify.
```

```text
/goal /poteto-mode i'm going to bed. land the stack even if ci flakes. i want everything merged by morning.
```

New here? Open **`pstack Studio`** in the Auxiliary Side Pane (`sidecars/studio/`) to browse visual Playbook pipelines, compare close-call skills, and send assembled combos directly into your active conversation — or read the [pstack guide](./docs/guide/README.md) and ask [`/poteto-help`](./skills/poteto-help/SKILL.md).

## What's inside

### 22 Playbooks (routed automatically by `/poteto-mode`)

<details>
<summary>All 22 playbooks</summary>

| Playbook | Purpose |
|---|---|
| [investigation](./skills/poteto-mode/playbooks/investigation.md) | Read-only subsystem or root-cause questions. |
| [bug fix](./skills/poteto-mode/playbooks/bug-fix.md) | Reproduce a defect on the real surface, binary-search root cause, fix with runtime evidence. |
| [perf issue](./skills/poteto-mode/playbooks/perf-issue.md) | Measure a baseline trace, vet with `/benchmark-checklist`, optimize against real numbers. |
| [hillclimb](./skills/poteto-mode/playbooks/hillclimb.md) | Sustained scientific loop improving one metric against a target with a frozen harness and one commit per win. |
| [runtime forensics](./skills/poteto-mode/playbooks/runtime-forensics.md) | Diagnose a live symptom (leak, CPU spin, glitch) from instrumentation. |
| [trace forensics](./skills/poteto-mode/playbooks/trace-forensics.md) | Diagnose a captured profiling artifact (`cpuprofile`, trace, spindump, heap snapshot). |
| [feature](./skills/poteto-mode/playbooks/feature.md) | New or changed behavior built from a named data shape and throughput checkpoint. |
| [refactoring](./skills/poteto-mode/playbooks/refactoring.md) | Behavior-preserving structural change pinned by characterization tests or equivalence checks. |
| [prototype](./skills/poteto-mode/playbooks/prototype.md) | Throwaway sketch to settle a design or empirical fork by running code. |
| [visual parity](./skills/poteto-mode/playbooks/visual-parity.md) | Pixel-exact UI equivalence against a frozen baseline. |
| [authoring a skill](./skills/poteto-mode/playbooks/authoring-a-skill.md) | Writing or editing an Antigravity `SKILL.md` with validation. |
| [eval](./skills/poteto-mode/playbooks/eval.md) | Blinded evaluation of a skill or prompt change verified from `transcript.jsonl`. |
| [babysit](./skills/poteto-mode/playbooks/babysit.md) | Drive a PR to merge-ready via `gh` and `watch-pr`: conflicts, review threads, CI. |
| [shipping](./skills/poteto-mode/playbooks/shipping.md) | Independently verify a green stack via native `/swarm`, then land bottom-up via `gh`. |
| [autonomous run](./skills/poteto-mode/playbooks/autonomous-run.md) | Drive a long task to a falsifiable exit predicate with `/goal` and `schedule`. |
| [autopilot-full](./skills/poteto-mode/playbooks/autopilot-full.md) | Run independent PRs to merged via `/swarm` owners (`workspace: "share"`) + independent verifiers. |
| [autopilot-stack](./skills/poteto-mode/playbooks/autopilot-stack.md) | Autopilot-full without the merge — wake up to verified PRs ready to land. |
| [session pickup](./skills/poteto-mode/playbooks/session-pickup.md) | Resume a prior Antigravity conversation from its transcript and decision trail without redoing work. |
| [pause safely](./skills/poteto-mode/playbooks/pause-safely.md) | Suspend in-flight work cleanly with a checkpoint and resume note. |
| [multi-phase plan](./skills/poteto-mode/playbooks/multi-phase-plan.md) | Plan phased or stacked PRs after design settles. |
| [worktree cleanup](./skills/poteto-mode/playbooks/worktree-cleanup.md) | Safety-gated disk reclamation for merged/stale git worktrees and simulators. |
| [opening a pr](./skills/poteto-mode/playbooks/opening-a-pr.md) | Small ordered commits, `/unslop` + `/no-comments`, conventional title, briefing body, ready `gh pr create`. |

</details>

### 33 Workflow Skills + 24 Principle Skills

<details>
<summary>All workflow skills</summary>

| Skill | Use it when |
|---|---|
| [`/poteto-mode`](./skills/poteto-mode/SKILL.md) | Default entry point for any non-trivial engineering task. |
| [`/poteto-help`](./skills/poteto-help/SKILL.md) | You want guidance on which skill, playbook, or native Antigravity command fits. |
| [`/setup-pstack`](./skills/setup-pstack/SKILL.md) | Configure Antigravity subagent tiers and `/swarm` panel models in `~/.gemini/config/rules/pstack-models.md`. |
| [`/in-your-own-words`](./skills/in-your-own-words/SKILL.md) | Play back your goal and problem before starting work. |
| [`/sharpen`](./skills/sharpen/SKILL.md) | Rewrite a prompt deeper (not bigger) before sending it. |
| [`/reframe`](./skills/reframe/SKILL.md) | Learn the expert words for what you're building, disambiguate vague descriptions, borrow terms from neighboring fields with verified links, and rewrite your description (pairs well with `/sharpen`). |
| [`/how`](./skills/how/SKILL.md) | Architecture walkthrough of how a subsystem works (via read-only `research` subagent). |
| [`/why`](./skills/why/SKILL.md) | Historical motivation from git commits, PRs, and records. |
| [`/teach`](./skills/teach/SKILL.md) | Plain diagram-by-diagram explanation combining `/how` + `/why`. |
| [`/recall`](./skills/recall/SKILL.md) | Rebuild recent context across Antigravity transcripts, git, and shared records. |
| [`/ketchup`](./skills/ketchup/SKILL.md) | Plain-English catch-up of what changed since your last message plus decisions waiting on you. |
| [`/ketchup-video`](./skills/ketchup-video/SKILL.md) | `/ketchup` catch-up rendered as a short subtitled slide video. |
| [`/blast-radius`](./skills/blast-radius/SKILL.md) | Find what a small diff could break outside itself and prove safety with a run. |
| [`/architect`](./skills/architect/SKILL.md) | Settle caller usage, types, and module boundaries before writing code. |
| [`/arena`](./skills/arena/SKILL.md) | Parallel competing attempts via `/swarm` or `run_workflow`, cross-judged and grafted into one base. |
| [`/interrogate`](./skills/interrogate/SKILL.md) | Adversarial `/swarm` review where only findings proven by a real run survive. |
| [`/tdd`](./skills/tdd/SKILL.md) | Failing test first, then minimal fix when a cheap local test path exists. |
| [`/benchmark-checklist`](./skills/benchmark-checklist/SKILL.md) | Scientifically vet a measured speedup or regression before trusting it. |
| [`/no-comments`](./skills/no-comments/SKILL.md) | Invoke `comment-sicko` to strip unnecessary comments, fix accepted flags, and encode constraints. |
| [`/typescript-best-practices`](./skills/typescript-best-practices/SKILL.md) | Concrete TypeScript type-system discipline rules. |
| [`/figure-it-out`](./skills/figure-it-out/SKILL.md) | Design a custom auditable playbook when no bundled playbook fits. |
| [`/show-me-your-work`](./skills/show-me-your-work/SKILL.md) | Maintain and audit a TSV decision log against Antigravity's `transcript.jsonl`. |
| [`/create-verification-skill`](./skills/create-verification-skill/SKILL.md) | Generate a project-local `.agents/skills/verify-<app>/` skill with a feature map. |
| [`/maintain-verification-skill`](./skills/maintain-verification-skill/SKILL.md) | Keep a project's verification skill and feature map synced via parallel source reads + live pass. |
| [`/create-formal-verification-skill`](./skills/create-formal-verification-skill/SKILL.md) | Formally verify a race, retry, state machine, or parser invariant (TLA+, model checking, etc.). |
| [`/maintain-formal-verification-skill`](./skills/maintain-formal-verification-skill/SKILL.md) | Re-sync a formal verification skill after code changes. |
| [`/statechart`](./skills/statechart/SKILL.md) | Check a TLA+ model and draw a Mermaid statechart with shortest paths to invariant violations. |
| [`/unslop`](./skills/unslop/SKILL.md) | Strip AI writing tells from prose. |
| [`/bro`](./skills/bro/SKILL.md) | Restate the last message in plain human language. |
| [`/technical-writing`](./skills/technical-writing/SKILL.md) | Layered doc standard (Diátaxis + Google developer style + STE + Global English). |
| [`/automate-me`](./skills/automate-me/SKILL.md) | Mine your Antigravity transcripts to draft a personal `<name>-mode` skill. |
| [`/reflect`](./skills/reflect/SKILL.md) | Mine the current conversation for durable skill edits (pairs with native `/learn`). |
| [`/correct`](./skills/correct/SKILL.md) | Eliminate recurring agent mistake classes via architecture, types, lints, and tests. |

</details>

<details>
<summary>All 24 principles</summary>

| Principle | Group | Rule |
|---|---|---|
| [laziness-protocol](./skills/principle-laziness-protocol/SKILL.md) | core | Bias toward deletion and the smallest change that solves the problem. |
| [foundational-thinking](./skills/principle-foundational-thinking/SKILL.md) | core | Get core types, data structures, and boundaries right before writing logic. |
| [redesign-from-first-principles](./skills/principle-redesign-from-first-principles/SKILL.md) | core | Redesign as if the requirement had been foundational from day one. |
| [attack-the-premise](./skills/principle-attack-the-premise/SKILL.md) | core | After two failed fixes sharing one premise, write down and test the premise directly. |
| [subtract-before-you-add](./skills/principle-subtract-before-you-add/SKILL.md) | core | Delete dead weight first, then build on the simpler base. |
| [minimize-reader-load](./skills/principle-minimize-reader-load/SKILL.md) | core | Collapse one-caller wrappers and shrink mutable scope. |
| [outcome-oriented-execution](./skills/principle-outcome-oriented-execution/SKILL.md) | core | Converge on the target architecture instead of preserving throwaway compatibility layers. |
| [experience-first](./skills/principle-experience-first/SKILL.md) | core | Choose user delight over implementation convenience. |
| [exhaust-the-design-space](./skills/principle-exhaust-the-design-space/SKILL.md) | core | Compare 2–3 competing prototypes side by side before committing. |
| [build-the-lever](./skills/principle-build-the-lever/SKILL.md) | core | Build the script, codemod, or check that proves/does the work instead of doing it by hand. |
| [model-the-domain](./skills/principle-model-the-domain/SKILL.md) | architecture | Encode the domain in a structure instead of scattered conditionals. |
| [boundary-discipline](./skills/principle-boundary-discipline/SKILL.md) | architecture | Concentrate guards at system boundaries; keep internal logic pure. |
| [type-system-discipline](./skills/principle-type-system-discipline/SKILL.md) | architecture | Make illegal states unrepresentable, brand primitives, parse at boundaries. |
| [make-operations-idempotent](./skills/principle-make-operations-idempotent/SKILL.md) | architecture | Converge to the same end state regardless of partial prior runs. |
| [migrate-callers-then-delete-legacy-apis](./skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md) | architecture | Migrate callers and delete the old API in the same wave. |
| [separate-before-serializing-shared-state](./skills/principle-separate-before-serializing-shared-state/SKILL.md) | architecture | Eliminate sharing first; serialize structurally only for real invariants. |
| [prove-it-works](./skills/principle-prove-it-works/SKILL.md) | verification | Verify against the real artifact, never a proxy or "it compiles". |
| [fix-root-causes](./skills/principle-fix-root-causes/SKILL.md) | verification | Trace each symptom to the first place the system went wrong and fix it there. |
| [sequence-verifiable-units](./skills/principle-sequence-verifiable-units/SKILL.md) | verification | Break work into small verifiable units and verify each before the next. |
| [test-behavior-not-implementation](./skills/principle-test-behavior-not-implementation/SKILL.md) | verification | Assert observable user behavior, not internals. |
| [explain-the-number](./skills/principle-explain-the-number/SKILL.md) | verification | Identify the limiter and rule out measurement artifacts before trusting any number. |
| [guard-the-context-window](./skills/principle-guard-the-context-window/SKILL.md) | delegation | Route bulk reads to subagents and workflows; keep summaries in the main thread. |
| [never-block-on-the-human](./skills/principle-never-block-on-the-human/SKILL.md) | delegation | Proceed on reversible work; reserve confirmation for irreversible actions. |
| [encode-lessons-in-structure](./skills/principle-encode-lessons-in-structure/SKILL.md) | meta | Encode recurring rules as types, lints, or scripts instead of more prose. |

</details>

### Bundled Subagents

- **[`poteto-agent`](./agents/poteto-agent.md)** — delegate subagent invoked via `invoke_subagent(TypeName="poteto-agent", ...)` during `/poteto-mode` runs. Reads `poteto-mode/SKILL.md` and its inline principles index before doing any work.
- **[`comment-sicko`](./agents/comment-sicko.md)** — comment auditor invoked via `/no-comments` to strip unnecessary comments and flag refactor targets (`MUST KILL`) without touching application code.

## Attribution & License

Forked and adapted natively for Google Antigravity from [`cursor/plugins/pstack`](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan (`poteto`).
Licensed under the [MIT License](./LICENSE).

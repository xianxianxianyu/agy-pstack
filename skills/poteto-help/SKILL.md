---
name: poteto-help
description: Guides users through pstack setup in Antigravity, /poteto-mode, native slash command integrations (/swarm, /goal, /schedule, /automation, /plan, /grill-me, /browser, /learn), and picking the right skill, playbook, or principle. Type /poteto-help with a question.
---

# Poteto help

Answer the user's question about pstack, hand them a prompt they can send, and link the local file the answer came from. For a help question, don't start the work. The user asked how, and a pstack run spends real tokens, so let them send the prompt.

A message that asks for work, such as "use pstack to fix this bug", is not a help question. Read [`poteto-mode`](../poteto-mode/SKILL.md) and do the work under it.

This file maps questions to the skills and guide pages that hold the answers. Those files own the details. Read the file you route to before you quote it, and trust it when it disagrees with this map.

## Find out what they need

Infer the need from the message and the conversation. A named situation, such as "which skill reviews a PR?", goes straight to its section. If the need is still unclear, ask one multiple-choice question via `ask_question` with these options, then answer only the section they pick:

- `Get set up`
- `Start a task with /poteto-mode`
- `Pick a skill for a situation`
- `Fix a run that went wrong`
- `Make pstack my own`

Check the state that changes the answer, and mention it only when it does:

- No `~/.gemini/config/rules/pstack-models.md` means `/setup-pstack` hasn't run for this user, so every role uses its default (`inherit` active model, `flash` for lightweight bulk sweeps).
- No `.agents/skills/verify-*/SKILL.md` or app harness in the project means agents have no project-specific scripted way to drive the app (beyond Antigravity's built-in `/browser` and `cua-driver`). Mention `/create-verification-skill` when the question is about proving a change works.
- No formal verification skill in the project means no property is checked past what tests reach. Mention `/create-formal-verification-skill` when the question is about a race, an invariant, or another case tests rarely hit. When one exists and the code it covers changed after the commit it records as last in sync, mention `/maintain-formal-verification-skill`.

When the model rule is missing and it matters (new user, setup/cost question, or multi-model panels), offer `/setup-pstack` once per chat.

## Get set up

1. Install pstack as an Antigravity plugin in `~/.gemini/config/plugins/pstack/` (global) or `.agents/plugins/pstack/` (workspace), and manage it via `/plugin`.
2. Run [`/setup-pstack`](../setup-pstack/SKILL.md). It inspects live swarm models via `swarm{action:"models", all:true}`, asks for a budget (`balanced`, `max`, or `lean`), and writes `~/.gemini/config/rules/pstack-models.md`. It also offers to generate `.agents/skills/verify-<app>/` and a formal verification skill if none exist.
3. Start a real task with `/poteto-mode`, a goal, and a check that can pass or fail.

See the [README](../../README.md) and [guide page 1](../../docs/guide/01-setup.md) for details. Offer to word their first prompt per [`references/prompting.md`](references/prompting.md).

If cost or quota is the worry: pstack spends extra tokens on subagents, `/swarm` workers, and review panels. Rerun `/setup-pstack` and choose `lean` (routes delegates to `flash` and keeps panels small), or keep roles on `inherit` with a lighter active model. Save `/poteto-mode` for work that needs rigor.

## Start a task with `/poteto-mode`

`/poteto-mode` matches the task to a playbook, tracks its steps in a task checklist (`task.md` artifact or inline checklist), and runs the other skills and native Antigravity tools as the steps need them. A good prompt states the goal and how to tell it's done. Read [`references/prompting.md`](references/prompting.md) before helping word one. [Guide page 2](../../docs/guide/02-poteto-mode.md) has examples.

Start each new rigorous task with `/poteto-mode`. Mid-chat, say "new task" so `/poteto-mode` matches a fresh playbook. For long unattended runs, pair `/poteto-mode` with Antigravity's native **`/goal`** command; for deep multi-perspective design/coding, pair with **`/boost`**.

`/poteto-mode` automatically delegates playbook implementation steps to `invoke_subagent(TypeName="poteto-agent", ...)` and coordinates parallel writers/verifiers through native **`/swarm`**.

## Pick a skill

The default answer is `/poteto-mode`, which runs most of the others when its steps need them. Name a skill directly when the user wants more or less of something than the playbook gives. Read the skill before recommending it, and give one example prompt.

| The user wants to | Skill or native command |
|---|---|
| Do any non-trivial task with rigor | [`/poteto-mode`](../poteto-mode/SKILL.md) |
| Check that the agent understood their goal and problem first | [`/in-your-own-words`](../in-your-own-words/SKILL.md) |
| Rewrite a prompt deeper before sending it (doesn't run the task) | [`/sharpen`](../sharpen/SKILL.md) |
| Learn the expert words for what they're building (borrowing from neighboring fields, checking cited links) and rewrite their description | [`/reframe`](../reframe/SKILL.md) |
| Know how code works now, or where new code should live | [`/how`](../how/SKILL.md) |
| Know why code is shaped this way, or where a number came from | [`/why`](../why/SKILL.md) |
| Understand a change or subsystem, explained plainly | [`/teach`](../teach/SKILL.md) |
| Catch up on recent work on a topic across conversations and git | [`/recall`](../recall/SKILL.md) |
| Catch up on what changed in this chat since their last message | [`/ketchup`](../ketchup/SKILL.md) |
| Catch up like `/ketchup` in a short subtitled slide video | [`/ketchup-video`](../ketchup-video/SKILL.md) |
| Know what a small diff could break outside itself | [`/blast-radius`](../blast-radius/SKILL.md) |
| Settle types and module shape before code crosses a boundary | [`/architect`](../architect/SKILL.md) |
| Get several parallel attempts at one brief and merge the best parts | [`/arena`](../arena/SKILL.md) |
| Coordinate parallel workers and verifiers on a shared board | Antigravity native **`/swarm`** (or **`/teamwork`**) |
| Have adversaries try to break a diff and prove every finding | [`/interrogate`](../interrogate/SKILL.md) |
| Fix a bug test-first when a cheap local test exists | [`/tdd`](../tdd/SKILL.md) |
| Apply TypeScript type-system rules to `.ts`/`.tsx` work | [`/typescript-best-practices`](../typescript-best-practices/SKILL.md) |
| Strip unnecessary comments before review via Comment Sicko | [`/no-comments`](../no-comments/SKILL.md) |
| Clean AI tells out of prose | [`/unslop`](../unslop/SKILL.md) |
| Write docs, RFCs, READMEs, PRs, or commits to a standard | [`/technical-writing`](../technical-writing/SKILL.md) |
| Hear the last reply again in plain words | [`/bro`](../bro/SKILL.md) |
| Generate a project-local verification skill in `.agents/skills/` | [`/create-verification-skill`](../create-verification-skill/SKILL.md) |
| Audit and update a project verification skill and feature map | [`/maintain-verification-skill`](../maintain-verification-skill/SKILL.md) |
| Formally verify a race, invariant, or property tests rarely reach | [`/create-formal-verification-skill`](../create-formal-verification-skill/SKILL.md) |
| Re-sync a formal verification after code changes | [`/maintain-formal-verification-skill`](../maintain-formal-verification-skill/SKILL.md) |
| Check a TLA+ model and draw a Mermaid statechart with bug paths | [`/statechart`](../statechart/SKILL.md) |
| Vet a performance number before reporting or acting on it | [`/benchmark-checklist`](../benchmark-checklist/SKILL.md) |
| Design a custom auditable playbook for a large/cross-cutting task | [`/figure-it-out`](../figure-it-out/SKILL.md) |
| Keep and audit a TSV decision trail for long/unattended work | [`/show-me-your-work`](../show-me-your-work/SKILL.md) |
| Configure per-role model tiers and swarm panel models | [`/setup-pstack`](../setup-pstack/SKILL.md) |
| Turn working habits from transcripts into a personal `-mode` skill | [`/automate-me`](../automate-me/SKILL.md) |
| Turn what a finished task taught into skill edits | [`/reflect`](../reflect/SKILL.md) (pairs with native **`/learn`**) |
| Stop agents from repeating the same mistakes in this repo | [`/correct`](../correct/SKILL.md) |
| Run an autonomous long-running task until a predicate holds | Antigravity native **`/goal`** + `/poteto-mode` |
| Schedule a recurring background cron job or timer | Antigravity native **`/automation`** or **`/schedule`** |
| Plan upfront or interview through design tradeoffs | Antigravity native **`/plan`** or **`/grill-me`** |
| Test or drive a live web app visually | Antigravity native **`/browser`** |
| Free up context window in a long chat | Antigravity native **`/compact`** |
| Find their way around pstack | `/poteto-help` |

Close calls:

- `/how` explains what the code does. `/why` explains the reasons. `/teach` runs one or both and explains the result plainly.
- `/arena` gives every candidate the same brief and grafts the best parts. Native `/swarm` splits work across slices/owners/verifiers on a shared board. `run_workflow` orchestrates programmatic fan-out with JSON-validated outputs.
- `/interrogate` adversarially reviews a diff. `/blast-radius` checks breakage outside the diff and proves the one fact that makes it safe.
- `/recall` rebuilds context across recent conversations. `/ketchup` covers only this chat since the user's last message. Resuming one specific conversation or branch is the Session pickup playbook.
- `/figure-it-out` designs one rigorous run. The Autonomous run playbook (paired with `/goal`) drives a task to a checkable finish condition.

## Playbooks and principles

Playbooks are step lists inside `/poteto-mode`, not standalone slash commands. Inside `/poteto-mode`, describing the task selects one, or name one directly:

- "babysit this pr" or "check on pr 123" → **Babysit** (drives to merge-ready, never merges).
- "land the stack" → **Shipping**.
- "take over this branch" → **Session pickup**.
- "pause safely" → **Pause safely**.
- "full autopilot on this queue" → **Autopilot-full**. "autopilot, don't merge" → **Autopilot-stack**.
- "run the eval playbook" → **Eval**.

For upfront planning, Antigravity's native **`/plan`** and **`/grill-me`** work alongside pstack. For phased or stacked PRs, asking `/poteto-mode` for a plan runs the [Multi-phase plan playbook](../poteto-mode/playbooks/multi-phase-plan.md).

Principles are 24 one-rule skills that `/poteto-mode` reads and cites. Steer mid-task with their names (e.g., "apply prove it works, show me the real output") or invoke `/principle-<name>` directly. [Guide page 8](../../docs/guide/08-principles.md) lists all 24.

## Fix a run that went wrong

| Symptom | Fix |
|---|---|
| A question got treated as the next step of the last task | Say "new task", or start a fresh conversation. |
| Context got crowded during a long run | Run native `/compact`, or offload bulk reads to `research` subagents / `run_workflow`. |
| A new model choice from `/setup-pstack` had no effect | `~/.gemini/config/rules/pstack-models.md` applies to new conversations. Start a new chat. |
| Runs cost more than expected | Rerun `/setup-pstack` and pick `lean`, or shorten panel lists. |
| Parallel agents overwrote each other | Give every concurrent writer `Workspace: "share"` (subagents/workflows) or `workspace: "share"` (native `/swarm`). |
| A swarm worker ran out of quota | Switch its model in-place with `swarm{action:"model"}` instead of killing it. |
| An overnight run moved but finished nothing | Pair `/goal` with a falsifiable finish predicate, never a duration. See [guide page 7](../../docs/guide/07-overnight.md). |
| The reply claims success from a green build | Ask for the real command, flow, stored value, or profile (`principle-prove-it-works`). |

For a run that drifts, [`references/prompting.md`](references/prompting.md) has one-line steers. [Guide page 10](../../docs/guide/10-recipes-and-pitfalls.md) has recipes and pitfalls.

## Make pstack my own

- [`/automate-me`](../automate-me/SKILL.md) drafts a personal mode skill from your Antigravity transcripts.
- [`/reflect`](../reflect/SKILL.md) after a session turns lessons into approved skill edits (pairs with native `/learn`).
- `/poteto-mode write a skill for <workflow>` runs the Authoring a skill playbook. The Eval playbook tests a skill change blind.
- Fix a misbehaving skill in its own PR, not tangled into feature work.

[Guide page 9](../../docs/guide/09-make-it-yours.md) covers each of these.

## Reply

Lead with the answer. Give at most one example prompt in a code block, adapted from [`references/recipes.md`](references/recipes.md) when one fits, then link the local file it came from. Keep it short unless the user asked for the whole map.

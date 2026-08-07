---
name: sg-gauntlet
description: "Turn a quality goal into ONE paste-ready prompt that makes a fresh agent grind builders against blind critics until the work beats a named, fetchable reference. Use when the user wants to beat a specific product, page, repo, or published piece; when they ask for a prompt to hand another agent; or when 'make it as good as X' is the actual requirement. Do NOT use for bug fixes, contract or wiring work, infra, or any goal with no reference that can be fetched and compared side by side."
---

# /sg-gauntlet — Beat a named bar

The user gives a goal. You give back **ONE short prompt** they paste into a fresh agent session.

You are not doing the work. You are writing the prompt that makes another agent grind until it
beats a real reference.

## First: refuse it when it does not apply

**No fetchable reference means no gauntlet.** Say so in one line and route elsewhere.

| Goal | Why a gauntlet fails | Where to go |
|---|---|---|
| bug, crash, 500, timeout, regression | nothing to place side by side | `/sg-code-audit`, the project's debug workflow |
| contract, wiring, auth, migration | the bar is deterministic, not aesthetic | `/sg-process-check`, the project's gate |
| infra, deploy, packaging | same | the project's ops workflow |
| retrieval / model quality | the bar is a scored golden set, not a reference artifact | the project's eval harness |

A gauntlet aimed at "fix the failing webhook path" invents a comparison and approves everything.
That is the single most common failure of this method — do not trigger it yourself.

## Flow

1. **Read the goal.** Restate it in your head, not on screen.
2. **Set the bar.** If the user supplied one, use it. Otherwise offer 2-3 candidates, one line
   each, and **STOP**. Wait for their pick. Do not write the prompt yet.
3. **Get the ceiling.** One line. Never write the prompt without it — see below.
4. **Write the prompt.** One block, paste-ready, no preamble, no headings inside it, no narration
   after it.
5. **Offer to run it.** One flat line under the prompt: `I can run this here.` Not a question.

If they say run it, you become the lead agent and follow the prompt you just wrote.

## The bar is the whole trick

Everything else is scaffolding. The loop only produces quality if the thing it compares against
is real. A bar has to pass three tests:

- **Named.** A specific thing, not a category. "Stripe's pricing page" works. "Award-winning SaaS
  sites" does not.
- **Fetchable.** The critic can actually obtain it — screenshot the live page, read the published
  piece, run the binary, open the repo, watch the footage. If the agent cannot obtain it, it will
  hallucinate the comparison.
- **Comparable.** Both can sit side by side and a judge can pick one. If you cannot imagine the
  A/B, it is not a bar.

| Goal type | Bar that works |
|---|---|
| Website, app, UI | the live site of a named best-in-class product, screenshotted at the same viewport |
| Game, 3D, visual | real footage or screenshots from a named shipped title |
| Writing | a specific published piece by a named author or publication, same length and format |
| Code, tooling | a named repo's implementation, plus its benchmark or test suite as the measurable half |
| Research, analysis | a named analyst report or a paper's methods section, judged on rigour and coverage |
| Deck, doc, deliverable | a real artifact from a firm known for it, same page count |

Prefer the hardest bar the agent can genuinely reach. A bar that is too easy makes the loop exit
on round one.

If the goal has a measurable half (load time, token cost, benchmark score, word count, pass rate),
name it alongside the reference. **Taste plus a number beats taste alone.**

## Two fills ShipGuard requires

### 1. The host project's non-negotiable constraints, injected verbatim

A critic comparing against a best-in-class reference will push toward whatever that reference does
— motion, polish, accessibility, a different stack. Some of that may be **forbidden** in the host
project. Left unstated, the critic starts fighting the project's own rules and the builder ships
violations that pass the gauntlet and fail review.

Before writing the prompt, read the host project's instruction files (`CLAUDE.md`, `AGENTS.md`,
or equivalent) and extract only the constraints this goal can actually collide with. Put them in
the prompt as a short block introduced by: *these override the reference*.

Typical collisions worth looking for:

- an area declared out of scope (accessibility, i18n, analytics, animation)
- a mandated driver or tool for capturing evidence, where hand-rolled alternatives are banned
- the port, host, or public URL the app must be tested on
- audience and language of the interface copy
- a required rebuild or cache purge before screenshots, without which the capture lies

Keep only the lines the goal puts in play. A writing gauntlet does not need the app's port.

### 2. A cost ceiling, never optional

The method as commonly written says to add a budget only if the user names one. **ShipGuard
inverts that.** Fan-out plus "do not stop before the critic picks ours" is a loop with no bounded
stopping condition; combined with multi-agent orchestration it can spend without limit.

Ask for the ceiling before writing the prompt, and put it in:

```text
Ceiling: <N> dollars / <N> rounds across the whole run. When you reach it, stop, say where each
piece stands, and let me decide whether to continue.
```

The ceiling is an **emergency brake that hands control back — never an exit condition.** It does
not declare victory. If the user says "no cap", write that in the prompt explicitly rather than
letting silence stand in for permission.

## The template

Adapt the wording every time. Fill the brackets, keep it short, keep the last lines.

```text
Build [GOAL].

The bar is [BAR]. Get the real thing first and compare against it directly, not against a
description of it.

[HOST PROJECT CONSTRAINTS — these override the reference]

Break this into the smallest pieces that can be improved and judged on their own. For each piece,
fan out a builder and a separate critic with fresh context. The critic inspects the actual output,
puts it next to the bar blind with the labels stripped, says which one is better, and names the
single biggest remaining gap. Then it goes back to the builder.

The critic should be a harsh critic. Praise is not useful. If ours does not win, it keeps going.

[CEILING]

/loop on each piece until the critic picks ours blind. Do not stop before that.

Keep a live progress page updating as the work evolves so I can watch it.

Fan out subagents and ultracode.
```

Rules for what you fill in:

- Bake the bar in as a concrete, fetchable thing: URL, product name, repo, title.
- Add tool names only if the goal needs them (image or video generation, a browser, a deploy target).
- No architecture, no file layout, no decomposition, no round count, no stack choice unless the
  user demanded it. The agent decides those, and it decides better than a spec written before the
  work started.

**Length:** roughly 120-180 words, excluding the constraints block and the ceiling. If the prompt
needs a heading to stay readable, it is too long. Plain sentences, no bullet lists inside it.

## Working with the rest of ShipGuard

- For a UI gauntlet, the critic's evidence should come from `/sg-visual-run`, so screenshots are
  captured by the project's sanctioned driver rather than an ad-hoc browser script.
- `/sg-visual-review` is the natural home for the live progress page when the goal is visual.
- `/sg-mission-lock` still governs authority. A gauntlet decides *how good*, never *how far* —
  it never grants permission to touch anything the lock did not already authorize.
- After a run, `/sg-improve` captures which bars produced real movement and which exited on
  round one.

## Portability

`/loop` and `ultracode` are Claude Code features. `ultracode` requires explicit opt-in — the user
pasting the prompt themselves is that opt-in, which is why this skill returns a prompt instead of
starting the run.

For any other agent, swap the last two lines for: "Keep looping until the critic picks ours. Run
the builders and critics as parallel subagents." The structure carries over unchanged.

## What breaks a gauntlet loop

- **A vague bar.** The critic invents a comparison and approves everything. By far the most common failure.
- **The builder judging its own work.** The critic must be a separate agent with fresh context. It
  should not know how hard the builder tried.
- **A soft critic.** Say "harsh" in the prompt and give it a binary job: which one is better, A or
  B. Scores out of 10 drift upward every round.
- **A named exit after N rounds.** The exit is winning the comparison, or the user stopping the
  run. Never a round count. The cost ceiling is not an exception — it pauses and reports, it does
  not pass.
- **Over-specifying.** Every extra instruction is one fewer decision the agent makes with its own
  judgment. Minimal wins.

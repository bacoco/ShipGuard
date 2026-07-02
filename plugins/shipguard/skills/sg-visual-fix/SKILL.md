---
name: sg-visual-fix
description: Use when a human has annotated screenshots in the ShipGuard review dashboard and exported a fix manifest — applies the requested UI fixes and captures before/after evidence.
context: conversation
argument-hint: "[path to fix manifest JSON, or 'latest' for visual-tests/_results/fix-manifest.json]"
---

# /sg-visual-fix — Fix Annotated Screenshots

Take human-annotated screenshots from `/sg-visual-review`, analyze the marked problems, fix the code, and produce before/after evidence.

> **Recommended model: Sonnet 4.6 for minor fixes (CSS tweaks, copy changes, small layout nits).** Switch to Opus 4.7 if the annotations point to a full component redesign or cross-file logic change. Use `/model sonnet` or `/model opus` accordingly.

## Flow

```
Human annotates screenshots in review.html
  → clicks "Validate & Generate Report"
  → dashboard exports visual-tests/_results/fix-manifest.json
    (single fixed path, overwritten on each export)
  → runs /sg-visual-fix
    → AI reads each annotated screenshot
    → AI reads the annotation regions + note + severity (the human's main signals)
    → AI identifies the visual bug in that region
    → AI traces to source code (component, CSS, data)
    → AI implements the fix (one commit per test)
    → AI rebuilds the app
    → AI re-runs the test flow and OVERWRITES the test's main screenshot
      with the new capture (this drives the dashboard's After view)
```

## How This Skill Works (LLM-Driven)

**Important:** This skill is **LLM-driven and non-deterministic.** The same annotated screenshot can produce different fixes across runs because the LLM interprets the visual issue differently each time. This is by design — visual debugging requires judgment, not pattern matching.

| Skill | Execution model | Deterministic? |
|-------|----------------|---------------|
| `sg-code-audit` | Parallel agents with structured checklist | Yes (same checklist → same bugs) |
| `sg-visual-run` | Scripted steps + LLM assertions | Mostly (steps are mechanical; only llm-check varies) |
| **`sg-visual-fix`** | **LLM reads screenshot → traces to code → implements fix** | **No** (different interpretation each run) |

If a fix doesn't work, re-run or provide more specific annotation notes to guide the LLM.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-visual-fix` | Read `visual-tests/_results/fix-manifest.json` (the dashboard's fixed export path) |
| `/sg-visual-fix latest` | Same as no argument — read `visual-tests/_results/fix-manifest.json`. There is only ever one manifest; the dashboard overwrites it on each export. |
| `/sg-visual-fix <path>` | Read that specific manifest JSON file |
| `/sg-visual-fix --dry-run [latest\|<path>]` | Analyze the manifest and write a fix plan without editing source files |

Sandbox note: normal mode edits source, rebuilds, runs browser commands, and writes screenshots. Use `--dry-run` first when permissions are restricted. See [../../docs/sandbox.md](../../docs/sandbox.md).

## Guardrails

- **Clean tree first.** Before ANY edit, `git status --porcelain` must be empty (Step 0). If not, stop and ask the user to commit or stash.
- **Scope limit.** Every edited file must trace to the annotated route/component. List candidate files first (Step 2b), then edit only from that list.
- **Protected files.** Respect the project's protected-file lists (CLAUDE.md no-touch lists). If an annotated fix requires touching a protected file, report it instead of editing.
- **One commit per fix.** Each test's fix is its own commit (Step 2f) — this is what makes selective `revert_to_before` possible.
- **File cap.** If an annotation seems to require editing more than ~5 files, stop and ask before proceeding.

## Instructions

### Step 0: Clean-Tree Guard

Before any code edit (skip in `--dry-run`, which never edits):

```bash
git status --porcelain
```

If the output is non-empty, STOP and ask the user to commit or stash first. A clean tree guarantees each fix commit contains exactly one test's changes, so `revert_to_before` can cleanly revert it later.

### Step 1: Load the Fix Manifest

Resolve the manifest path:
- No argument, or `latest`: read `visual-tests/_results/fix-manifest.json` — the dashboard always exports to this single fixed path and overwrites it on each export.
- A path argument: read that file.
- If `--dry-run` is present: do not edit code, rebuild, run browser commands, run Git commands, or write screenshots; only write `visual-tests/_results/visual-fix-plan.md`.

Manifest schema (exported by the review dashboard):

```json
{
  "action": "validate-and-fix",
  "timestamp": "2026-07-02T10:00:00.000Z",
  "tests": [
    {
      "test": "auth/login",
      "name": "Login page",
      "url": "http://localhost:3000/login",
      "screenshot": "screenshots/login-load.png",
      "steps": [
        { "action": "open", "url": "{base_url}/login", "screenshot": "login-load.png" }
      ],
      "annotations": [
        { "x1": 0.2, "y1": 0.3, "x2": 0.8, "y2": 0.6,
          "note": "Button overlaps the password input", "severity": "critical" }
      ],
      "redo_entirely": false,
      "revert_to_before": false,
      "improve_ui": false
    }
  ]
}
```

Field notes:
- `action` is ALWAYS `validate-and-fix` at the top level. Per-test behavior is driven by the three OPTIONAL boolean flags (`redo_entirely`, `revert_to_before`, `improve_ui`), not by different action values.
- `timestamp` is the ISO export time; `name` is the test's display name.
- `url` (test level) is fully resolved — no `{base_url}` placeholder. Step-level `url` values are raw and may still contain `{base_url}`; always use the test-level `url` to open the page.
- `screenshot` is relative to `visual-tests/_results/` and already includes the `screenshots/` prefix — never prepend another `screenshots/`. This applies everywhere a manifest screenshot path is used below.
- `annotations` use normalized 0–1 coordinates (fractions of image width/height). `note` (free text) and `severity` (default `critical`) are the human's main signals — read the note first; it usually says exactly what to change.

Per-test mode, from the optional flags:

| Flags | Mode | What to do |
|-------|------|------------|
| none (annotations present) | **validate-and-fix** | Read the annotated screenshot, trace to source, implement the fix, rebuild, re-capture |
| `redo_entirely: true` | **redo** | Redo the annotated UI area from scratch as described by the note — don't patch the existing markup. Rebuild and re-capture. |
| `revert_to_before: true` | **revert** | Undo the earlier fix for this test: find its fix commit by test id in the log (`git log --oneline --grep="sg-visual-fix(auth/login)"`) and run `git revert <commit>`. Never restore individual files by checking out old versions — always revert the whole fix commit. Then re-run to confirm. |
| `improve_ui: true` (no annotations, no other flags) | **improve** | The human selected the test without marking anything: do a general polish pass on that page guided by the screenshot — spacing, alignment, hierarchy, consistency. |

### Step 1b: Dry-run planning mode

When `--dry-run` is present, stop before implementation. For each test in the manifest:

1. Read the screenshot.
2. Describe each annotation region from the coordinates, note, and severity (for `improve` mode there are no annotations — assess the whole page).
3. Identify candidate files using the tracing method in Step 2b (route → router lookup → grep visible text → component tree).
4. Propose the minimal correction that would be attempted in normal mode.
5. List uncertainty and any data/build/runtime dependency that prevents confidence.

Write:

```text
visual-tests/_results/visual-fix-plan.md
```

Plan format:

```markdown
# ShipGuard Visual Fix Plan

Mode: dry-run
Manifest: visual-tests/_results/fix-manifest.json

## Test: auth/login
- URL: http://localhost:3000/login
- Screenshot: visual-tests/_results/screenshots/login-load.png
- Mode: validate-and-fix
- Annotations:
  - Region 1: x1=0.20 y1=0.30 x2=0.80 y2=0.60
    Severity: critical
    Note: Button overlaps the password input
    Observed issue: ...
- Candidate files:
  - app/login/page.tsx - route component
  - components/auth/login-form.tsx - form layout
- Proposed fix:
  - ...
- Limits:
  - ...
```

Dry-run acceptance:
- No source file changes.
- No Git commands, no build commands, no browser re-run.
- The plan lists tests, screenshots, per-test mode, annotations (with note and severity), candidate files, proposed fix, and limits.
- If screenshots cannot be read, the plan records that as a blocker instead of guessing.

### Smoke Test

Run the deterministic dry-run smoke test after changing this skill:

```bash
node "$SHIPGUARD_PLUGIN_ROOT/skills/sg-visual-fix/visual-fix-dry-run-smoke-test.mjs"
```

The smoke test validates the dry-run contract with a dashboard-export fixture (one annotated test, one `redo_entirely`, one `improve_ui`): it asserts the manifest fields match the export contract, writes `visual-tests/_results/visual-fix-plan.md` with the correct per-test mode labels, verifies fixture source files are unchanged, and removes the fixture on success. Use `--keep-tmp` or `--debug` to inspect the generated fixture.

### Step 2: For Each Test in the Manifest

Process each test according to its mode (table in Step 1).

For **revert** mode: run the `git revert` (Step 1 table), then rebuild and re-capture (2d–2e) to confirm — skip 2a–2c.

For **validate-and-fix**, **redo**, and **improve** modes:

#### 2a. Read the "before" screenshot

Resolve `test.screenshot` against `visual-tests/_results/` (recall: the path already includes the `screenshots/` prefix):

```
Read(visual-tests/_results/{test.screenshot})
```

Focus on the annotated regions (x1/y1 to x2/y2 as fractions of image dimensions) together with each annotation's note and severity. Describe what you see in each marked region:
- UI errors (broken layout, wrong colors, misaligned elements)
- Data issues (wrong text, missing content, empty state that should have data)
- Error messages (toasts, modals, HTTP errors)

For **improve** mode there are no annotations: study the whole page for polish opportunities.

For **redo** mode: use the fresh state of the app, not just the stored screenshot — the note describes what to rebuild; re-open the page live if needed before redesigning.

#### 2b. Trace to source code

Generic method — works for any frontend stack:

1. **Route → router lookup.** Take the path from the test-level `url` and find the page entry point:
   - Next.js: `app/<route>/page.tsx` or `pages/<route>.tsx`
   - Vite / React Router: grep the route path in the router config (`createBrowserRouter`, `<Route path=`, route objects)
   - Static HTML: match the path to an `.html` file
2. **Grep visible text.** Search for distinctive strings visible in the annotated region — headings, button labels, aria-labels, placeholder text.
3. **Walk the component tree** from the page entry to the component that renders the annotated region; read it and its styles.
4. Identify the root cause (CSS issue, data mapping bug, missing prop, etc.).

List the candidate files BEFORE editing (guardrail: edits must come from this list). Dry-run mode uses this same method for its "Candidate files" section.

#### 2c. Implement the fix

Apply the minimal fix. Follow project rules:
- Read before writing
- No speculative changes
- Typecheck after each fix
- If a candidate file is on the project's protected-file list, report instead of editing
- If the fix seems to need more than ~5 files, stop and ask

#### 2d. Preserve the "before" evidence

BEFORE re-running (the re-run in 2e overwrites the main screenshot), copy the original:

```bash
cp visual-tests/_results/{test.screenshot} visual-tests/_results/screenshots/{test-id}-before.png
```

`{test-id}` is the test id with slashes replaced by hyphens — e.g. `auth/login` becomes `auth-login`, `dashboard/home` becomes `dashboard-home`.

#### 2e. Rebuild and re-capture (overwrite the main screenshot)

Read `build_command` from `visual-tests/_config.yaml`:

- If `build_command` is a non-null string: execute it
- If `build_command: null`: no rebuild needed — proceed directly to re-run
- If `build_command` is absent from config entirely: **auto-detect before asking the user:**
  1. Check `package.json` → `scripts.build` or `scripts.dev` → propose `npm run build` or `npm run dev`
  2. Check for `docker-compose.yml`/`docker-compose.yaml` → propose `docker compose up -d --build`
  3. Check `playwright.config.js`/`.ts` → `webServer.command`
  4. If detected, use it and print: `Auto-detected build command: {command}`
  5. If nothing detected, ask the user how to rebuild, then proceed

Then re-run the test flow with agent-browser:

- `{test_url}` is the test entry's resolved top-level `url` field. Do NOT derive it from step URLs — those are raw and may contain `{base_url}`.
- Replay the manifest `steps`: use the step→command mapping from `sg-visual-run/references/action-reference.md`.
- The final capture OVERWRITES the test's main screenshot file — the same filename the manifest references. This overwrite is what makes the dashboard's After view and UPDATED badge work.

```bash
# Examples of build_command values in _config.yaml:
# build_command: "docker compose up -d --build frontend"
# build_command: "npm run build"
# build_command: null    # no rebuild needed — skip rebuild step

agent-browser open {test_url}
# ... replay the test's steps per the action-reference mapping
agent-browser screenshot --full visual-tests/_results/{test.screenshot}

# Optional: also keep a copy for the durable change report (Step 3b)
cp visual-tests/_results/{test.screenshot} visual-tests/_results/screenshots/{test-id}-after.png
```

> **Cleanup invariant:** On ANY exit — success, failure, abort, or interrupt — run `agent-browser close`. Ignore errors from close.

Verify the fix visually: Read the new capture and confirm the annotated issue is resolved.

#### 2f. Commit this fix (one commit per test)

```bash
git add <files fixed for this test>
git commit -m "sg-visual-fix(auth/login): <one-line summary of the fix>"
```

One commit per test, with the test id in the message — this is exactly what `revert_to_before` greps for to find and `git revert` the right commit later. Do not batch multiple tests' fixes into one commit.

### Step 3: Refresh the Review Dashboard

```bash
node visual-tests/build-review.mjs
```

This rebuilds `review.html` without starting a new server. If the review server is not already running, start it separately:

```bash
node visual-tests/build-review.mjs --serve
```

The dashboard's After view and UPDATED badge come from the overwritten main screenshots (Step 2e); the `{test-id}-before.png` copies preserve the pre-fix state.

### Step 3b: Publish Durable Change Report

Use `sg-change-report` to create a committed before/after report:

```text
visual-tests/_results/change-reports/<report-id>/report.json
visual-tests/_results/change-reports/<report-id>/screenshots/
visual-tests/_results/persona-reports/<report-id>/index.html
```

Copy the relevant `{test-id}-before.png` / `{test-id}-after.png` screenshots into the change-report folder, run `node visual-tests/build-review.mjs --serve --port=<free-port>`, and commit the source report plus generated persona report. Do not commit `visual-tests/_results/review.html` or `visual-tests/_results/.server.pid`.

### Step 3c: Stop Review Server

After all fixes are applied and verified, stop the review server:

```bash
node visual-tests/build-review.mjs --stop
```

### Step 4: Report

The fix commits were already made per test in Step 2f. Report to user:

```
Visual Review Fix Complete:
- {N} tests processed: {A} fixed, {B} redone, {C} reverted, {D} polished, {K} need further investigation
- Commits (one per test): sg-visual-fix(<test-id>): ...
- After view: reload the review dashboard — main screenshots were overwritten with the new captures
- Durable change report: visual-tests/_results/persona-reports/{report-id}/index.html
- Rebuilt: (build_command from _config.yaml)
```

## Important Rules

- ALWAYS read the "before" screenshot with the Read tool before attempting any fix
- ALWAYS focus on the annotated region coordinates plus the human's note and severity — they mark exactly where and what the problem is
- ALWAYS copy `{test-id}-before.png` BEFORE re-running (the re-run overwrites the main screenshot)
- ALWAYS re-capture using the same test steps and verify the new screenshot visually
- ALWAYS run `agent-browser close` on any exit (see cleanup invariant)
- If a fix requires backend changes, run the appropriate build_command
- If you can't identify the issue from the screenshot, say so — don't guess
- In `--dry-run`, stop after `visual-fix-plan.md`; do not modify source, Git state, build artifacts, or screenshots

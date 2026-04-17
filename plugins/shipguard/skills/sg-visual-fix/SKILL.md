---
name: sg-visual-fix
description: Process human-annotated Visual screenshots — analyze marked problem areas, trace to source code, implement fixes, capture before/after screenshots, and regenerate the review page with a comparison tab. Trigger on "sg-visual-fix", "fix annotated tests", "process review annotations", "visual fix", "fix les annotations", "traite la review".
context: conversation
argument-hint: "[path to fix manifest JSON, or 'latest' to use most recent]"
---

# /sg-visual-fix — Fix Annotated Screenshots

Take human-annotated screenshots from `/sg-visual-review`, analyze the marked problems, fix the code, and produce before/after comparison.

> **Recommended model: Sonnet 4.6 for mineures fixes (CSS tweaks, copy changes, small layout nits).** Switch to Opus 4.7 if the annotations point to a full component refonte or cross-file logic change. Use `/model sonnet` or `/model opus` accordingly.

## Flow

```
Human annotates screenshots in review.html
  → clicks "Validate & Generate Report"
  → fix-manifest.json is saved to the server via POST /save-manifest
  → runs /sg-visual-fix
    → AI reads each annotated screenshot
    → AI reads the annotation coordinates (problem region)
    → AI identifies the visual bug in that region
    → AI traces to source code (component, CSS, data)
    → AI implements the fix
    → AI rebuilds the app
    → AI re-runs the specific test to capture "after" screenshot
    → AI generates before/after comparison page
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
| `/sg-visual-fix` | Process the most recent fix manifest in `visual-tests/_results/` |
| `/sg-visual-fix <path>` | Process a specific fix manifest JSON file |

## Instructions

### Step 1: Load the Fix Manifest

Find the manifest file:
- If argument provided: use that path
- Otherwise: read `visual-tests/_results/fix-manifest.json` (saved by the review page server)

The manifest `action` field determines how to process each test:

- **`validate-and-fix`** — Read annotated screenshot, trace to source code, implement fix, rebuild, capture after screenshot.
- **`redo_entirely`** — Re-run the test from scratch (re-execute all steps against the live app) and fix based on the fresh screenshot. Do not use the stored before-screenshot; re-capture now.
- **`revert_to_before`** — Restore the before-screenshot version of affected files using `git checkout -- <file>` (revert code changes). Then re-run the test to confirm the revert worked.

The manifest contains:
```json
{
  "action": "validate-and-fix",
  "tests": [
    {
      "test": "auth/login",
      "url": "http://localhost:3000/login",
      "screenshot": "screenshots/login-load.png",
      "annotations": [
        { "x1": 0.2, "y1": 0.3, "x2": 0.8, "y2": 0.6 }
      ],
      "steps": [...]
    }
  ]
}
```

### Step 2: For Each Annotated Test

#### 2a. Read the "before" screenshot

```bash
# Read the screenshot file — screenshot_path is relative to visual-tests/_results/screenshots/
# Use the full path directly: visual-tests/_results/screenshots/{original}.png
Read(visual-tests/_results/screenshots/{original}.png)
```

Focus on the annotated regions (x1/y1 to x2/y2 as percentages of image dimensions). Describe what you see in each marked region:
- UI errors (broken layout, wrong colors, misaligned elements)
- Data issues (wrong text, missing content, empty state that should have data)
- Error messages (toasts, modals, HTTP errors)

#### 2b. Trace to source code

Based on the URL and visual issue:
1. Find the page component (use route to find `app/.../page.tsx`)
2. Identify which component renders the problematic region
3. Read the component code
4. Identify the root cause (CSS issue, data mapping bug, missing prop, etc.)

#### 2c. Implement the fix

Apply the minimal fix. Follow project rules:
- Read before writing
- No speculative changes
- Typecheck after each fix

#### 2d. Rebuild and capture "after" screenshot

Read `build_command` from `visual-tests/_config.yaml`:

- If `build_command` is a non-null string: execute it
- If `build_command: null`: no rebuild needed — proceed directly to re-run
- If `build_command` is absent from config entirely: **auto-detect before asking the user:**
  1. Check `package.json` → `scripts.build` or `scripts.dev` → propose `npm run build` or `npm run dev`
  2. Check for `docker-compose.yml`/`docker-compose.yaml` → propose `docker compose up -d --build`
  3. Check `playwright.config.js`/`.ts` → `webServer.command`
  4. If detected, use it and print: `Auto-detected build command: {command}`
  5. If nothing detected, ask the user how to rebuild, then proceed

```bash
# Examples of build_command values in _config.yaml:
# build_command: "docker compose up -d --build frontend"
# build_command: "npm run build"
# build_command: null    # no rebuild needed — skip rebuild step

# {test_url} is derived from the test manifest's first open step:
#   manifest.steps.find(s => s.action === 'open').url
# {test-id} is the manifest path with slashes replaced by hyphens
# e.g. "auth/login" becomes "auth-login", "dashboard/home" becomes "dashboard-home"

# Re-run the specific test steps
agent-browser open {test_url}
# ... execute test steps from manifest
agent-browser screenshot --full visual-tests/_results/screenshots/{test-id}-after.png
```

#### 2e. Save before/after pair

Copy the original screenshot (path is `visual-tests/_results/screenshots/{original-filename}.png` — do NOT add an extra `screenshots/` prefix):
```bash
cp visual-tests/_results/screenshots/{original-filename}.png visual-tests/_results/screenshots/{test-id}-before.png
```

### Step 3: Generate Before/After Comparison

Regenerate the review page with a "Comparison" tab:

```bash
node visual-tests/build-review.mjs
```

This rebuilds `review.html` without starting a new server. If the review server is not already running, start it separately:

```bash
node visual-tests/build-review.mjs --serve
```

The review page shows before/after screenshots when pairs exist (matching `{slug}-before.png` and `{slug}-after.png` in the screenshots directory).

### Step 3b: Stop Review Server

After all fixes are applied and verified, stop the review server:

```bash
node visual-tests/build-review.mjs --stop
```

### Step 4: Commit and Report

```bash
git add <fixed files> visual-tests/_results/screenshots/*-after.png
git commit -m "fix(visual): fix N annotated issues from human review"
```

Report to user:
```
Visual Review Fix Complete:
- {N} annotated issues processed
- {M} fixed, {K} need further investigation
- Before/after comparison: visual-tests/_results/review.html (Comparison tab)
- Rebuilt: (build_command from _config.yaml)
```

## Important Rules

- ALWAYS read the "before" screenshot with the Read tool before attempting any fix
- ALWAYS focus on the annotated region coordinates — the human marked exactly where the problem is
- ALWAYS capture an "after" screenshot using the same test steps
- ALWAYS verify the fix visually (read the "after" screenshot)
- If a fix requires backend changes, run the appropriate build_command
- If you can't identify the issue from the screenshot, say so — don't guess

<p align="center">
  <img src="docs/hero.png" alt="Agentic Visual Debugger" width="100%">
</p>

# agentic-visual-debugger

### Your app ships bugs you never see. This plugin catches them.

One command scans your entire frontend. Another runs every test. A third lets you circle the problems with a pen. A fourth fixes them while you watch.

No Playwright scripts. No Cypress configs. No test code at all.

**Zero test code written by you. Ever.**

---

## 30-Second Setup

Tell Claude:

> Install the skills from github.com/bacoco/agentic-visual-debugger

Then:

```bash
/e2e-discover
```

Done. Every route in your app now has a test. For a typical Next.js app, that means 80-150 YAML manifests — you wrote nothing.

---

## The Full Workflow

```
/e2e-discover       Scan your code. Generate tests.
      |
/e2e-run            Run tests. Capture full-page screenshots.
      |
/e2e-review         Review. Annotate problems with a pen. Validate.
      |
/e2e-review-fix     AI reads your annotations, fixes the code, shows before/after.
      |
   Repeat            Until zero issues remain.
```

---

## 1. Discover

```bash
/e2e-discover
```

Scans routes, navigation, components, feature flags, and auth flows. Produces YAML manifests in plain language:

```yaml
name: "Upload PDF and verify pipeline"
priority: high
steps:
  - action: open
    url: "{base_url}/documents"
  - action: upload
    target: "file-input"
    file: "{data.pdf_file}"
  - action: llm-check
    criteria: "Entities include: seller, buyer, notary, price"
    screenshot: entities.png
```

No CSS selectors. No brittle XPaths. Tests use **visible text**. When a button label changes, the plugin adapts.

---

## 2. Run

Run everything:

```bash
/e2e-run
```

Run only what you just broke:

```bash
/e2e-run --regressions
```

Describe what you changed — the plugin figures out which tests to run:

```bash
/e2e-run I refactored the upload pipeline
/e2e-run does the sidebar show all 11 modules?
/e2e-run I just fixed the prompt-lab React error
/e2e-run check the 3 pages I modified today
```

No test exists for what you described? The plugin creates one, runs it, saves it for next time.

**Every screenshot is full-page and inspected by the AI.** Error toast? Blank page? Spinner stuck? Instant FAIL.

Regressions run first. Fixed after 3 consecutive passes? Removed automatically.

---

## 3. Review

Build the review page:

```bash
/e2e-review
```

The page opens at **http://localhost:8888**. Stop the server when you're done:

```bash
/e2e-review-stop
```

![Review Page](docs/review-page.png)

**What you see:**

- **Grid** — every test as a card with thumbnail, pass/fail badge, priority. Loads fast (thumbnails generated at build time).
- **"Last run only"** — on by default, shows only the tests that were actually run. Toggle to see the full catalog.
- **Filters** — by status (pass/fail/stale), by category (sidebar), by name (search).
- **Fullscreen** — click the eye icon or the image itself. Click again to exit.
- **Lightbox** — click any card to see the full screenshot + exact steps to reproduce.
- **Annotation pen** — click the pen icon, draw red rectangles directly on the screenshot to mark exactly where the problem is. Works in normal and fullscreen view. Each annotation auto-selects the test.

![Annotating a problem area](docs/review-annotation.png)

- **Multi-select** — check multiple tests, then:
  - **"Validate & Generate Report"** — downloads a markdown report + JSON fix manifest
  - **"Re-run selected"** — downloads a re-run manifest with annotation coordinates
  - **"Copy IDs"** — copies test paths to clipboard

![Lightbox with annotation pen](docs/review-lightbox.png)

---

## 4. Fix

After annotating and validating:

```bash
/e2e-review-fix
```

For each problem you circled:

1. AI reads the screenshot, focuses on your marked region
2. Traces the visual bug to the exact component and line
3. Implements the fix
4. Rebuilds the app
5. Recaptures the screenshot

The review page regenerates with **before/after comparison** — same grid, same annotation tools. Still see problems? Select, annotate, validate, fix again.

**The loop closes when you stop finding problems.**

---

## All Commands

| Command | What it does |
|---------|-------------|
| `/e2e-discover` | Scan codebase, generate test manifests |
| `/e2e-run` | Run all tests |
| `/e2e-run I changed X` | Run only impacted tests |
| `/e2e-review` | Build + open review page |
| `/e2e-review-stop` | Stop the server |
| `/e2e-review-fix` | Fix annotated issues, before/after |

---

## After a Fix — Test Only What Changed

You just fixed 3 bugs. You don't need to re-run 112 tests.

```bash
/e2e-run I just fixed the prompt-lab error and the dossier header count
```

The plugin checks `git diff`, finds the impacted tests, runs only those. 30 seconds instead of 40 minutes.

Then:

```bash
/e2e-review
```

The review page opens with **only the tests that just ran** — the "Last run only" filter is on by default. You see 3 screenshots, not 112. Review, annotate if needed, done.

**The full workflow after any code change:**

```bash
# 1. You fix code
# 2. Run only impacted tests
/e2e-run I changed the sidebar and the upload flow

# 3. Review only those
/e2e-review

# 4. If issues remain, annotate + fix
/e2e-review-fix

# 5. Stop server when done
/e2e-review-stop
```

No need to re-discover. No need to re-run everything. The plugin knows what changed.

---

## What Makes This Different

| Traditional E2E | agentic-visual-debugger |
|----------------|-------------------|
| You write every test | AI writes every test |
| Tests break when UI changes | Tests adapt to UI changes |
| Screenshots sit in CI artifacts nobody checks | AI reads every screenshot, fails on errors |
| Fixing requires reading test code | Circle the problem, AI traces to source |
| Before/after is a mental exercise | Before/after is a visual comparison page |
| Tests are code you maintain | Tests are YAML you barely touch |

---

## Built for Real Apps

Works with **Next.js, React, Vue, Angular** — any framework with detectable routes. Handles:

- JWT/cookie authentication flows
- Feature-flagged routes
- Multi-step workflows (upload, process, verify)
- LLM-generated content validation
- File uploads
- Responsive layouts

Tested on a production app with **112 routes, 16 services, and 6 authentication flows**.

---

## Install

Tell Claude:

> Install the skills from github.com/bacoco/agentic-visual-debugger

---

## Product Roadmap

Want the concrete execution plan to make this project production-grade? Read the **[Product Readiness PRD](docs/PRD-product-readiness.md)**.

## Contributors

Built by [Loic Baconnier](https://github.com/bacoco) with:
- **Claude Code** (Anthropic) — architecture, skills, review page, annotation system
- **Codex** (OpenAI) — code review, implementation assistance

## License

MIT

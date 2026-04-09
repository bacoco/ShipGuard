<p align="center">
  <img src="docs/hero.png" alt="Agentic Visual Debugger" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/bacoco/agentic-visual-debugger/releases"><img src="https://img.shields.io/github/v/release/bacoco/agentic-visual-debugger" alt="Latest Release"></a>
</p>

# agentic-visual-debugger

### Your app ships bugs you never see. This plugin catches them.

One command scans your entire frontend. Another runs every test. A third lets you circle the problems with a pen. A fourth fixes them while you watch.

No Playwright scripts. No Cypress configs. No test code at all.

**Zero test code written by you. Ever.**

---

## Setup

Tell Claude:

> Install the skills from github.com/bacoco/agentic-visual-debugger

Then run `/visual-discover`. Every route in your app now has a test. For a typical Next.js app, that means 80-150 YAML manifests — you wrote nothing.

---

## The Workflow

```
/visual-discover       Scan your code. Generate tests.
      |
/visual-run            Run tests. Capture full-page screenshots.
      |
/visual-review         Review. Annotate problems with a pen.
      |
/visual-fix            AI reads your annotations, fixes the code, shows before/after.
      |
   Repeat              Until zero issues remain.
```

### Discover

`/visual-discover` scans routes, navigation, components, feature flags, and auth flows. Produces YAML manifests in plain language:

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

![Discover output](docs/discover-output.png)

### Run

`/visual-run` runs everything. Or describe what you changed — the plugin figures out which tests to run:

```bash
/visual-run I refactored the upload pipeline
/visual-run I just fixed the prompt-lab React error
/visual-run check the 3 pages I modified today
```

No test exists for what you described? The plugin creates one, runs it, saves it for next time. Every screenshot is full-page and inspected by the AI. Error toast? Blank page? Spinner stuck? Instant FAIL.

Regressions run first. Fixed after 3 consecutive passes? Removed automatically.

### Review

`/visual-review` builds an interactive page at **http://localhost:8888**.

![Review Page](docs/review-page.png)

Browse every test as a card with thumbnail, pass/fail badge, and priority. Filter by status, category, or name. Click any card to open the lightbox with the full screenshot and steps to reproduce.

**See a problem? Mark it.**

Click the pen icon and draw red rectangles directly on the screenshot to circle exactly what's wrong. Each annotation auto-selects the test for fixing.

![Annotating a problem area](docs/review-annotation.png)

You can also select multiple tests by checking the cards — whether you annotate them or not. The floating action bar lets you:

- **"Validate & Generate Report"** — exports a fix manifest (JSON) with your annotations + a markdown report. This is what `/visual-fix` reads.
- **"Re-run selected"** — exports a re-run manifest to test only those specific tests again.
- **"Copy IDs"** — copies test paths to clipboard.

![Lightbox with annotation pen](docs/review-lightbox.png)

### Fix

Once you've annotated and exported, run `/visual-fix`. It picks up the fix manifest automatically.

For each test you selected:

1. Reads the screenshot and focuses on your marked regions
2. Traces the visual bug to the exact source component and line
3. Implements the fix
4. Rebuilds the app
5. Re-runs that specific test to capture a new "after" screenshot

When all fixes are done, the review page regenerates with a **before/after comparison tab** — the same grid, but now each fixed test shows the old and new screenshot side by side.

![Before and after](docs/fix-before-after.png)

**Still see problems?** Open the comparison tab, annotate again, export, run `/visual-fix` again. The loop continues until you stop finding issues.

---

## All Commands

| Command | What it does |
|---------|-------------|
| `/visual-discover` | Scan codebase, generate test manifests |
| `/visual-run` | Run all tests |
| `/visual-run I changed X` | Run only impacted tests |
| `/visual-review` | Build + open review page |
| `/visual-review-stop` | Stop the server |
| `/visual-fix` | Fix annotated issues, before/after |

---

## What Makes This Different

| Traditional Testing | agentic-visual-debugger |
|--------------------|-------------------|
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

## Product Roadmap

Read the **[Product Readiness PRD](docs/PRD-product-readiness.md)**.

## Development

```bash
git clone https://github.com/bacoco/agentic-visual-debugger.git
cp -r plugins/e2e-agent-browser ~/.claude/plugins/
```

## Contributors

Built by [Loic Baconnier](https://github.com/bacoco) with:
- **Claude Code** (Anthropic) — architecture, skills, review page, annotation system
- **Codex** (OpenAI) — code review, implementation assistance

## License

MIT

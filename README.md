<p align="center">
  <img src="docs/hero.png" alt="Agentic Visual Debugger" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/bacoco/agentic-visual-debugger/releases"><img src="https://img.shields.io/github/v/release/bacoco/agentic-visual-debugger" alt="Latest Release"></a>
</p>

# agentic-visual-debugger

### You push code. You don't know what you broke. This plugin does.

One command. Every page in your app gets tested, screenshotted, and inspected by AI. Broken layout? Missing data? Error toast hiding in a corner? It catches it. You circle the problem with a pen. The AI fixes it.

**You never write a single test.**

---

## You vs. this plugin

| What you do today | What happens with this plugin |
|--------------------|-------------------|
| Write tests for every page | AI generates them from your codebase |
| Tests break every time you refactor | Tests use visible text, not CSS selectors — they adapt |
| Screenshots rot in CI artifacts | AI reads every screenshot and fails on visual errors |
| Bug? Read the test code, figure out what broke | Circle the problem on the screenshot. AI traces it to the source and fixes it. |
| "Did my fix actually work?" | Side-by-side before/after comparison |

---

## 2 minutes from install to first result

**Step 1** — Install the plugin in [Claude Code](https://claude.ai/code):

> Install the skills from github.com/bacoco/agentic-visual-debugger

**Step 2** — Scan your app:

```
/visual-discover
```

Done. 80-150 tests generated. You wrote nothing.

**Step 3** — Run them:

```
/visual-run
```

Every page screenshotted. Every screenshot inspected. Failures flagged.

![All your tests in one view](docs/discover-output.png)

---

## See a bug? Circle it.

`/visual-review` opens an interactive review page. Every test is a card. Click one to see the full screenshot.

![Review page](docs/review-page.png)

Spot a problem? Click the pen. Draw a rectangle around it. That's it — you just told the AI exactly where to look.

![Circle the bug](docs/review-annotation.png)

Select the tests you want fixed. Click **"Validate & Generate Report"**. This exports a fix manifest — the list of everything the AI needs to fix, with your annotations attached.

![Lightbox with details](docs/review-lightbox.png)

---

## The AI fixes it while you watch

```
/visual-fix
```

For each problem you circled:

1. The AI reads your screenshot and zooms into the region you marked
2. It traces the visual bug to the exact component and line of code
3. It implements the fix
4. It rebuilds the app
5. It re-runs that specific test and captures a new screenshot

The review page regenerates with a **before/after comparison tab**. Old screenshot on the left, new one on the right. You see exactly what changed.

![Before and after](docs/fix-before-after.png)

Still not right? Annotate again. Run `/visual-fix` again. **The loop closes when you stop finding problems.**

---

## After a code change — test only what matters

You don't re-run 112 tests after fixing a button. Just describe what you changed:

```
/visual-run I fixed the sidebar and the upload flow
```

The plugin checks your `git diff`, finds the 3 impacted tests, runs those. 30 seconds, not 40 minutes. No test exists for what you changed? The plugin creates one on the fly.

---

## Commands

| Command | What it does |
|---------|-------------|
| `/visual-discover` | Scan your codebase, generate tests for every route |
| `/visual-run` | Run tests — all, or describe what changed |
| `/visual-review` | Open the visual review page |
| `/visual-fix` | Fix everything you annotated, show before/after |
| `/visual-review-stop` | Stop the review server |

---

## Proven on a real production app

**112 routes. 16 backend services. 6 authentication flows.**

Next.js, React, Vue, Angular — any framework with detectable routes. Handles JWT auth, feature flags, file uploads, multi-step workflows, LLM-generated content, responsive layouts.

This isn't a demo. It runs daily on a real SaaS platform.

---

## How it works under the hood

Tests are YAML manifests that describe what the user sees — not how the DOM is structured:

```yaml
- action: click
  target: "Nouvelle conversation"     # visible text, not .btn-primary-v2
- action: llm-check
  criteria: "The page shows seller, buyer, and notary names"
```

When a CSS class changes, Playwright tests break. These don't — because they never knew about the class.

For the full architecture and design decisions, read the **[Design Spec](docs/design-spec.md)**.

---

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/bacoco/agentic-visual-debugger.git
   ```

2. Copy the skills to your project's Claude skills directory:
   ```bash
   # From the cloned repo
   cp -r plugins/e2e-agent-browser/skills/* /path/to/your-project/.claude/skills/
   ```

3. Copy the build script and template to your project:
   ```bash
   mkdir -p /path/to/your-project/visual-tests
   cp plugins/e2e-agent-browser/skills/visual-review/build-review.mjs /path/to/your-project/visual-tests/
   cp plugins/e2e-agent-browser/skills/visual-review/_review-template.html /path/to/your-project/visual-tests/
   ```

4. (Optional) For global access, create symlinks:
   ```bash
   ln -s $(pwd)/plugins/e2e-agent-browser/skills/* ~/.claude/skills/
   ```

## Contributors

Built by [Loic Baconnier](https://github.com/bacoco) with:
- **Claude Code** (Anthropic) — architecture, skills, review page, annotation system
- **Codex** (OpenAI) — code review, implementation assistance

## License

MIT

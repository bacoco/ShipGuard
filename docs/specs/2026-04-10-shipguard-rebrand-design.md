# ShipGuard Full Rebrand — Design Spec

**Date:** 2026-04-10
**Status:** Approved

## Overview

Complete rebrand of the Claude Code plugin from "Agentic Visual Debugger" to "ShipGuard". This covers: GitHub repo rename, directory renames, skill renames with `sg-` namespace, full doc rewrite, and fresh screenshots.

## Identity

- **Product name:** ShipGuard
- **Repo:** `bacoco/shipguard` (renamed from `bacoco/agentic-visual-debugger`)
- **Plugin directory:** `plugins/shipguard/` (renamed from `plugins/agentic-visual-debugger/`)
- **Tagline:** "AI-powered code audit + visual E2E testing. Zero tests written."

## Skill Naming

All skills get the `sg-` namespace prefix. `visual` is kept in the name for semantic clarity.

| Old name | New name | New directory |
|----------|----------|---------------|
| `visual-run` | `sg-visual-run` | `skills/sg-visual-run/` |
| `visual-review` | `sg-visual-review` | `skills/sg-visual-review/` |
| `visual-discover` | `sg-visual-discover` | `skills/sg-visual-discover/` |
| `visual-fix` | `sg-visual-fix` | `skills/sg-visual-fix/` |
| `visual-review-stop` | `sg-visual-review-stop` | `skills/sg-visual-review-stop/` |
| `code-audit` | `sg-code-audit` | `skills/sg-code-audit/` |

### What changes per skill

1. **Directory name** — `skills/visual-run/` → `skills/sg-visual-run/`
2. **Frontmatter `name:`** — `visual-run` → `sg-visual-run`
3. **Frontmatter `description:`** — update trigger phrases (add `sg-visual-run` as trigger)
4. **Cross-references** — any mention of `/visual-run`, `/visual-review`, etc. becomes `/sg-visual-run`, `/sg-visual-review`, etc.
5. **Build script imports** — `build-review.mjs` references `_review-template.html` by relative path (no change needed since it's within the same skill directory)

## Target Directory Structure

```
shipguard/                              (GitHub repo)
├── .claude-plugin/
│   └── marketplace.json
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   └── PULL_REQUEST_TEMPLATE.md
├── docs/
│   ├── architecture.md                 (rewrite of design-spec.md)
│   ├── product-roadmap.md              (rewrite of PRD-product-readiness.md)
│   ├── screenshots/                    (recaptured)
│   │   ├── hero-banner.jpg
│   │   ├── code-audit-bugs.png
│   │   ├── visual-tests-grid.png
│   │   ├── annotation-with-note.png
│   │   ├── discover-output.png
│   │   └── monitor-tab-gantt.png
│   ├── specs/
│   │   ├── 2026-04-10-code-audit-design.md
│   │   └── 2026-04-10-shipguard-rebrand-design.md
│   └── superpowers/
│       └── plans/
├── examples/
├── plugins/
│   └── shipguard/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── LICENSE
│       ├── README.md                   (technical docs)
│       └── skills/
│           ├── sg-code-audit/
│           ├── sg-visual-discover/
│           ├── sg-visual-fix/
│           ├── sg-visual-review/
│           ├── sg-visual-review-stop/
│           └── sg-visual-run/
└── README.md                           (marketing + quickstart)
```

## Root README Structure

Tone: marketing pitch (3-4 phrases) then dev quickstart.

1. **Hero image** — `docs/screenshots/hero-banner.jpg` (Code Audit tab with bug cards)
2. **Tagline** — one line
3. **Pitch** — 3-4 phrases: the problem, the solution, why ShipGuard is different
4. **The flow** — 3 commands:
   ```
   /sg-code-audit              # Find bugs in code
   /sg-visual-run --from-audit # Verify impacted routes visually
   /sg-visual-review           # See everything in one dashboard
   ```
5. **Install** — `claude plugin add bacoco/shipguard`
6. **Skills table** — 6 skills, one-line description each
7. **Screenshots** — 3-4 images from `docs/screenshots/`
8. **Modes table** — quick/standard/deep/paranoid
9. **License** — MIT

## Plugin README Structure

Technical documentation for users who have installed the plugin.

1. **Quick reference** — all 6 skill invocations
2. **sg-code-audit** — modes, flags, output format, JSON schema summary
3. **sg-visual-run** — modes (interactive, natural language, --from-audit)
4. **sg-visual-review** — what the dashboard shows, how to annotate
5. **sg-visual-discover** — when to use, what it generates
6. **sg-visual-fix** — how it reads annotations and fixes code
7. **Configuration** — `_config.yaml` format
8. **MCP servers** — if applicable

## Docs to Rewrite

### architecture.md (was design-spec.md)

Current state: describes the original visual-only tool with comparisons to Playwright/Cypress. Outdated.

New content:
- ShipGuard philosophy (code audit + visual verification, zero tests written)
- Architecture overview (6 skills, data flow between them)
- Zone discovery algorithm
- Multi-round audit strategy (R1/R2/R3)
- JSON schemas (per-zone and aggregated)
- Visual test manifest format
- Review page architecture (build-review.mjs → HTML template)

### product-roadmap.md (was PRD-product-readiness.md)

Current state: pre-launch readiness checklist for the visual-only tool. Outdated.

New content:
- Current feature status (what's shipped in v2.0.0)
- Known limitations
- Roadmap items (what's next)

## Screenshots to Recapture

Captured via agent-browser + build-review.mjs with test data. 6 screenshots (actual filenames):

1. **hero-banner.jpg** — Gemini-generated hero image (compressed from 7.2MB to 212KB)
2. **code-audit-bugs.png** — Code Audit tab with 8 bug cards, severity colors, filters
3. **visual-tests-grid.png** — screenshot grid with 3 tests, real thumbnails, PASS/FAIL badges
4. **annotation-with-note.png** — lightbox with drawn rectangle + text note describing the problem
5. **discover-output.png** — terminal output of `/sg-visual-discover` showing 24 routes, smart scope
6. **monitor-tab-gantt.png** — Monitor tab — Gantt timeline of audit agents with live stats.

Screenshots go to `docs/screenshots/` (not `docs/` root). Old images at `docs/*.png` are deleted.

## GitHub Repo Rename

Execute `gh repo rename shipguard` from the local repo. This:
- Renames the repo to `bacoco/shipguard`
- Creates an automatic redirect from `bacoco/agentic-visual-debugger`
- Updates the remote URL locally

Done LAST, after all file changes are committed and pushed.

## Config File Changes

### marketplace.json
```json
{
  "name": "shipguard",
  "owner": {
    "name": "Loic Baconnier",
    "url": "https://github.com/bacoco"
  },
  "plugins": [
    {
      "name": "shipguard",
      "description": "AI-powered code audit + visual E2E testing. Zero tests written.",
      "source": "./plugins/shipguard",
      "category": "testing",
      "homepage": "https://github.com/bacoco/shipguard"
    }
  ]
}
```

### plugin.json (already correct, just verify)
```json
{
  "name": "shipguard",
  "description": "ShipGuard — AI-powered code audit + visual E2E testing. Audit the code first, verify visually second. Zero tests written.",
  "version": "2.0.0",
  "author": {
    "name": "bacoco"
  }
}
```

## Out of Scope

- Skill logic changes (no functional changes, only renames and doc)
- New features
- Test infrastructure changes
- examples/ directory changes (keep as-is)

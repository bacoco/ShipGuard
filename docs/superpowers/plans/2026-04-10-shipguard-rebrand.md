# ShipGuard Full Rebrand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully rebrand from "Agentic Visual Debugger" to "ShipGuard" — rename repo, directories, skills, docs, screenshots.

**Architecture:** Directory renames via `git mv`, bulk find-replace for cross-references, doc rewrites, screenshot recapture. Repo rename last.

**Tech Stack:** Git, gh CLI, agent-browser (screenshots), markdown

**Spec:** `docs/specs/2026-04-10-shipguard-rebrand-design.md`

---

## File Structure

```
Changes:
  RENAME: plugins/agentic-visual-debugger/ → plugins/shipguard/
  RENAME: skills/visual-run/ → skills/sg-visual-run/
  RENAME: skills/visual-review/ → skills/sg-visual-review/
  RENAME: skills/visual-discover/ → skills/sg-visual-discover/
  RENAME: skills/visual-fix/ → skills/sg-visual-fix/
  RENAME: skills/visual-review-stop/ → skills/sg-visual-review-stop/
  RENAME: skills/code-audit/ → skills/sg-code-audit/
  MODIFY: all 6 SKILL.md frontmatters + cross-references
  MODIFY: skills/sg-visual-review/build-review.mjs (if any path refs)
  MODIFY: skills/sg-visual-review/_review-template.html (if any skill refs)
  MODIFY: .claude-plugin/marketplace.json
  MODIFY: plugins/shipguard/.claude-plugin/plugin.json (verify)
  REWRITE: README.md (root)
  REWRITE: plugins/shipguard/README.md
  REWRITE: docs/design-spec.md → docs/architecture.md
  REWRITE: docs/PRD-product-readiness.md → docs/product-roadmap.md
  MODIFY: docs/specs/2026-04-10-code-audit-design.md
  MODIFY: .github/ISSUE_TEMPLATE/bug_report.md
  DELETE: docs/hero.png, docs/review-*.png, docs/discover-output.png, docs/fix-before-after.png
  CREATE: docs/screenshots/hero.png (recaptured)
  CREATE: docs/screenshots/code-audit-tab.png
  CREATE: docs/screenshots/visual-tests-tab.png
  CREATE: docs/screenshots/lightbox.png
  CREATE: docs/screenshots/discover-output.png
```

---

### Task 1: Rename plugin directory and all skill directories

**Files:**
- Rename: `plugins/agentic-visual-debugger/` → `plugins/shipguard/`
- Rename: 6 skill directories (add `sg-` prefix)

- [ ] **Step 1: Rename plugin directory**

```bash
cd /path/to/agentic-visual-debugger
git mv plugins/agentic-visual-debugger plugins/shipguard
```

- [ ] **Step 2: Rename skill directories**

```bash
cd /path/to/agentic-visual-debugger/plugins/shipguard/skills
git mv visual-run sg-visual-run
git mv visual-review sg-visual-review
git mv visual-discover sg-visual-discover
git mv visual-fix sg-visual-fix
git mv visual-review-stop sg-visual-review-stop
git mv code-audit sg-code-audit
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: rename plugin dir + skill dirs for ShipGuard rebrand"
```

---

### Task 2: Update all skill frontmatters and cross-references

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-run/SKILL.md`
- Modify: `plugins/shipguard/skills/sg-visual-review/SKILL.md`
- Modify: `plugins/shipguard/skills/sg-visual-discover/SKILL.md`
- Modify: `plugins/shipguard/skills/sg-visual-fix/SKILL.md`
- Modify: `plugins/shipguard/skills/sg-visual-review-stop/SKILL.md`
- Modify: `plugins/shipguard/skills/sg-code-audit/SKILL.md`
- Modify: `plugins/shipguard/skills/sg-visual-review/_review-template.html` (if any skill name refs)
- Modify: `plugins/shipguard/skills/sg-visual-review/build-review.mjs` (if any skill name refs)

For EACH of the 6 SKILL.md files:

- [ ] **Step 1: Update sg-visual-run/SKILL.md**

1. Change frontmatter `name: visual-run` → `name: sg-visual-run`
2. In frontmatter `description:`, add "sg-visual-run" to trigger list, keep "visual run" and "run visual tests" as triggers too
3. Replace ALL occurrences of `/visual-run` → `/sg-visual-run` (invocations, examples)
4. Replace ALL occurrences of `/visual-review` → `/sg-visual-review`
5. Replace ALL occurrences of `/visual-discover` → `/sg-visual-discover`
6. Replace ALL occurrences of `/visual-fix` → `/sg-visual-fix`
7. Replace ALL occurrences of `/code-audit` → `/sg-code-audit`

Use find-and-replace across the file. Be careful NOT to replace partial matches inside words (e.g. `visual-review-stop` should become `sg-visual-review-stop`, not `sg-visual-sg-visual-review-stop`).

**Replacement order (longest match first to avoid double-replacing):**
1. `/visual-review-stop` → `/sg-visual-review-stop`
2. `/visual-review` → `/sg-visual-review`
3. `/visual-run` → `/sg-visual-run`
4. `/visual-discover` → `/sg-visual-discover`
5. `/visual-fix` → `/sg-visual-fix`
6. `/code-audit` → `/sg-code-audit`
7. `name: visual-run` → `name: sg-visual-run` (frontmatter)

Apply the same replacement order for `visual-review-stop` in trigger text (without leading `/`).

- [ ] **Step 2: Update sg-visual-review/SKILL.md**

Same replacement pattern as Step 1. Additionally:
- Change frontmatter `name: visual-review` → `name: sg-visual-review`
- Update trigger phrases in description

- [ ] **Step 3: Update sg-visual-discover/SKILL.md**

Same replacement pattern. Change `name: visual-discover` → `name: sg-visual-discover`.

- [ ] **Step 4: Update sg-visual-fix/SKILL.md**

Same replacement pattern. Change `name: visual-fix` → `name: sg-visual-fix`.

- [ ] **Step 5: Update sg-visual-review-stop/SKILL.md**

Same replacement pattern. Change `name: visual-review-stop` → `name: sg-visual-review-stop`.

- [ ] **Step 6: Update sg-code-audit/SKILL.md**

Same replacement pattern. Change `name: code-audit` → `name: sg-code-audit`.

This file has ~14 cross-references to other skills. Key areas:
- Phase 6 mentions `/visual-run --from-audit` → `/sg-visual-run --from-audit`
- Phase 6 mentions `/visual-review` → `/sg-visual-review`
- References to `references/checklists.md` stay unchanged (relative path within same skill)

- [ ] **Step 7: Update sg-code-audit/references/checklists.md**

Check for any skill name references. If none, skip.

- [ ] **Step 8: Check _review-template.html for skill refs**

Grep for `visual-run`, `visual-review`, `visual-fix`, `code-audit` in the HTML template. Replace any found with `sg-` prefixed versions. The template has at least 2 references (the `/visual-fix` instruction in the success overlay).

- [ ] **Step 9: Check build-review.mjs for skill refs**

Grep for skill name references. These are file-path based (relative), so probably no changes needed. Verify.

- [ ] **Step 10: Verify — grep entire skills/ directory for old names**

```bash
cd /path/to/agentic-visual-debugger
grep -r "\/visual-run\|\/visual-review\|\/visual-discover\|\/visual-fix\|\/code-audit" plugins/shipguard/skills/ --include="*.md" --include="*.html" --include="*.mjs"
```

If any old references remain, fix them. The ONLY acceptable matches are:
- Inside trigger phrases in descriptions (e.g. "visual run" without `/` prefix as a natural language trigger)
- The word "visual" in prose descriptions (not as a skill invocation)

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: update all skill frontmatters and cross-references to sg-* namespace"
```

---

### Task 3: Update config files

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Verify: `plugins/shipguard/.claude-plugin/plugin.json`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.md`

- [ ] **Step 1: Update marketplace.json**

Replace the full content with:

```json
{
  "name": "shipguard",
  "owner": {
    "name": "ShipGuard contributors",
    "url": "https://github.com/bacoco/ShipGuard"
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

- [ ] **Step 2: Verify plugin.json**

Read `plugins/shipguard/.claude-plugin/plugin.json`. It should already say `"name": "shipguard"` and version `"2.0.0"`. If correct, no changes needed.

- [ ] **Step 3: Update bug_report.md**

Replace "agentic-visual-debugger" with "ShipGuard" in `.github/ISSUE_TEMPLATE/bug_report.md`.

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/marketplace.json .github/ISSUE_TEMPLATE/bug_report.md
git commit -m "refactor: update config files for ShipGuard rebrand"
```

---

### Task 4: Rewrite root README.md

**Files:**
- Rewrite: `README.md` (root)

- [ ] **Step 1: Write new root README**

Structure:
1. Hero image: `![ShipGuard](docs/screenshots/hero.png)`
2. Tagline: "AI-powered code audit + visual E2E testing. Zero tests written."
3. Pitch (3-4 phrases): You push code. You don't know what you broke. ShipGuard finds bugs in your code with parallel AI agents, then visually verifies the impacted pages. No test files to write, no test infrastructure to maintain.
4. The flow:
   ```
   /sg-code-audit              # Find bugs in code
   /sg-visual-run --from-audit # Verify impacted routes visually
   /sg-visual-review           # See everything in one dashboard
   ```
5. Install: `claude plugin add bacoco/shipguard`
6. Skills table:

   | Skill | What it does |
   |-------|-------------|
   | `/sg-code-audit` | Dispatch parallel agents to find and fix bugs across your repo |
   | `/sg-visual-run` | Run visual tests with agent-browser — scripted or natural language |
   | `/sg-visual-review` | Interactive dashboard — screenshots + code audit in one page |
   | `/sg-visual-discover` | Scan your app and generate YAML test manifests automatically |
   | `/sg-visual-fix` | Read annotated screenshots, trace bugs to source, fix and show before/after |
   | `/sg-visual-review-stop` | Stop the review dashboard server |

7. Screenshots: 3 images (hero already shown, add code-audit-tab and visual-tests-tab)
8. Code Audit modes table (quick/standard/deep/paranoid with agents/rounds)
9. License: MIT

Note: screenshots won't exist yet (captured in Task 8). Use the image paths anyway — they'll work after Task 8.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite root README for ShipGuard rebrand"
```

---

### Task 5: Rewrite plugin README.md

**Files:**
- Rewrite: `plugins/shipguard/README.md`

- [ ] **Step 1: Write new plugin README**

Structure:
1. Title: "# ShipGuard"
2. Quick reference: all 6 skill invocations with one-line descriptions
3. **sg-code-audit section:**
   - Modes: quick/standard/deep/paranoid (table)
   - Flags: --focus, --report-only
   - Output: audit-results.json location and schema summary
   - Multi-round: R1 surface, R2 depth, R3 edge cases
4. **sg-visual-run section:**
   - Interactive mode (no args → asks user)
   - Natural language mode (describe what to test)
   - `--from-audit` mode (reads impacted_routes from code audit)
   - `--regressions` mode
5. **sg-visual-review section:**
   - What the dashboard shows (Visual Tests tab + Code Audit tab)
   - How to annotate screenshots
   - How to validate and generate fix manifest
6. **sg-visual-discover section:**
   - When to use (new project, after UI changes)
   - What it generates (YAML manifests mirroring navigation tree)
7. **sg-visual-fix section:**
   - Reads fix-manifest.json from annotations
   - Traces problems to source code
   - Fixes and shows before/after screenshots
8. **Configuration:**
   - `_config.yaml` format (base_url, credentials)
   - `_regressions.yaml` tracking
9. **License:** MIT

- [ ] **Step 2: Commit**

```bash
git add plugins/shipguard/README.md
git commit -m "docs: rewrite plugin README for ShipGuard"
```

---

### Task 6: Rewrite architecture doc

**Files:**
- Delete: `docs/design-spec.md`
- Create: `docs/architecture.md`

- [ ] **Step 1: Read current design-spec.md for reference**

Read the existing file to extract any still-relevant technical details.

- [ ] **Step 2: Write architecture.md**

Structure:
1. **Philosophy** — code audit narrows the field, visual audit confirms reality, human decides what matters
2. **Skills overview** — 6 skills, their roles, data flow between them
3. **sg-code-audit architecture:**
   - Zone discovery algorithm (find → split → merge → cap)
   - Multi-round strategy (R1/R2/R3)
   - Agent dispatch (worktree isolation, background execution)
   - Merge strategy (clean tree check, abort on conflict)
   - JSON schemas (per-zone + aggregated, with full examples)
4. **sg-visual-run architecture:**
   - Manifest format (YAML)
   - Execution strategy (sequential, single browser session)
   - Hybrid assertions (scripted steps + LLM evaluation)
5. **sg-visual-review architecture:**
   - Build pipeline (build-review.mjs → HTML template)
   - Data injection (`__PLACEHOLDER_VISUAL_DATA__`)
   - Tab system (Visual Tests + Code Audit, conditional)
   - Annotation system (canvas drawing, fix-manifest.json)
6. **Data flow diagram:**
   ```
   /sg-code-audit → audit-results.json → /sg-visual-run --from-audit
                                        → /sg-visual-review (Code Audit tab)
   /sg-visual-run → screenshots + report.md → /sg-visual-review (Visual Tests tab)
   /sg-visual-review → fix-manifest.json → /sg-visual-fix
   /sg-visual-fix → before/after screenshots → /sg-visual-review (updated)
   ```

- [ ] **Step 3: Delete old design-spec.md**

```bash
git rm docs/design-spec.md
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: rewrite architecture doc for ShipGuard v2.0"
```

---

### Task 7: Rewrite product roadmap + update specs

**Files:**
- Delete: `docs/PRD-product-readiness.md`
- Create: `docs/product-roadmap.md`
- Modify: `docs/specs/2026-04-10-code-audit-design.md`
- Modify: `docs/superpowers/plans/2026-04-10-code-audit-skill.md`

- [ ] **Step 1: Write product-roadmap.md**

Structure:
1. **Shipped in v2.0.0:**
   - 6 skills (sg-code-audit, sg-visual-run, sg-visual-review, sg-visual-discover, sg-visual-fix, sg-visual-review-stop)
   - Parallel agent dispatch with worktree isolation
   - Multi-round audit (R1/R2/R3)
   - Unified dashboard (Visual Tests + Code Audit tabs)
   - Code→Visual handoff (--from-audit)
   - 7 language checklists (Python, TS/React, Next.js, Infra, Go, Rust, JVM)
2. **Known limitations:**
   - Zone discovery uses file count heuristic (not AST)
   - Route detection is best-effort (framework-specific patterns)
   - No CI/CD integration yet
   - No diff-mode (audit only changed files)
3. **Roadmap:**
   - Diff-mode: audit only git-changed files
   - CI integration: GitHub Actions
   - Severity confidence scores
   - Custom checklist injection

- [ ] **Step 2: Delete old PRD**

```bash
git rm docs/PRD-product-readiness.md
```

- [ ] **Step 3: Rewrite contradictory sections in code-audit spec**

In `docs/specs/2026-04-10-code-audit-design.md`:
- Replace "agentic-visual-debugger" → "shipguard"
- Replace `/visual-run` → `/sg-visual-run`
- Replace `/visual-review` → `/sg-visual-review`
- Replace `/code-audit` → `/sg-code-audit`
- Replace `bacoco/agentic-visual-debugger` → `bacoco/shipguard`
- **REWRITE the "Repo Rename" section (line ~300):** The statement "Existing visual-* skills keep their names (no breaking change)" is now FALSE. Replace with: "All skills are prefixed with `sg-`: `sg-code-audit`, `sg-visual-run`, `sg-visual-review`, `sg-visual-discover`, `sg-visual-fix`, `sg-visual-review-stop`."
- **REWRITE the install command:** `claude plugin add bacoco/shipguard` (not marketplace add)

- [ ] **Step 4: Rewrite contradictory sections in code-audit plan**

In `docs/superpowers/plans/2026-04-10-code-audit-skill.md`:
- Replace `plugins/agentic-visual-debugger/` → `plugins/shipguard/`
- Replace `/visual-run` → `/sg-visual-run`
- Replace `/visual-review` → `/sg-visual-review`
- Replace `/code-audit` → `/sg-code-audit`
- **REWRITE the Task 6 rebrand decision note (line ~490):** The statement "The git repo stays agentic-visual-debugger... Skill file names stay unchanged... No directory renames." is now FALSE. Replace with: "Repo renamed to `bacoco/shipguard`. Plugin dir is `plugins/shipguard/`. All skills prefixed with `sg-`."
- **Update all `git add` paths** that reference `plugins/agentic-visual-debugger/` → `plugins/shipguard/`

- [ ] **Step 5: Commit**

```bash
git add docs/product-roadmap.md docs/specs/ docs/superpowers/plans/
git commit -m "docs: rewrite product roadmap + update spec/plan refs for ShipGuard"
```

---

### Task 8: Recapture screenshots

**Files:**
- Delete: `docs/hero.png`, `docs/review-*.png`, `docs/discover-output.png`, `docs/fix-before-after.png`
- Create: `docs/screenshots/hero.png`
- Create: `docs/screenshots/code-audit-tab.png`
- Create: `docs/screenshots/visual-tests-tab.png`
- Create: `docs/screenshots/lightbox.png`
- Create: `docs/screenshots/discover-output.png`

- [ ] **Step 1: Set up test data for review page**

Create temporary test fixtures in `/tmp/sg-screenshot-fixtures/` (NOT in the repo tree — avoids accidental commit):

```bash
FIXTURES=/tmp/sg-screenshot-fixtures
mkdir -p $FIXTURES/test-category $FIXTURES/_results/screenshots
```

- Write `_config.yaml` with base_url to `$FIXTURES/`
- Write a test YAML manifest to `$FIXTURES/test-category/sample.yaml`
- Write a fake `audit-results.json` with 6+ bugs across severities to `$FIXTURES/_results/`
- Copy `build-review.mjs` and `_review-template.html` from the skill dir to `$FIXTURES/`
- Run `node $FIXTURES/build-review.mjs` to generate the HTML
- Start the server with `node $FIXTURES/build-review.mjs --serve --port=8899`

This keeps all temporary data outside the git tree. Cleanup = `rm -rf /tmp/sg-screenshot-fixtures`.

- [ ] **Step 2: Create screenshots directory and capture hero.png — Code Audit tab**

```bash
mkdir -p docs/screenshots
agent-browser open http://localhost:8899
# Click "Code Audit" tab
agent-browser screenshot docs/screenshots/hero.png
```

Should show: bug cards with severity colors, filter bar, stats badges.

- [ ] **Step 3: Capture code-audit-tab.png — filtered view**

Click the "critical" severity filter to show a filtered view.
```bash
agent-browser screenshot docs/screenshots/code-audit-tab.png
```

- [ ] **Step 4: Capture visual-tests-tab.png**

Click "Visual Tests" tab.
```bash
agent-browser screenshot docs/screenshots/visual-tests-tab.png
```

Should show: screenshot grid with pass/fail/stale badges, sidebar categories.

- [ ] **Step 5: Capture lightbox.png**

Click a test card to open the lightbox. If no screenshots exist for test data, create a placeholder PNG first.
```bash
agent-browser screenshot docs/screenshots/lightbox.png
```

- [ ] **Step 6: Capture discover-output.png**

This is a terminal screenshot. Take a screenshot of terminal output showing `/sg-visual-discover` results. If not practical with agent-browser, skip this one — the other 4 screenshots are sufficient for the README.

- [ ] **Step 7: Clean up test fixtures**

```bash
# Stop the server
node $FIXTURES/build-review.mjs --stop 2>/dev/null || true
# Delete temp dir entirely
rm -rf /tmp/sg-screenshot-fixtures
```

Verify nothing leaked into the repo: `git status --porcelain` should show only `docs/screenshots/*.png` as new files, nothing else.

- [ ] **Step 8: Delete old screenshots**

```bash
git rm docs/hero.png docs/review-page.png docs/review-grid-full.png docs/review-annotation.png docs/review-lightbox.png docs/discover-output.png docs/fix-before-after.png
```

- [ ] **Step 9: Commit**

```bash
git add docs/screenshots/
git commit -m "docs: recapture screenshots for ShipGuard rebrand"
```

---

### Task 9: Rename GitHub repo + update remote

**Files:**
- No file changes — git/GitHub operations only

- [ ] **Step 1: Verify tree is clean and everything is pushed**

```bash
cd /path/to/agentic-visual-debugger
# Hard check: if anything is uncommitted, STOP
if [ -n "$(git status --porcelain)" ]; then echo "ERROR: uncommitted changes — commit or stash before renaming"; git status --short; exit 1; fi
git push
```

All changes from Tasks 1-8 must be committed AND pushed before renaming. Do NOT proceed with `gh repo rename` if the porcelain check fails.

- [ ] **Step 2: Rename the repo**

```bash
gh repo rename shipguard --yes
```

This renames `bacoco/agentic-visual-debugger` → `bacoco/shipguard`. GitHub creates automatic redirects.

- [ ] **Step 3: Update local remote**

```bash
git remote set-url origin git@github.com:bacoco/shipguard.git
```

- [ ] **Step 4: Verify**

```bash
git remote -v
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```

Expected: `bacoco/shipguard`

- [ ] **Step 5: Verify push works**

```bash
git push
```

---

### Task 10: Final verification

**Files:**
- No files — verification only

- [ ] **Step 1: Grep for any remaining old references**

```bash
cd /path/to/agentic-visual-debugger
grep -r "agentic-visual-debugger" --include="*.md" --include="*.json" --include="*.html" --include="*.mjs" --include="*.yaml" . | grep -v ".git/" | grep -v "node_modules" | grep -v "shipguard-rebrand"
```

Should return ZERO matches. The `grep -v "shipguard-rebrand"` excludes the rebrand spec/plan files which intentionally mention the old name as historical context. Any OTHER matches must be fixed.

- [ ] **Step 2: Grep for old skill names without sg- prefix**

```bash
grep -rn "\/visual-run\|\/visual-review\|\/visual-discover\|\/visual-fix\|\/code-audit" --include="*.md" --include="*.json" --include="*.html" . | grep -v ".git/" | grep -v "shipguard-rebrand"
```

Review each match manually. Acceptable matches:
- Lines that ALSO contain the `sg-` version (e.g. "renamed from /visual-run to /sg-visual-run")
- Natural language triggers in skill descriptions (e.g. "visual run" without `/` prefix)

Unacceptable matches: any `/visual-run`, `/visual-review`, etc. used as an invocation command without `sg-` prefix. Fix these.

- [ ] **Step 3: Verify install**

The canonical install command is `claude install-plugin bacoco/shipguard`. The exact CLI syntax depends on the Claude Code version — check `claude --help` for the right subcommand. The test here is that the plugin resolves and lists skills correctly, not the specific CLI syntax.

```bash
# Verify the repo is reachable and plugin.json is valid
gh repo view bacoco/shipguard --json name --jq '.name'
```

Verify the plugin installs and skills are listed with `sg-` prefixed names.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: clean up remaining old references"
git push
```

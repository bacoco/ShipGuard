# ShipGuard `/sg-code-audit` Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/sg-code-audit` skill to ShipGuard that dispatches parallel AI agents to audit a codebase, fix bugs, and produce structured JSON results viewable in the visual-review dashboard.

**Architecture:** Single SKILL.md orchestrates the full flow: detect stack → discover zones → dispatch agents in worktrees → collect JSON → merge → aggregate → report. The visual-review page gains a "Code Audit" tab by reading `audit-results.json`. A handoff field `impacted_routes` feeds into `/sg-visual-run --from-audit`.

**Tech Stack:** Claude Code skills (SKILL.md), Agent tool with worktree isolation, Node.js build script (build-review.mjs), HTML/CSS/JS (review template)

**Spec:** `docs/specs/2026-04-10-code-audit-design.md`

---

## File Structure

```
plugins/shipguard/skills/
  code-audit/
    SKILL.md                    ← NEW: main skill (orchestration logic)
    references/
      checklists.md             ← NEW: language-specific bug checklists
  visual-review/
    _review-template.html       ← MODIFY: add Code Audit tab
    build-review.mjs            ← MODIFY: read audit-results.json
  visual-run/
    SKILL.md                    ← MODIFY: add --from-audit flag
```

---

### Task 1: Create the code-audit SKILL.md

**Files:**
- Create: `plugins/shipguard/skills/sg-code-audit/SKILL.md`

- [ ] **Step 1: Create the skill frontmatter + overview**

```markdown
---
name: code-audit
description: Parallel AI codebase audit — dispatches agents to find and fix bugs across the entire repo. Produces structured JSON results viewable in /sg-visual-review. Trigger on "code audit", "audit codebase", "find bugs", "code-audit", "audit code", "static audit", "security audit", "ship guard".
context: conversation
argument-hint: "[quick|standard|deep|paranoid] [--focus=path] [--report-only]"
---

# /sg-code-audit — Parallel Codebase Audit

Dispatch parallel AI agents to audit every file in your repo. Each agent reviews a non-overlapping zone, finds bugs, fixes them, and produces structured JSON. Results appear in the `/sg-visual-review` dashboard under a "Code Audit" tab.
```

- [ ] **Step 2: Write the invocation section**

Document all modes and flags:
- `/sg-code-audit` → standard (10 agents, 1 round)
- `/sg-code-audit quick` → 5 agents, surface
- `/sg-code-audit deep` → 15 agents, 2 rounds
- `/sg-code-audit paranoid` → 20 agents, 3 rounds
- `--focus=path/` → restrict scope
- `--report-only` → no fixes

- [ ] **Step 3: Write Phase 1 — Parse Arguments**

Parse the first positional arg as mode (quick/standard/deep/paranoid, default standard). Parse `--focus=` and `--report-only` flags. Set agent count and round count from mode:

```markdown
| Mode | Agents | Rounds |
|------|--------|--------|
| quick | 5 | 1 |
| standard | 10 | 1 |
| deep | 15 | 2 |
| paranoid | 20 | 3 |
```

- [ ] **Step 4: Write Phase 2 — Detect Stack**

Scan repo root. For each detection rule, check file existence with Glob:

```markdown
1. Glob `**/*.py` — if matches > 0 AND (Glob `**/requirements.txt` OR `**/pyproject.toml`): activate Python checklist
2. Glob `**/*.ts` OR `**/*.tsx` — if matches > 0 AND Glob `**/package.json`: activate TypeScript checklist
3. Glob `**/Dockerfile*` OR `**/docker-compose*`: activate Infra checklist
4. Glob `**/next.config.*`: activate Next.js checklist
5. Glob `**/*.go`: activate Go checklist
6. Glob `**/*.rs`: activate Rust checklist
7. Glob `**/*.java` OR `**/*.kt`: activate JVM checklist
8. Read CLAUDE.md if it exists at repo root — store contents for injection
```

- [ ] **Step 5: Write Phase 3 — Discover Zones**

Document the zone splitting algorithm:

```markdown
1. Use Bash: `find . -name '*.py' -o -name '*.ts' -o -name '*.tsx' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.kt' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn`
   This gives directory → file count.
   NOTE: `sort` without `-u` so `uniq -c` counts actual files per directory. With `-u`, every count would be 1.

2. Apply splitting rules:
   - dir with <= 30 files → 1 zone
   - dir with 31-80 files → split by subdirectories (re-run count on children)
   - dir with 80+ files → split by sub-subdirectories
   - Infra files (Dockerfile*, docker-compose*, *.yml in root or infra/) → 1 dedicated zone

3. Merge zones with < 5 files into their nearest neighbor

4. If zone count > agent count: merge smallest zones until count matches
   If zone count < agent count: split largest zones until count matches

5. Store final zones as an array: [{id: "z01", paths: ["src/routes/", "src/middleware/"], file_count: 28}, ...]
```

- [ ] **Step 6: Write Phase 4 — Build Prompts + Dispatch Agents**

Document the agent prompt template:

```markdown
For each zone, build a prompt:

"""
You are auditing a codebase. Your scope is ONLY: {zone.paths joined by AND}.

{IF CLAUDE.md exists}
Project rules (from CLAUDE.md):
{CLAUDE.md content, truncated to 3000 chars}
{END IF}

**Round {N} focus — {round_description}:**
{Round-specific checklist from references/checklists.md}

**Language-specific checks ({detected_languages}):**
{Activated checklists from references/checklists.md}

**Output format:**
Write your findings to a JSON file. The JSON must follow this exact schema:
{zone JSON schema from spec}

{IF fix mode}
Fix every bug you find using Edit. Commit all fixes with message: "audit-r{round}({zone_slug}): fix N bugs"
Set "fix_applied": true and "fix_commit": "{commit_hash}" for each fixed bug.
{ELSE}
Do NOT modify any files. Report only. Set "fix_applied": false for all bugs.
{END IF}

Working directory: {repo_root}
"""

Dispatch using Agent tool:
- isolation: worktree
- model: sonnet (fast, cost-effective for auditing)
- run_in_background: true

Track all agent IDs for collection.
```

- [ ] **Step 7: Write Phase 5 — Collect + Retry**

```markdown
As each agent completes (background notification):
1. Read the agent's result
2. If "Prompt is too long" → re-split the zone in half, relaunch 2 smaller agents
3. If successful → read the zone JSON from the worktree
4. Track completed vs pending

When all agents complete:
1. **Prerequisite:** Verify working tree is clean (`git status --porcelain` must be empty). If not, abort merge phase and warn user: "Uncommitted changes detected — commit or stash before merging audit fixes."
2. If fix mode: merge each worktree branch into main, one at a time:
   - `git merge {branch} --no-edit`
   - On conflict: **do NOT auto-resolve with `--theirs`**. Instead:
     a. Log conflicting files and which zone produced them
     b. Skip this branch's merge (`git merge --abort`)
     c. Continue merging other branches
     d. At the end, report all skipped merges to the user for manual resolution
3. Clean up worktrees and branches
```

- [ ] **Step 8: Write Phase 6 — Aggregate + Report**

```markdown
1. Read all zone JSON files
2. Merge into single audit-results.json:
   - Combine all bugs arrays
   - Compute summary (total, by_severity, by_category, files_audited, files_modified, duration)
   - Derive impacted_routes: for each bug, map file path to likely UI route using framework-specific detection:
     - **Next.js App Router:** `app/**/page.tsx` → route path (e.g., `app/dashboard/page.tsx` → `/dashboard`)
     - **Next.js Pages:** `pages/**/*.tsx` → route path
     - **React Router:** grep `<Route path=` in source, map component file → route
     - **Generic fallback:** extract directory name from bug file path, match against known route manifests
     - Do NOT hardcode project-specific paths — detection must be generic
3. Write audit-results.json to {results_dir}/
4. Print summary table to terminal
5. Suggest next steps:
   - "/sg-visual-run --from-audit" to visually verify impacted routes
   - "/sg-visual-review" to see the full dashboard
```

- [ ] **Step 9: Write the multi-round loop**

```markdown
If mode requires multiple rounds (deep=2, paranoid=3):
1. After round N completes and merges, start round N+1
2. Round N+1 agents receive a DIFFERENT prompt (R2 or R3 focus from checklists.md)
3. Round N+1 agents also receive: "A previous audit already fixed bugs. Verify those fixes are correct AND find deeper issues."
4. Results from all rounds are combined in the same audit-results.json
5. Bug IDs include round number: r1-z03-001, r2-z03-001, etc.
```

- [ ] **Step 10: Commit**

```bash
git add plugins/shipguard/skills/sg-code-audit/SKILL.md
git commit -m "feat: add /sg-code-audit skill — parallel codebase audit"
```

---

### Task 2: Create the language checklists reference

**Files:**
- Create: `plugins/shipguard/skills/sg-code-audit/references/checklists.md`

- [ ] **Step 1: Write round focus descriptions**

```markdown
## Round Focus Descriptions

### R1 — Surface (all modes)
Find known bug patterns. Think like a strict linter.
- Silent exceptions (except: pass, except without logging)
- Missing input validation
- Unguarded array/list indexing
- Dead code, unused imports
- Resource leaks (unclosed connections, missing cleanup)
- Type mismatches

### R2 — Depth (deep + paranoid)
Find runtime behavior bugs. Think like a senior reviewer doing integration testing.
- Race conditions, concurrent access without locks
- Cross-module integration: caller sends X, callee expects Y
- Auth/authorization gaps
- State management bugs
- Error propagation: errors swallowed or misreported
- SSR/hydration issues (web frameworks)

### R3 — Edge Cases (paranoid only)
Find what R1+R2 missed. Think like a security auditor + QA tester.
- Logic errors: wrong boolean, off-by-one, operator precedence
- Prompt injection, SQL injection, path traversal
- Null propagation chains (A calls B calls C, C returns null)
- Data corruption on partial failure
- Performance: O(n^2) loops, unbounded growth
- Accessibility gaps
```

- [ ] **Step 2: Write Python checklist**

```markdown
## Python Checklist

- `except Exception: pass` or `except: pass` — must log at minimum
- `except Exception:` that catches too broadly (catching SystemExit, KeyboardInterrupt)
- `list[0]` / `dict["key"]` on data from external sources without length/existence check
- Direct filesystem access (open(), Path()) where storage abstraction should be used
- `asyncio.get_event_loop()` (deprecated) instead of `get_running_loop()`
- Blocking calls (subprocess.run, time.sleep, synchronous I/O) inside async functions
- Threading: shared mutable state without locks
- Missing `async with` / `async for` on async context managers/iterators
- f-strings in logger calls (eager formatting even when log level disabled)
- Response model class defined after the route that uses it (FastAPI NameError)
```

- [ ] **Step 3: Write TypeScript/React checklist**

```markdown
## TypeScript/React Checklist

- Zustand selector `|| []` or `|| {}` (creates new reference each call → infinite re-renders)
- API response used as array without null check + Array.isArray guard
- `structuredClone` on state containing functions
- useEffect missing cleanup (intervals, event listeners, AbortController)
- useCallback/useMemo missing dependencies (stale closures)
- `as any` type assertions hiding real type errors
- `key={index}` on lists that can reorder
- Direct `window`/`document`/`localStorage` access without SSR guard
- Context providers with inline object values (new reference each render)
- Feature flags using dynamic env var access (must be static in Next.js)
```

- [ ] **Step 4: Write Infra checklist**

```markdown
## Infrastructure Checklist

- Missing `depends_on` between services that need startup ordering
- Missing healthchecks or wrong healthcheck configuration
- Missing memory/CPU limits (OOM kill risk)
- Secrets without `:?` fail-fast guard (silently empty on missing env var)
- Ports in code that don't match docker-compose port mappings
- Env vars referenced in code but not set in compose
- Container running as root without `security_opt: no-new-privileges`
- Missing log rotation (unbounded JSON logs fill disk)
- Hardcoded localhost URLs that break inside Docker networking
- Volume mounts pointing to non-existent paths
```

- [ ] **Step 5: Write Next.js checklist**

```markdown
## Next.js Checklist

- Server Component importing client-only module (useState, useEffect, browser APIs)
- Client Component without `"use client"` directive at file top
- `cookies()` / `headers()` called in a cached or static page (dynamic rendering required)
- `searchParams` accessed synchronously in a Server Component (must be awaited in Next.js 15+)
- Middleware that doesn't return `NextResponse.next()` on non-matching paths (blocks all routes)
- `revalidatePath`/`revalidateTag` called from client code (server action or route handler only)
- Dynamic `process.env[varName]` for `NEXT_PUBLIC_*` vars (must be static string for dead-code elimination)
- Missing `loading.tsx` or `Suspense` boundary on slow Server Components (blocks entire page)
- `fetch()` in Server Component without explicit `cache`/`revalidate` option (defaults vary by Next.js version)
- Image `<img>` tag instead of `next/image` (missing optimization + CLS)
```

- [ ] **Step 6: Write Go, Rust, JVM checklists**

```markdown
## Go Checklist

- Unchecked error return: `val, _ := fn()` or `fn()` without checking error
- Goroutine leak: goroutine started without cancellation context
- Nil pointer dereference on interface values
- defer in loop (resource held until function returns, not loop iteration)
- Race condition: shared state without mutex or channel

## Rust Checklist

- `.unwrap()` on Result/Option in library code (should propagate with ?)
- `unsafe` blocks without safety comment explaining invariants
- `.clone()` on large data where borrow would suffice
- Missing error context (use `.context()` or `.map_err()`)
- Deadlock: multiple mutex locks acquired in inconsistent order

## JVM Checklist

- Null passed where non-null expected (missing @Nullable annotation)
- Resource not closed (Closeable without try-with-resources)
- Mutable shared state without synchronization
- Catching Exception/Throwable too broadly
- Hardcoded credentials or connection strings
```

- [ ] **Step 7: Commit**

```bash
git add plugins/shipguard/skills/sg-code-audit/references/checklists.md
git commit -m "feat: add language-specific audit checklists for /sg-code-audit"
```

---

### Task 3: Add Code Audit tab to visual-review build script

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-review/build-review.mjs`

- [ ] **Step 1: Add audit-results.json detection**

After the existing screenshot/manifest loading, add code to:
1. Check if `audit-results.json` exists in the results directory
2. If yes, parse it and log the bug count
3. Store the parsed data for injection into the HTML template

- [ ] **Step 2: Inject audit data into the HTML template**

Add audit data to the existing data object that gets injected via `__PLACEHOLDER_VISUAL_DATA__`. The build already does:
```js
const html = template.replace('"__PLACEHOLDER_VISUAL_DATA__"', JSON.stringify(data));
```
Add an `audit` field to the `data` object (set to `null` if no audit-results.json exists). The template will access it as `D.audit`. Do NOT create a separate placeholder — reuse the existing injection mechanism.

- [ ] **Step 3: Commit**

```bash
git add plugins/shipguard/skills/sg-visual-review/build-review.mjs
git commit -m "feat: build-review reads audit-results.json for Code Audit tab"
```

---

### Task 4: Add Code Audit tab to HTML review template

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-review/_review-template.html`

> **SCOPE WARNING:** The template is a complex single-page app (~430 lines of JS) with its own sidebar, grid, lightbox, annotations, canvas drawing, session persistence, and action bar. Adding tabs requires wrapping the existing visual-tests UI and the new audit UI in switchable panels. This is NOT an append-only change — it touches the layout structure, filter system, and stats rendering. Read the full template before making changes.

- [ ] **Step 1: Add tab system to the header**

In `#header`, after `.header-stats`, add tab buttons: "Visual Tests" (active by default) | "Code Audit" (hidden if `D.audit === null`). Tab switching must:
- Toggle visibility of `#layout` (existing visual tests: sidebar + grid) vs `#audit-layout` (new audit panel)
- Toggle visibility of `#toolbar` (visual tests filters) vs `#audit-toolbar` (audit filters)
- Update `#stats` to show the active tab's stats
- Keep the action bar (`#action-bar`) visible only on the Visual Tests tab

- [ ] **Step 2: Add the audit panel HTML structure**

Add new elements AFTER the existing `#layout` div (not inside it):
- `#audit-toolbar` — severity buttons, category buttons, search input, export CSV button
- `#audit-layout` — a `<main id="audit-grid">` for bug cards (no sidebar needed — filters are inline)
- Both hidden by default (`style="display:none"`)

- [ ] **Step 3: Add audit card CSS**

Style the bug cards with:
- Left border color by severity (critical=red, high=orange, medium=yellow, low=gray)
- Same dark 3D card style as screenshot cards
- Fixed/Unfixed badges
- Category badges
- Expandable description on click
- Hover transform effect

- [ ] **Step 4: Add JavaScript for audit tab**

The existing template uses `createElement` + `textContent` for safe DOM construction (no `innerHTML`, no `esc()` helper). Follow the same pattern.

Implement:
- `switchTab(tab)` — toggle display of visual vs audit panels, update stats
- `renderAuditStats()` — display summary badges (total bugs, by severity, fixed count)
- `renderAuditFilters()` — build severity + category filter buttons dynamically
- `filterAuditSeverity(sev)` / `filterAuditCategory(cat)` — filter state
- `applyAuditFilters()` — filter bugs by severity + category + search text, re-render grid
- `renderAuditGrid(bugs)` — render bug cards using `createElement`/`textContent` (NOT string interpolation)
- `exportAuditCSV()` — generate and download CSV blob
- Init: if `D.audit` exists, call `renderAuditStats()` and show the tab button; else hide tab completely

**Non-regression requirement:** When `D.audit === null` (no audit was run), the page MUST behave exactly as before — no tab buttons, no extra UI, identical visual tests experience.

- [ ] **Step 5: Commit**

```bash
git add plugins/shipguard/skills/sg-visual-review/_review-template.html
git commit -m "feat: add Code Audit tab to visual-review page"
```

---

### Task 5: Add `--from-audit` flag to visual-run

**Files:**
- Modify: `plugins/shipguard/skills/sg-visual-run/SKILL.md`

- [ ] **Step 1: Add the `--from-audit` invocation**

In the invocations table, add:

```markdown
| `/sg-visual-run --from-audit` | Read `audit-results.json`, extract `impacted_routes`, find matching test manifests, run only those |
```

- [ ] **Step 2: Document the from-audit flow**

```markdown
### From-Audit Mode

When `--from-audit` is passed:

1. Read `{results_dir}/audit-results.json` (canonical location: same directory as screenshots and manifests)
2. Extract `impacted_routes` array
3. For each route, find matching YAML manifests by URL path (glob `visual-tests/**/*.yaml`, match `url` field)
4. If no manifest matches a route, log it as "uncovered route" (do NOT auto-generate — the user can run `/sg-visual-discover` separately to create manifests for new routes)
5. Run matched manifests (highest severity routes first)
6. Report: which routes were visually verified, which had no manifest (uncovered), and which code-audit findings were visually confirmed vs not reproduced
```

- [ ] **Step 3: Commit**

```bash
git add plugins/shipguard/skills/sg-visual-run/SKILL.md
git commit -m "feat: add --from-audit flag to /sg-visual-run for code→visual handoff"
```

---

### Task 6: Update plugin metadata and README

**Files:**
- Modify: `plugins/shipguard/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugins/shipguard/README.md`

> **Rebrand note (2026-04-10):** Repo renamed to `bacoco/shipguard`. Plugin dir is `plugins/shipguard/`. All skills prefixed with `sg-`.

- [ ] **Step 1: Update plugin.json**

```json
{
  "name": "shipguard",
  "description": "ShipGuard — AI-powered code audit + visual E2E testing. Audit the code first, verify visually second. Zero tests written.",
  "version": "2.0.0",
  "author": {
    "name": "ShipGuard contributors"
  }
}
```

- [ ] **Step 2: Update README.md**

- Change title to "ShipGuard"
- Add subtitle: "Formerly Agentic Visual Debugger"
- Add the code-audit section. Document the full ShipGuard flow:

```
/sg-code-audit                    # Find bugs in code
/sg-visual-run --from-audit       # Verify impacted routes visually
/sg-visual-review                 # See everything in one dashboard
```

Add the modes table (quick/standard/deep/paranoid).
- Install instructions use the repo name `bacoco/shipguard`

- [ ] **Step 3: Update marketplace.json**

```json
{
  "name": "shipguard",
  "description": "AI-powered code audit + visual E2E testing. Zero tests written."
}
```

- [ ] **Step 4: Commit**

```bash
git add plugins/shipguard/.claude-plugin/plugin.json plugins/shipguard/README.md .claude-plugin/marketplace.json
git commit -m "feat: rebrand to ShipGuard v2.0.0 + update README with /sg-code-audit"
```

---

### Task 7: End-to-end verification

**Files:**
- No files created — manual verification

- [ ] **Step 1: Non-regression — /sg-visual-review WITHOUT audit data**

**Critical:** Before testing audit features, verify the existing visual-review still works perfectly without any `audit-results.json`:
1. Delete or rename any existing `audit-results.json` in results dir
2. Run `/sg-visual-review`
3. Verify: no tab buttons, no audit UI, identical behavior to before this work
4. Screenshot grid, lightbox, annotations, filters, sidebar, action bar all work unchanged

- [ ] **Step 2: Run /sg-code-audit quick on a small test project**

Find or create a small repo with known bugs (e.g., a Python file with `except: pass` and a TS file with `|| []`). Run `/sg-code-audit quick` and verify:
- Stack detection identifies Python + TypeScript + Next.js (if applicable)
- Zones are created correctly (file counts > 1 per directory)
- Agents dispatch and complete
- JSON output matches schema
- Bugs are found and fixed
- Working tree check blocks merge if uncommitted changes exist

- [ ] **Step 3: Run /sg-visual-review WITH audit data and verify Code Audit tab**

After audit completes, run `/sg-visual-review` and check:
- Tab buttons appear (Visual Tests + Code Audit)
- Default tab is Visual Tests — existing UI unchanged
- Switching to Code Audit shows bug cards
- Filters work (severity, category)
- Search works
- Cards display correctly (severity colors, badges, expandable)
- CSV export works
- Switching back to Visual Tests — all state preserved

- [ ] **Step 4: Run /sg-visual-run --from-audit**

Verify that impacted routes from the audit are used to scope visual tests. Check that uncovered routes (no matching manifest) are logged but don't block execution.

- [ ] **Step 5: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end testing"
```

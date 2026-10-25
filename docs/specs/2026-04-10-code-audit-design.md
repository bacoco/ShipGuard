> **Statut : historique, achèvement non vérifié point par point.**

# ShipGuard `/sg-code-audit` — Design Spec

**Date:** 2026-04-10
**Status:** Approved
**Repo:** bacoco/shipguard (rename from agentic-visual-debugger)

## Overview

A new skill for ShipGuard that performs automated static code audits using parallel AI agents. Each agent reviews a non-overlapping zone of the codebase, finds bugs, fixes them, and produces structured JSON results. The results integrate into the existing `visual-review` dashboard as a new "Code Audit" tab.

**Tagline:** You push code. You don't know what you broke. ShipGuard does. Visual testing + static code audit. Zero tests written.

## Product Sequence

ShipGuard is a single product with a two-stage audit flow:

```
Code changes
     │
     ▼
Code Audit (/sg-code-audit)
     │
     ▼
Findings + impacted routes
     │
     ▼
Visual Audit (/sg-visual-run, scoped by code audit findings)
     │
     ▼
Unified Review (/sg-visual-review — Code Audit tab + Screenshots tab)
     │
     ▼
Human decides what matters
```

**Code audit narrows the field. Visual audit confirms reality. Human review decides what matters.**

The code audit output includes a list of impacted routes and workflows. This list can feed directly into `/sg-visual-run` to scope the visual audit to the areas most likely broken — instead of running a blind full-suite screenshot pass.

### Handoff: code-audit → visual-run

The `audit-results.json` includes an `impacted_routes` field derived from bug locations:

```json
{
  "impacted_routes": [
    {"route": "/dashboard", "reason": "Zustand store bug in dashboard-store.ts", "severity": "high"},
    {"route": "/dossier/:id", "reason": "Race condition in dossier-detail hooks", "severity": "critical"},
    {"route": "/settings", "reason": "Missing auth guard on admin page", "severity": "critical"}
  ]
}
```

`/sg-visual-run` can consume this: `/sg-visual-run --from-audit` reads the impacted routes and runs only the matching visual tests. This keeps the visual audit focused on what the code audit flagged, rather than testing everything blindly.

## Invocation

```
/sg-code-audit              → standard (10 agents, 1 round)
/sg-code-audit quick        → 5 agents, surface scan
/sg-code-audit deep         → 15 agents, 2 rounds
/sg-code-audit paranoid     → 20 agents, 3 rounds
/sg-code-audit --focus=src/ → restrict scope to a directory
/sg-code-audit --report-only → find bugs but don't fix them
```

## Architecture

### Approach: Single skill + review integration

- `/sg-code-audit` — does everything (discover zones, dispatch agents, collect results, merge)
- The HTML review is a tab added to the existing `visual-review` page (reads `audit-results.json`)
- No separate discover or review skill — zone discovery is an implementation detail, review is handled by the existing visual-review infrastructure

### Why this approach

- Zone discovery has no standalone value (unlike visual-discover which produces reusable YAML manifests)
- The review page already exists with server, dark theme, filtering, annotations — extending it is cheaper than building a second one
- One command does everything — consistent with the plugin philosophy

## Stack Detection

The skill scans the repo root and activates language-specific checklists:

| Detection | Checklist |
|-----------|-----------|
| `*.py` + `requirements.txt`/`pyproject.toml` | Python: silent exceptions, unsafe indexing, missing async/await, resource leaks, threading safety |
| `*.ts`/`*.tsx` + `package.json` | TypeScript/React: Zustand selectors, API guards, SSR hydration, useEffect cleanup, dependency arrays |
| `Dockerfile`/`docker-compose*` | Infra: ports, env vars, healthchecks, depends_on, memory limits, secrets guards |
| `next.config.*` | Next.js: rewrites vs routes, feature flags, Suspense boundaries |
| `*.go` | Go: unchecked errors, goroutine leaks, nil pointer, defer in loops |
| `*.rs` | Rust: unwrap() on Result, unsafe blocks, lifetime issues |
| `*.java`/`*.kt` | JVM: null safety, resource closeable, thread safety |

Only detected checklists are sent to agents. A pure Python repo gets no TypeScript rules.

If `CLAUDE.md` exists at repo root, its rules are injected into every agent prompt. This allows project-specific patterns (e.g., "always use StorageFactory, never direct filesystem access") to be enforced without modifying the skill.

## Zone Discovery Algorithm

```
1. List all directories containing source files
2. Count files per directory
3. Apply rules:
   - Directory with <= 30 files → 1 zone
   - Directory with 31-80 files → split by subdirectories
   - Directory with 80+ files → split by sub-subdirectories
   - Infra (Docker, CI, root configs) → always 1 dedicated zone
4. Merge small adjacent zones (< 5 files) to avoid waste
5. Cap to the requested agent count:
   - More zones than agents → merge smallest zones
   - Fewer zones than agents → split largest zones
```

### Example: Monorepo

```
Zone 1: apps/frontend/src/components/
Zone 2: apps/frontend/src/hooks/ + stores/
Zone 3: apps/backend/routes/
Zone 4: apps/backend/services/
Zone 5: infra/
```

### Example: Single app

```
Zone 1: src/routes/
Zone 2: src/models/ + services/
Zone 3: src/utils/ + tests/
Zone 4: config + infra
```

No project-specific names are hardcoded. Everything is discovered dynamically.

## Multi-Round Strategy

Each round has a different focus (learned from real-world testing on a 330-file monorepo):

| Round | Focus | What it finds |
|-------|-------|---------------|
| R1 — Surface | Known patterns, lint-like | Silent exceptions, missing guards, dead code, type mismatches, missing cleanup |
| R2 — Depth | Runtime behavior | Race conditions, cross-service integration, auth gaps, resource leaks, SSR issues |
| R3 — Edge cases | What R1+R2 missed | Logic errors, prompt injection, data corruption, null propagation, off-by-one, performance |

Mode mapping:
- `quick` → R1 only
- `standard` → R1 only
- `deep` → R1 + R2
- `paranoid` → R1 + R2 + R3

## Agent Prompt Structure

Each agent receives:

1. **Language checklists** — the detected bug patterns for its zone's languages
2. **CLAUDE.md rules** — project-specific rules (if file exists)
3. **Round focus** — what this round specifically looks for
4. **Scope** — exact files/directories to audit (nothing else)
5. **JSON output format** — the exact schema to produce
6. **Fix mode** — whether to fix bugs or just report them

## Fix Behavior

- **Default:** agents fix every bug found and commit in their worktree
- **`--report-only`:** agents only report, no edits
- All fixes are in isolated git worktrees — easy to revert with `git reset`
- After all agents complete, worktrees are merged into the working branch
- Merge conflicts on non-overlapping zones: abort the merge (`git merge --abort`), log the conflict, and preserve the branch for manual resolution.
- Unresolvable conflicts are logged for user attention

## JSON Output Format

### Per-zone output (`zone-{zone_id}-r{round}.json` flat in results_dir)

```json
{
  "zone": "src/routes/",
  "round": 1,
  "files_audited": 23,
  "duration_ms": 245000,
  "bugs": [
    {
      "id": "r1-z03-001",
      "severity": "critical",
      "category": "security",
      "subcategory": "auth-bypass",
      "file": "src/routes/documents.py",
      "line": 119,
      "title": "Missing ownership check",
      "description": "Any authenticated user can access any document",
      "fix_applied": true,
      "fix_commit": "abc1234"
    }
  ]
}
```

### Aggregated output (`audit-results.json`)

```json
{
  "repo": "my-project",
  "timestamp": "2026-04-10T08:30:00Z",
  "mode": "standard",
  "rounds": 1,
  "agents": 10,
  "summary": {
    "total_bugs": 47,
    "by_severity": {"critical": 3, "high": 12, "medium": 22, "low": 10},
    "by_category": {"security": 5, "race-condition": 8, "silent-exception": 12, "api-guard": 6, "infra": 4, "other": 12},
    "files_audited": 187,
    "files_modified": 34,
    "duration_ms": 612000
  },
  "impacted_routes": [
    {"route": "/dashboard", "reason": "Zustand store bug in dashboard-store.ts", "severity": "high"},
    {"route": "/dossier/:id", "reason": "Race condition in dossier-detail hooks", "severity": "critical"}
  ],
  "bugs": [...]
}
```

### Severity definitions

| Severity | When to use |
|----------|-------------|
| `critical` | Security bypass, data loss, crash on common path |
| `high` | Wrong behavior, race condition, resource leak on common path |
| `medium` | Edge case crash, missing validation, incorrect error handling |
| `low` | Dead code, style, minor performance, missing accessibility |

### Category taxonomy

`security`, `race-condition`, `silent-exception`, `api-guard`, `resource-leak`, `type-mismatch`, `dead-code`, `infra`, `ssr-hydration`, `input-validation`, `error-handling`, `performance`, `accessibility`, `logic-error`, `other`

## Visual Review Integration

The existing `visual-review` page detects `audit-results.json` in the results directory. If present, it adds a **"Code Audit"** tab alongside the screenshots tab.

### Tab layout

- **Header:** badge totals by severity (red/orange/yellow/gray)
- **Filters:** severity, category, zone/service, fix status (applied/not)
- **Search:** full-text on title + description + file path
- **Grid:** one card per bug, same dark 3D style as screenshot cards
  - Border color = severity
  - Title + file:line
  - Description (truncated, expand on click)
  - "Fixed" green badge or "Unfixed" red badge
  - Copy file path button
- **Export:** CSV and JSON download buttons

## Complete Workflow

```
1. PARSE ARGUMENTS
   → mode (quick/standard/deep/paranoid), --focus, --report-only

2. DETECT STACK
   → scan repo root, identify languages + frameworks
   → load CLAUDE.md rules if present
   → select checklists per language

3. DISCOVER ZONES
   → count files per directory
   → split/merge to match agent count for mode
   → assign non-overlapping file scopes

4. FOR EACH ROUND (1 to N based on mode):

   4a. BUILD PROMPTS
       → per-zone prompt = checklist + CLAUDE.md rules + round focus + scope + JSON format

   4b. DISPATCH AGENTS
       → Agent tool x N, isolation: worktree, run_in_background: true
       → each writes zone-{N}.json to results dir

   4c. WAIT + COLLECT
       → as agents complete, read their JSON output
       → re-split and relaunch if context overflow (auto-retry with smaller scope)

   4d. MERGE WORKTREES (if fix mode)
       → merge each branch into main
       → resolve conflicts (accept theirs for non-overlapping zones)
       → log unresolvable conflicts for user attention

5. AGGREGATE
   → merge all zone JSONs into audit-results.json
   → compute summary stats
   → derive impacted_routes from bug file paths

6. REPORT
   → print summary table to terminal
   → if visual-review results dir exists: copy audit-results.json there
   → suggest "/sg-visual-run --from-audit" to verify impacted routes visually
   → suggest "/sg-visual-review" to see the full dashboard
```

## Repo Rename

The GitHub repo has been renamed from `bacoco/agentic-visual-debugger` to `bacoco/shipguard`.

- Plugin name: `shipguard`
- Install: `claude plugin add bacoco/shipguard`
- All skills use the `sg-` prefix: `sg-code-audit`, `sg-visual-run`, `sg-visual-review`, `sg-visual-discover`, `sg-visual-fix`, `sg-visual-review-stop`.
- GitHub handles redirects from the old URL automatically

## Proven Patterns

This design incorporates lessons from anonymized audit exercises. Key lessons incorporated:

- 10 agents is the sweet spot (fewer context overflows than 20, 30% less tokens)
- Auto-retry with smaller scope when context overflows (happened ~30% of the time with large zones)
- CLAUDE.md injection is critical — project-specific rules catch 40%+ of bugs
- Multi-round deepening works: R1 finds patterns, R2 finds behavior, R3 finds edge cases
- Structured JSON output enables the review UI and cross-round comparison

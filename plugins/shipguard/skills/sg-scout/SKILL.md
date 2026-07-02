---
name: sg-scout
description: Use when looking for techniques to improve ShipGuard itself — researches GitHub and similar tools and files scored proposals from the ShipGuard checkout.
context: conversation
argument-hint: "[url] [--topic=eval|self-improving|audit|visual] [--dry-run] [--offline --from <repos.json>]"
---

# /sg-scout — GitHub Intelligence for ShipGuard

Scan the GitHub ecosystem for techniques that could make ShipGuard better. Parse repos, score relevance, extract actionable ideas, and file them as issues — or seed the techniques library for future reference.

Think of it as a research assistant that reads other people's code so you don't have to, then brings back only what's worth stealing.

> **Recommended model:** a fast, capable model. Web search + repo scanning + summary writing is mechanical research work where a top-tier reasoning model provides no measurable quality gain. Prefer a faster model (e.g. `/model sonnet`) before invoking to conserve premium quota.

## Preconditions

**The publish phases require the ShipGuard repo checkout.** Writing `docs/scout-reports/`, updating the techniques library, and filing GitHub issues only make sense inside the ShipGuard repository itself. Verify:

```bash
git remote -v | grep -q "bacoco/ShipGuard"   # or the detected ShipGuard origin
```

Anywhere else — the installed plugin cache, a host project — automatically behave as `--dry-run`: write the preview to `visual-tests/_results/scout-report.md` only, and tell the user why ("not running from the ShipGuard checkout, publishing skipped"). This check is applied at the start of Phase 5.

The research phases (1–4) can run from anywhere that has network access and an authenticated `gh` CLI.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-scout` | Full scan — search GitHub, analyze top repos, publish findings |
| `/sg-scout <url>` | Deep-dive on one specific repo |
| `/sg-scout --topic=eval` | Focus: evaluation, benchmarking, scoring techniques |
| `/sg-scout --topic=self-improving` | Focus: auto-optimization, mutation, feedback loops |
| `/sg-scout --topic=audit` | Focus: code review, static analysis, bug detection |
| `/sg-scout --topic=visual` | Focus: visual regression, screenshot testing, UI automation |
| `/sg-scout --dry-run` | Produce a local preview report; never writes the techniques library, never creates issues |
| `/sg-scout --offline --from "$SHIPGUARD_PLUGIN_ROOT/skills/sg-scout/fixtures/scout-repos.json"` | Analyze a local repo fixture; no GitHub search or network, no issues |

> SHIPGUARD_PLUGIN_ROOT = the plugin root directory, resolved as two levels up from this skill's SKILL.md (or `$CLAUDE_PLUGIN_ROOT` when the harness sets it).

Sandbox note: GitHub search and issue creation need network/auth. Use `--dry-run` or `--offline` when network is blocked. See [../../docs/sandbox.md](../../docs/sandbox.md).

---

## Phase 1 — Search

### Single-URL Mode

If a URL is provided (`/sg-scout https://github.com/owner/repo`), skip the search phase. Go directly to Phase 2 with that repo.

### Offline Mode

If `--offline` is present, skip GitHub entirely. Read repos from the JSON file passed by `--from`; if omitted, use `$SHIPGUARD_PLUGIN_ROOT/skills/sg-scout/fixtures/scout-repos.json` when present. Expected shape:

```json
{
  "repos": [
    {
      "full_name": "owner/repo",
      "url": "https://github.com/owner/repo",
      "readme": "README text or path to local fixture",
      "files": [
        {"path": "SKILL.md", "content": "file text or path to local fixture"}
      ]
    }
  ]
}
```

`readme` and `files[].content` are dual-typed. A value is treated as a **path** if and only if it starts with `./` or `/` **and** that file exists; otherwise it is **literal text**.

If the fixture is missing or invalid, write `visual-tests/_results/scout-report.md` with the error and stop cleanly. Do not create issues. `--offline` never creates GitHub issues; the techniques library is only updated by a full online run from the ShipGuard checkout (see Phase 5).

Deterministic fixture smoke test:

```bash
node "$SHIPGUARD_PLUGIN_ROOT/skills/sg-scout/offline-dry-run-smoke-test.mjs"
node "$SHIPGUARD_PLUGIN_ROOT/skills/sg-scout/offline-dry-run-smoke-test.mjs" --from "$SHIPGUARD_PLUGIN_ROOT/skills/sg-scout/fixtures/scout-repos.json"
```

The smoke test validates the fixture shape (`repos[].{full_name,url,readme,files[].{path,content}}`), writes a temporary `visual-tests/_results/scout-report.md` inside an isolated temp directory, asserts the report reflects the fixture's repo names and counts, and removes its temporary directory on success (the fixture file is never touched); `--keep-tmp` or `--debug` keeps it for inspection.

### Full Scan Mode

Search GitHub for repos relevant to ShipGuard's domains. The per-topic query bank and the list of known valuable seed repos (always included in a full scan when not already in results) live in a versioned source file:

```text
$SHIPGUARD_PLUGIN_ROOT/skills/sg-scout/fixtures/scout-sources.json
```

Load it, pick the queries for `--topic` (or all topics if none — run 4-6 queries total), and run each via `gh api`:

```bash
gh api search/repositories -X GET \
  -f q='"claude skill" code audit' \
  -f sort=stars -f per_page=10
```

Scout runs may themselves propose updates to `scout-sources.json` (new queries, new seed repos, removals) through the normal proposal flow — score the change and file it like any other technique proposal.

**Filters** (applied after search):
- Keep repos with: stars ≥ 3 OR pushed within last 90 days
- Skip: forks (unless stars > parent), archived repos, repos with no README
- Deduplicate by repo full_name

**Cap:** 20 repos maximum per run. If more found, sort by stars descending and take top 20.

Store the repo list:
```yaml
repos:
  - full_name: "owner/repo"
    stars: 42
    pushed_at: "2026-04-10"
    description: "..."
    query_matched: "claude skill code audit"
```

If GitHub or network access fails, do not stop with an opaque error. Write a local report to `visual-tests/_results/scout-report.md` containing the failing command, error summary, topic, and any partial repos already collected. Suggest rerunning with `--offline --from "$SHIPGUARD_PLUGIN_ROOT/skills/sg-scout/fixtures/scout-repos.json"`.

---

## Phase 2 — Parse & Extract

For each repo, read up to 3 key files to understand its approach.

### Step 1: Read README

```bash
gh api repos/{owner}/{repo}/readme --jq '.content' | base64 -d
```

If README > 5000 chars, truncate to first 5000 (enough for overview + install + usage).

### Step 2: Find skill/agent definitions

Search the repo tree for relevant files:
```bash
gh api repos/{owner}/{repo}/git/trees/HEAD?recursive=1 --jq '.tree[].path' | grep -iE '(SKILL|agent|prompt|audit|eval).*\.(md|yaml|py|ts)$' | head -10
```

Read the top 2 most relevant files (prioritize: SKILL.md > agents/ > prompts/ > scripts/).

### Step 3: Extract structured data

For each repo, produce:
```yaml
repo: "owner/repo"
purpose: "one-line summary of what it does"
techniques:
  - name: "Technique name"
    description: "What it does and how"
    category: "evaluation | mutation | parallelism | scoring | infrastructure | other"
    code_example: "optional short snippet or reference"
architecture: "brief description of how components connect"
dependencies: "what tools/models/APIs it requires"
```

---

## Phase 3 — Score & Evaluate

For each technique extracted, score on 4 axes (1-5 scale):

| Axis | Weight | Question |
|------|--------|----------|
| **Impact** | ×2.0 | How much would this improve ShipGuard's audit quality, speed, or UX? |
| **Novelty** | ×1.5 | Does ShipGuard already do this? (5=completely new, 1=already implemented) |
| **Applicability** | ×1.0 | Can this plug into an existing ShipGuard skill? (see the **Affected skill** list in Phase 4) |
| **Effort** | ×0.5 | How easy to implement? (5=trivial, 1=major rewrite) |

**Composite score** = (Impact×2 + Novelty×1.5 + Applicability×1 + Effort×0.5) / 5

**Thresholds:**
- Score ≥ 4.0 → **Must implement** — file as high-priority issue
- Score 3.0–3.9 → **Should implement** — file as enhancement issue
- Score 2.0–2.9 → **Nice to have** — add to techniques library only
- Score < 2.0 → **Skip** — not relevant enough

### Scoring Guidelines

Be honest about novelty. ShipGuard already has:
- Parallel agent dispatch with worktree isolation
- Multi-round audits (R1/R2/R3)
- Zone-based file partitioning
- JSON output schema validation (basic)
- Learnings feedback loop (sg-improve)
- Regression tracking (visual-run)

Don't score high on novelty for techniques ShipGuard already does. Score high for genuinely new approaches — especially around statistical evaluation, mutation-based optimization, and cross-run learning.

---

## Phase 4 — Synthesize

Group findings by theme. For each theme with ≥1 technique scoring ≥ 3.0:

### Proposal format

```markdown
### {Theme}: {Title}

**Source:** [{repo}]({url}) — {technique name}
**Score:** {composite}/5.0 (Impact: {i}, Novelty: {n}, Applicability: {a}, Effort: {e})

**What they do:**
{2-3 sentences describing the technique}

**What ShipGuard should do:**
{Concrete adaptation — which skill to modify, what to add/change}

**Example:**
{Code snippet, prompt fragment, or architecture diagram showing the change}

**Affected skill:** `sg-code-audit` | `sg-improve` | `sg-visual-run` | `sg-visual-review` | `sg-visual-fix` | `sg-visual-discover` | `sg-record` | `sg-process-check` | `sg-ship` | `sg-change-report` | `sg-scout` | `(multi)`
**Mutation type:** `add_example` | `add_constraint` | `restructure` | `add_edge_case`
```

The `mutation type` classifies what kind of change this would be (inspired by the Executor/Analyst/Mutator pattern). This helps `sg-improve` prioritize: `add_constraint` and `add_edge_case` are usually safe; `restructure` needs more testing.

---

## Phase 5 — Publish

**Checkout gate (run this first).** Publishing requires the ShipGuard repo checkout (see Preconditions):

```bash
git remote -v | grep -q "bacoco/ShipGuard"   # or the detected ShipGuard origin
```

If the check fails, downgrade the run to `--dry-run` behavior: write the preview to `visual-tests/_results/scout-report.md`, skip the techniques library, the dated scout report, and GitHub issues, and state why ("not running from the ShipGuard checkout").

Publish matrix:

| Mode | Preview (`visual-tests/_results/scout-report.md`) | Dated scout report | Techniques library | GitHub issues |
|------|---|---|---|---|
| Full online run from the ShipGuard checkout | — | yes | yes | yes (score ≥ 3.0) |
| `--offline` (from the ShipGuard checkout) | yes | yes | no | never |
| `--dry-run` | yes | never | never | never |
| Any run outside the ShipGuard checkout | yes (forced dry-run) | no | no | no |

### Techniques Library (full online runs from the ShipGuard checkout only)

Append to `docs/scout-reports/techniques-library.md`:

```markdown
## {Technique Name}
- **Source:** [{repo}]({url})
- **Score:** {composite}/5.0
- **Category:** {category}
- **Status:** `proposed` | `implementing` | `implemented` | `rejected`
- **ShipGuard skill:** {which skill it improves}
- **Date scouted:** {date}

{Description + adaptation proposal}
```

Before appending, dedup mechanically:

```bash
grep -in "{repo_full_name}" docs/scout-reports/techniques-library.md \
  || grep -in "{technique_name}" docs/scout-reports/techniques-library.md
```

If either grep matches, update the existing entry in place (refresh score, status, date) instead of appending a duplicate.

### Scout Report (per run)

Write to `docs/scout-reports/{YYYY-MM-DD}-scout.md`:

```markdown
# Scout Report — {date}

**Repos scanned:** {count}
**Techniques found:** {count}
**Proposals filed:** {count} (score ≥ 3.0)

## Top Findings

{Top 5 techniques by composite score, in proposal format}

## All Techniques

| # | Technique | Source | Score | Category | Status |
|---|-----------|--------|-------|----------|--------|

## Repos Analyzed

| Repo | Stars | Techniques | Top Score |
|------|-------|------------|-----------|
```

### GitHub Issues (score ≥ 3.0; full online runs from the ShipGuard checkout only — never under `--dry-run` or `--offline`)

For each proposal with score ≥ 3.0:

1. **Deduplicate:** `gh issue list --repo bacoco/ShipGuard --state open --limit 30 --json title,body` — check for keyword overlap
2. **If match found:** comment on existing issue with the new data point
3. **If no match:** create new issue:

```bash
gh issue create --repo bacoco/ShipGuard \
  --title "Scout: {technique name} (from {repo})" \
  --label "enhancement" \
  --body "{proposal in markdown format}"
```

### Dry Run (--dry-run)

Print all proposals to terminal and write `visual-tests/_results/scout-report.md`. `--dry-run` never writes `docs/scout-reports/` (neither the techniques library nor the dated report) and never creates or comments on GitHub issues. End with: "Run without --dry-run to publish these findings."

---

## Output

```
/sg-scout complete:
  Repos scanned: {N}
  Techniques found: {T}
  Proposals filed: {P} issues on bacoco/ShipGuard (full online run from the ShipGuard checkout only)
  Library updated: docs/scout-reports/techniques-library.md ({L} entries) (full online run only)
  Report: docs/scout-reports/{date}-scout.md
  Preview: visual-tests/_results/scout-report.md (dry-run / offline / network failure / outside the ShipGuard checkout)

  Top 3 findings:
  1. {technique} (score {s}/5) — {one-line summary}
  2. {technique} (score {s}/5) — {one-line summary}
  3. {technique} (score {s}/5) — {one-line summary}
```

---

## Edge Cases

### GitHub API rate limit
GitHub **search** endpoints (`gh api search/repositories`) are limited to about 30 requests/minute when authenticated; core REST endpoints (readme, tree listings) allow 5000 requests/hour. A full scout run uses ~50-80 requests total, but the 4-6 search queries can hit the search limit if retried in quick succession. Check the `x-ratelimit-remaining` header on search responses (e.g. `gh api rate_limit --jq '.resources.search'`) and back off when it is low. If rate-limited anyway, log the error and continue with repos already fetched.

### Repo has no README or useful content
Skip it. Log: "Skipped {repo} — no README or skill definitions found."

### Private repos
`gh api` only accesses repos the authenticated user can see. Private repos of other users are silently excluded by GitHub. No special handling needed.

### Very large repos (monorepos)
The tree listing can be huge. Filter by path patterns early (`grep -iE` on the tree output) rather than reading the full tree.

### gh CLI not authenticated
Skip GitHub search. If a URL was provided, try `WebFetch` as fallback. Otherwise: "GitHub CLI not authenticated. Run `gh auth login` first."

---

## Final Checklist

- [ ] Search queries executed from `fixtures/scout-sources.json` (or single URL parsed)
- [ ] Up to 3 files read per repo
- [ ] Techniques extracted with structured data
- [ ] Each technique scored on 4 axes
- [ ] Proposals written for score ≥ 3.0
- [ ] Checkout gate applied at Phase 5 (forced dry-run outside the ShipGuard checkout)
- [ ] Techniques library updated (full online run only; grep-dedup before append, not overwrite)
- [ ] Scout report written
- [ ] GitHub issues created/commented (deduplicated; full online run only)
- [ ] Summary displayed

---
name: sg-scout
description: GitHub intelligence for ShipGuard — scans repos for code audit, debugging, and self-improving agent techniques, then files actionable improvement proposals. Use when you want to discover new approaches, benchmark against similar tools, or find inspiration for ShipGuard improvements. Trigger on "sg-scout", "scout github", "find skills", "benchmark shipguard", "veille technique", "competitive analysis", "what are others doing", "find improvements".
context: conversation
argument-hint: "[url] [--topic=eval|self-improving|audit|visual] [--dry-run]"
---

# /sg-scout — GitHub Intelligence for ShipGuard

Scan the GitHub ecosystem for techniques that could make ShipGuard better. Parse repos, score relevance, extract actionable ideas, and file them as issues — or seed the techniques library for future reference.

Think of it as a research assistant that reads other people's code so you don't have to, then brings back only what's worth stealing.

> **Recommended model: Sonnet 4.6.** Web search + repo scanning + summary writing — mechanical research work where Opus 4.7 provides no measurable quality gain. Use `/model sonnet` before invoking to save Opus weekly quota.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-scout` | Full scan — search GitHub, analyze top repos, publish findings |
| `/sg-scout <url>` | Deep-dive on one specific repo |
| `/sg-scout --topic=eval` | Focus: evaluation, benchmarking, scoring techniques |
| `/sg-scout --topic=self-improving` | Focus: auto-optimization, mutation, feedback loops |
| `/sg-scout --topic=audit` | Focus: code review, static analysis, bug detection |
| `/sg-scout --topic=visual` | Focus: visual regression, screenshot testing, UI automation |
| `/sg-scout --dry-run` | Show findings in terminal, don't create issues or write files |

---

## Phase 1 — Search

### Single-URL Mode

If a URL is provided (`/sg-scout https://github.com/owner/repo`), skip the search phase. Go directly to Phase 2 with that repo.

### Full Scan Mode

Search GitHub for repos relevant to ShipGuard's domains. Run these queries via `gh api`:

```bash
gh api search/repositories -X GET \
  -f q='"claude skill" code audit' \
  -f sort=stars -f per_page=10
```

**Query bank** (run 4-6 queries based on `--topic` or all if no topic):

| Topic | Queries |
|-------|---------|
| audit | `"claude skill" code audit`, `"code review" "parallel agents"`, `"static analysis" AI agent` |
| eval | `"eval" "claude skill"`, `"benchmark" "agent skill"`, `"self-improving" evaluation` |
| self-improving | `"self-improving" agent skill`, `"auto-optimize" prompt`, `"mutation" "agent" skill` |
| visual | `"visual regression" AI`, `"screenshot testing" agent`, `"agent-browser" OR "playwright" skill` |
| general | `claude plugin`, `"awesome-claude"`, `"claude code" skill` |

**Filters** (applied after search):
- Keep repos with: stars ≥ 3 OR pushed within last 90 days
- Skip: forks (unless stars > parent), archived repos, repos with no README
- Deduplicate by repo full_name

**Cap:** 20 repos maximum per run. If more found, sort by stars descending and take top 20.

**Known valuable repos** (always include if not already in results):
- `Alexmacapple/alex-claude-skill` — eval-robuste (statistical evaluation)
- `Shubhamsaboo/awesome-llm-apps` — self-improving agent skills
- `anthropics/claude-code` — official Claude Code (check for new skill patterns)

Store the repo list:
```yaml
repos:
  - full_name: "owner/repo"
    stars: 42
    pushed_at: "2026-04-10"
    description: "..."
    query_matched: "claude skill code audit"
```

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
| **Applicability** | ×1.0 | Can this plug into sg-code-audit, sg-visual-run, or sg-improve? |
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

**Affected skill:** `sg-code-audit` | `sg-improve` | `sg-visual-run`
**Mutation type:** `add_example` | `add_constraint` | `restructure` | `add_edge_case`
```

The `mutation type` classifies what kind of change this would be (inspired by the Executor/Analyst/Mutator pattern). This helps `sg-improve` prioritize: `add_constraint` and `add_edge_case` are usually safe; `restructure` needs more testing.

---

## Phase 5 — Publish

### Techniques Library (always updated)

Append to `docs/scout-reports/techniques-library.md`:

```markdown
## {Technique Name}
- **Source:** [{repo}]({url})
- **Score:** {composite}/5.0
- **Category:** {category}
- **Status:** `proposed` | `implemented` | `rejected`
- **ShipGuard skill:** {which skill it improves}
- **Date scouted:** {date}

{Description + adaptation proposal}
```

If an entry for this technique already exists (match by name or source repo), update it instead of duplicating.

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

### GitHub Issues (score ≥ 3.0, unless --dry-run)

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

Print all proposals to terminal. Don't write files or create issues. End with: "Run without --dry-run to publish these findings."

---

## Output

```
/sg-scout complete:
  Repos scanned: {N}
  Techniques found: {T}
  Proposals filed: {P} issues on bacoco/ShipGuard
  Library updated: docs/scout-reports/techniques-library.md ({L} entries)
  Report: docs/scout-reports/{date}-scout.md

  Top 3 findings:
  1. {technique} (score {s}/5) — {one-line summary}
  2. {technique} (score {s}/5) — {one-line summary}
  3. {technique} (score {s}/5) — {one-line summary}
```

---

## Edge Cases

### GitHub API rate limit
`gh api` is rate-limited to 5000 requests/hour. A full scout run uses ~50-80 requests (search queries + README reads + tree listings). If rate-limited, log the error and continue with repos already fetched.

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

- [ ] Search queries executed (or single URL parsed)
- [ ] Up to 3 files read per repo
- [ ] Techniques extracted with structured data
- [ ] Each technique scored on 4 axes
- [ ] Proposals written for score ≥ 3.0
- [ ] Techniques library updated (append, not overwrite)
- [ ] Scout report written
- [ ] GitHub issues created/commented (deduplicated)
- [ ] Summary displayed

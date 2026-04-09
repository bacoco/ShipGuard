---
name: visual-fix
description: Process human-annotated Visual screenshots — analyze marked problem areas, trace to source code, implement fixes, capture before/after screenshots, and regenerate the review page with a comparison tab. Trigger on "fix annotated tests", "process review annotations", "visual fix", "fix les annotations", "traite la review".
context: conversation
argument-hint: "[path to fix manifest JSON, or 'latest' to use most recent]"
---

# /visual-fix — Fix Annotated Screenshots

Take human-annotated screenshots from `/visual-review`, analyze the marked problems, fix the code, and produce before/after comparison.

## Flow

```
Human annotates screenshots in review.html
  → clicks "Validate & Generate Report"
  → downloads fix-manifest.json + validation-report.md
  → runs /visual-fix
    → AI reads each annotated screenshot
    → AI reads the annotation coordinates (problem region)
    → AI identifies the visual bug in that region
    → AI traces to source code (component, CSS, data)
    → AI implements the fix
    → AI rebuilds the app
    → AI re-runs the specific test to capture "after" screenshot
    → AI generates before/after comparison page
```

## Invocations

| Command | Behavior |
|---------|----------|
| `/visual-fix` | Process the most recent fix manifest in `visual-tests/_results/` |
| `/visual-fix <path>` | Process a specific fix manifest JSON file |

## Instructions

### Step 1: Load the Fix Manifest

Find the manifest file:
- If argument provided: use that path
- Otherwise: find the most recent `visual-fix-manifest-*.json` in the current directory or Downloads

The manifest contains:
```json
{
  "action": "validate-and-fix",
  "tests": [
    {
      "test": "principal/notaire-chat",
      "url": "http://localhost:6969/notaire-chat",
      "screenshot": "screenshots/notaire-chat-load.png",
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
# Read the screenshot file
Read(visual-tests/_results/{screenshot_path})
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

```bash
# If frontend change:
docker compose -f infra/docker-compose.mac-studio.yml up -d --build uranus
# Wait for healthy

# If backend change:
docker compose -f infra/docker-compose.mac-studio.yml up -d --build api-synthesia

# Re-run the specific test steps
npx agent-browser open {test_url}
# ... execute test steps from manifest
npx agent-browser screenshot --full visual-tests/_results/screenshots/{test-id}-after.png
```

#### 2e. Save before/after pair

Copy the original screenshot:
```bash
cp visual-tests/_results/screenshots/{original}.png visual-tests/_results/screenshots/{test-id}-before.png
```

### Step 3: Generate Before/After Comparison

Regenerate the review page with a "Comparison" tab:

```bash
node visual-tests/build-review.mjs --with-comparisons
```

The comparison tab shows side-by-side before/after for each fixed test:
- Left: "before" screenshot with red annotation rectangles overlay
- Right: "after" screenshot
- Status: FIXED / STILL_BROKEN
- Description of what was changed

### Step 4: Commit and Report

```bash
git add <fixed files> visual-tests/_results/screenshots/*-after.png
git commit -m "fix(e2e): fix N annotated issues from human review"
```

Report to user:
```
Visual Review Fix Complete:
- {N} annotated issues processed
- {M} fixed, {K} need further investigation
- Before/after comparison: visual-tests/_results/review.html (Comparison tab)
- Rebuilt: uranus / api-synthesia
```

## Important Rules

- ALWAYS read the "before" screenshot with the Read tool before attempting any fix
- ALWAYS focus on the annotated region coordinates — the human marked exactly where the problem is
- ALWAYS capture an "after" screenshot using the same test steps
- ALWAYS verify the fix visually (read the "after" screenshot)
- If a fix requires backend changes, rebuild api-synthesia too
- If you can't identify the issue from the screenshot, say so — don't guess

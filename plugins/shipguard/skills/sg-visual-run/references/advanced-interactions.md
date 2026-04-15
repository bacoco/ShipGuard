# Advanced agent-browser interactions

Reference for testing patterns beyond `click`/`fill`/`snapshot`. These are commonly missed and cause tests to silently fail or skip assertions.

`agent-browser` is a Playwright CLI under the hood — every Playwright capability has a CLI equivalent. The commands below all generate real CDP events (OS-level), so React synthetic events fire correctly.

---

## 1. Drag-and-drop (React: @dnd-kit, react-dnd, react-beautiful-dnd)

### Anti-patterns — NEVER use
1. **`agent-browser click @ref` + `element.click()` via `eval`**
   → Fires no pointer event. React synthetic events not generated. `@dnd-kit` PointerSensor expects real `pointerdown/move/up`.
2. **`agent-browser drag "text=X" "text=Y"`**
   → Ambiguous match when the text appears multiple times (source + already-assigned target). Prefer precise `@refs` or CSS/testid selectors.
3. **`mouse down` then `mouse up` without intermediate `mouse move`**
   → `@dnd-kit` has `activationConstraint: { distance: 3 }` (or 5). Without crossing this distance, the drag never starts — interpreted as click.

### Required recipe (@dnd-kit, react-beautiful-dnd)

```bash
agent-browser mouse move $SRC_X $SRC_Y
agent-browser mouse down
agent-browser mouse move $((SRC_X + 20)) $((SRC_Y + 20))   # CRITICAL — cross activation distance
agent-browser mouse move $MID_X $MID_Y                      # at least one intermediate point
agent-browser mouse move $DST_X $DST_Y                      # final target
agent-browser mouse up
```

Get src/dst coordinates:
```bash
agent-browser eval "(() => { const el = document.querySelector('[data-testid=\"draggable-card-1\"]'); const r = el.getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}); })()"
```

### Native Playwright equivalent (for reference)

```js
await page.mouse.move(srcX, srcY);
await page.mouse.down();
await page.mouse.move(srcX + 20, srcY + 20, { steps: 10 });  // steps: N generates N intermediate points
await page.mouse.move(dstX, dstY, { steps: 20 });
await page.mouse.up();
```

### Differences per framework

| Framework | Activation | Expected events | Recipe |
|-----------|-----------|-----------------|--------|
| `@dnd-kit` PointerSensor | 3-5px distance | pointerdown/move/up | Recipe above |
| `@dnd-kit` KeyboardSensor | Space + arrows | keydown | `agent-browser press Space` + arrow keys |
| `react-beautiful-dnd` | 5px OR 200ms | mousedown/move/up | Recipe above |
| `react-dnd` (HTML5Backend) | immediate | dragstart/dragover/drop/dragend | **Use `agent-browser drag @src @dst` or Playwright `dragAndDrop()`** — `mouse move` is NOT enough (HTML5 API requires DataTransfer) |
| `draggable` native HTML5 | immediate | dragstart/dragover/drop | Same: `agent-browser drag` or `dispatchDragEvent` via eval |

### Why
- React converts native pointer events into synthetic events at capture. A JS `.click()` bypasses this pipeline → React handlers not reliably triggered.
- `@dnd-kit` `PointerSensor` applies an activation distance to ignore simple clicks. Without intermediate movement, the drag is interpreted as a click.
- `agent-browser` is Playwright CDP under the hood → `mouse move/down/up` generate real OS-level events.

---

## 2. Hover, tooltips, context menus

Hover triggers tooltips, submenus, Radix/Headless UI popovers.

```bash
agent-browser hover @e5              # hover on tooltip trigger
agent-browser wait 300               # wait for animation
agent-browser snapshot | grep -i "tooltip content"
```

**Anti-pattern:** `click` does NOT trigger hover states. If an element is only visible on hover, `click` fails because the element is invisible at snapshot time.

Right-click (context menu):
```bash
agent-browser mouse move $X $Y
agent-browser mouse down right
agent-browser mouse up right
```

---

## 3. Keyboard shortcuts & precise input

### `press` vs `type` vs `keyboard type` vs `keyboard inserttext`

| Command | When to use |
|---------|-------------|
| `press <key>` | Individual keys with modifiers: `Enter`, `Tab`, `Escape`, `Control+a`, `Meta+k`, `ArrowDown` |
| `type @ref "text"` | Simple input typing — fires keydown/input/change |
| `fill @ref "text"` | Clear then type — faster, skips individual keydown events |
| `keyboard type "text"` | Global typing (no selector) — useful for already-focused command palettes |
| `keyboard inserttext "text"` | Insert without events (IME-like) — test if code listens to `input` event |

### Critical cases

**Combobox / Autocomplete:**
```bash
agent-browser fill @e3 "mar"
agent-browser wait 500               # debounce (adjust per app)
agent-browser press ArrowDown
agent-browser press Enter
```
`click` on a dropdown option can fail if the option is in a portal rendered outside root.

**Command palette (Cmd+K):**
```bash
agent-browser press Meta+k           # macOS
# or Control+k on Linux/Windows
agent-browser keyboard type "dossier"  # palette already focused
agent-browser press Enter
```

**Escape to close modals:**
```bash
agent-browser press Escape
```

**Copy-paste:**
```bash
agent-browser press Control+a
agent-browser press Control+c
agent-browser focus @e7
agent-browser press Control+v
```

---

## 4. Forms: `check`/`uncheck`/`select` vs `click`

| Element | Correct command | Why not `click` |
|---------|-----------------|-----------------|
| Checkbox | `check @e1` / `uncheck @e1` | `click` toggles, `check` forces state (idempotent) |
| Radio | `check @e2` | Same |
| Native `<select>` | `select @e3 "value"` | `click` does NOT open native OS menu, `select` fires change event |
| Custom select (Radix/Headless) | `click` trigger + `click` option | `select` does NOT work for custom components |
| Range slider | `focus @e4` then `press ArrowRight` × N | `click` does NOT modify value |
| Color picker | `fill @input type=color "#ff0000"` | Depends on implementation |

---

## 5. File upload (including hidden inputs)

Standard:
```bash
agent-browser upload @e5 /path/to/file.pdf
```

**Hidden file inputs (common React pattern):** Many apps show a custom button that delegates to a `<input type="file" hidden>`. `agent-browser upload` works on the hidden input anyway (detected via selector).

If the input is not snapshot-visible (opacity 0, hidden):
```bash
# Temporarily make input visible via eval to find it
agent-browser eval "document.querySelectorAll('input[type=file]').forEach(el => { el.style.opacity='1'; el.style.position='fixed'; el.style.top='10px'; el.style.left='10px'; el.style.zIndex='99999'; })"
agent-browser upload 'input[type=file]' /path/to/file.pdf
```

Multiple files:
```bash
agent-browser upload @e5 /path/to/a.pdf /path/to/b.pdf
```

Drag-and-drop upload (dropzone): dispatch a `DataTransfer` via eval — `mouse move/up` is not enough because HTML5 drop events require a complete DataTransfer.

---

## 6. Download verification

```bash
agent-browser download @e10 /tmp/exported.pdf
# Verify content:
file /tmp/exported.pdf
stat -c%s /tmp/exported.pdf      # size
```

---

## 7. Precise scroll

```bash
agent-browser scroll down 500         # px
agent-browser scroll up
agent-browser scroll right 200        # horizontal scroll
agent-browser scrollintoview @e8      # scroll to make element visible
agent-browser mouse wheel 500 0       # programmatic wheel event (triggers infinite scroll)
```

**Infinite scroll / virtual lists:** `mouse wheel` is necessary because direct `scroll` may not trigger IntersectionObserver listeners.

---

## 8. Network mocking (`route`)

**Test error states without backend being down:**

```bash
# Block an endpoint
agent-browser network route "**/api/dossier/*/risk-score" --abort

# Return a mock response
agent-browser network route "**/api/health" --body '{"status":"degraded","message":"DB slow"}'

# Verify a call was made
agent-browser network requests --filter "/api/"

# Record full network session
agent-browser network har start /tmp/session.har
# ... tests ...
agent-browser network har stop

# Clear mocks
agent-browser network unroute
```

**Use cases:**
- Test UI when API returns 500
- Test loading states (artificial delay)
- Test timeout handling
- Detect accidental API calls (polling leaks, non-aborted requests)

---

## 9. State manipulation (cookies, storage)

**Auth bypass (skip login):**
```bash
# Login once, export state
agent-browser --session-name myapp open http://localhost:6969
# ... login ...
# State is auto-saved. Re-run with:
agent-browser --session-name myapp open http://localhost:6969   # auth restored
```

**Direct manipulation:**
```bash
agent-browser cookies get
agent-browser cookies set --name session --value "abc123" --domain localhost --path /
agent-browser cookies clear

agent-browser storage local                  # dump localStorage
agent-browser storage session                # dump sessionStorage
```

**Feature flag override (no rebuild):**
```bash
agent-browser eval "localStorage.setItem('feature-flag-transaction_anomaly', 'true'); location.reload()"
```

**Zustand persist middleware reset:**
```bash
agent-browser eval "localStorage.removeItem('my-zustand-store'); location.reload()"
```

---

## 10. Device / responsive / env testing

```bash
agent-browser set viewport 375 812           # iPhone X
agent-browser set viewport 1920 1080         # desktop HD

agent-browser set device "iPhone 15 Pro"     # full preset (viewport + UA + touch)
agent-browser set device "Pixel 5"

agent-browser set geo 48.8566 2.3522         # Paris (geoloc)
agent-browser set offline on                 # simulate offline
agent-browser set offline off

agent-browser set media dark                 # prefers-color-scheme: dark
agent-browser set media light reduced-motion # prefers-reduced-motion

agent-browser set headers '{"Authorization":"Bearer xyz"}'
agent-browser set credentials admin secret   # HTTP basic auth
```

**Critical usage:**
- Dark mode: many CSS bugs only surface in dark. **Always test both.**
- Reduced motion: verify animations respect preference
- Mobile: touch events + responsive
- Offline: PWA behavior, cache, error states

---

## 11. Visual regression (`diff`)

```bash
# Baseline
agent-browser screenshot /tmp/baseline/login.png

# After change
agent-browser diff screenshot --baseline /tmp/baseline/login.png

# Compare two DOM snapshots
agent-browser diff snapshot

# Compare two URLs (A/B deployment testing)
agent-browser diff url http://prod.foo.com http://staging.foo.com
```

More robust than LLM-check for detecting pixel-perfect regressions. Combine with LLM-check for semantic context.

---

## 12. Multi-tab / popups (OAuth, social sharing)

OAuth flows, "Open in new tab", or Stripe Checkout popups use `window.open`.

```bash
agent-browser tab list                # list all tabs
agent-browser tab new                 # new tab
agent-browser tab 2                   # switch to tab 2
agent-browser tab close               # close active
```

**OAuth popup flow:**
```bash
agent-browser click @signin-google   # opens popup
agent-browser tab list               # identify popup
agent-browser tab 2                  # switch to popup
agent-browser fill @email "test@..." && agent-browser click @submit
agent-browser tab 1                  # back to app
agent-browser wait 2000              # wait for redirect
```

---

## 13. Console & errors (silent JS error detection)

**MUST-DO after each critical test:**

```bash
agent-browser console | grep -iE "error|warn|failed"
agent-browser errors                  # page errors (uncaught, unhandledrejection)
agent-browser console --clear         # reset for next test
```

Silent React errors (ErrorBoundary caught, console.error) pass without breaking UI. Without console check, they are missed.

Pattern:
```bash
agent-browser console --clear
# ... run test ...
errors=$(agent-browser console | grep -iE "^(error|warn)" | wc -l)
if [ "$errors" -gt 0 ]; then
  echo "FAIL: JS errors/warnings in console"
  agent-browser console
fi
```

---

## 14. Video recording & tracing

For post-mortem debug of flaky tests:

```bash
agent-browser record start /tmp/test.webm
# ... run test ...
agent-browser record stop

# Playwright trace (inspectable in trace viewer)
agent-browser trace start /tmp/trace.zip
# ... test ...
agent-browser trace stop
# Open: npx playwright show-trace /tmp/trace.zip

# CPU profiling
agent-browser profiler start /tmp/profile.cpuprofile
# ... test ...
agent-browser profiler stop
# Open in Chrome DevTools → Performance → Load profile
```

**When to use:**
- Test fails locally, unclear why → `trace start`
- UI lag → `profiler start`
- Visual bug report for a human → `record start`

---

## 15. Semantic selectors (`find`)

Instead of fragile CSS:

```bash
agent-browser find role button click --name "Save"
agent-browser find text "Delete dossier" click
agent-browser find label "Email" fill "user@example.com"
agent-browser find placeholder "Search..." fill "sale"
agent-browser find testid "dossier-card-primary" click
agent-browser find alt "Logo" click
```

**Semantic priority (Testing Library-style):**
1. `role` (most robust — accessibility-first)
2. `label` (form inputs)
3. `text` (buttons, links)
4. `placeholder` (inputs without label)
5. `testid` (custom fallback)

Avoid `@eN` refs in reusable tests — refs change every snapshot. `testid` is stable.

**Disambiguation:**
```bash
agent-browser find text "Edit" first click        # 1st match
agent-browser find text "Edit" nth 2 click        # 3rd match (0-indexed)
agent-browser find text "Edit" last click
```

---

## 16. Iframe & Shadow DOM

**Iframes:**
```bash
agent-browser snapshot -s "iframe[name='checkout']"   # scope to iframe content
```

**Shadow DOM (Web Components):**
Playwright `>>` selectors traverse shadow roots:
```bash
agent-browser click "my-component >> button.submit"
```

---

## 17. Auth optimization (test speed)

**Anti-pattern:** Login via form on every test → 2-3s × 100 tests = 5min wasted.

**Optimal patterns:**

```bash
# Option 1: Saved session (recommended)
agent-browser --session-name myapp open http://localhost:6969
# First time, login manually. Subsequent runs, auth restored.

# Option 2: Existing Chrome profile
agent-browser --profile Default open http://localhost:6969
# Reuses cookies from active Chrome session

# Option 3: Auto-connect to running Chrome
agent-browser --auto-connect snapshot
# Attaches to Chrome already open (with `--remote-debugging-port=9222`)

# Option 4: State file (CI)
agent-browser --state ./auth.json open http://localhost:6969

# Option 5: Auth Vault
agent-browser auth save myapp --url http://localhost:6969/login --username vlad --password loic
agent-browser auth login myapp
```

---

## 18. SPA-specific pitfalls

### Client-side routing
`agent-browser open /path` may not always trigger the React router — can do hard reload. Prefer:
```bash
agent-browser eval "history.pushState(null, '', '/dashboard'); dispatchEvent(new PopStateEvent('popstate'))"
```

### Debounced inputs
Many `onChange` with 300-500ms debounce. After `fill`, always:
```bash
agent-browser fill @search "dossier"
agent-browser wait 600                   # debounce
agent-browser snapshot                   # results loaded
```

### Animations / transitions
After navigation, transitions (framer-motion, CSS) can delay element appearance.
```bash
agent-browser click @navigate-link
agent-browser wait 400                   # exit + enter animation
agent-browser wait ":has-text('Target content')"   # better: semantic wait
```

### Portals (modals, dropdowns)
React Portals render content outside the main DOM tree (`document.body > #portal-root`). Modals, toasts, Radix dropdowns are typically in portals.
- `snapshot` captures them (tree is global)
- CSS selectors relative to a parent component do NOT find them
- Prefer global `testid` or `role`

### Suspense boundaries
A Suspense fallback can show a loader for 2-30s while code splits load. Wait for a semantic element, not an arbitrary timeout.

---

## 19. Atomic batch

```bash
agent-browser batch --bail \
  "open http://localhost:6969/login" \
  "fill @email user@example.com" \
  "fill @password secret" \
  "click @submit" \
  "wait 2000" \
  "get url"
```

`--bail` stops on first error. Without `--bail`, continues and accumulates errors (for reporting).

Advantage: reduced latency (single CLI round-trip) + visual atomicity in logs.

---

## 20. Annotated screenshots (vision LLM)

```bash
agent-browser screenshot --annotate /tmp/capture.png
```

Produces a screenshot with numbered labels `[1] [2] [3]` on each interactive element + a text legend. Useful for passing to a vision LLM that needs to click "the Save button" without guessing coordinates.

---

## Checklist before writing a new test

Before coding a test, ask yourself:

- [ ] Complex interactions: DnD, hover, keyboard shortcuts, right-click → use precise `mouse`/`keyboard`/`press`
- [ ] Forms: `check`/`uncheck`/`select` rather than `click`
- [ ] Upload: `upload @input` (even if hidden)
- [ ] Network: need to mock a 500 error? → `network route --abort`
- [ ] State: feature flag to override? → `storage local` or eval
- [ ] Viewport: responsive test? → `set viewport` + `set device`
- [ ] Dark mode: `set media dark`
- [ ] Errors: `console` + `errors` after every critical test
- [ ] Portals: use global `testid` or `role`, not relative selectors
- [ ] Animations: semantic `wait`, not arbitrary `sleep`
- [ ] Auth: `--session-name` to reuse login
- [ ] Visual regression: `diff screenshot --baseline`

A test that only uses `click/fill/snapshot` without these tools misses ~80% of real UI bugs.

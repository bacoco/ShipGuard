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

## Python Checklist

- `except Exception: pass` or `except: pass` — must log at minimum
- `except Exception:` that catches too broadly (catching SystemExit, KeyboardInterrupt)
- `list[0]` / `dict["key"]` on data from external sources without length/existence check
- Direct filesystem access (open(), Path()) where storage abstraction should be used
- Flag `asyncio.get_event_loop()` when called inside an `async def` or when a loop is already running — use `asyncio.get_running_loop()` instead.
- Blocking calls (subprocess.run, time.sleep, synchronous I/O) inside async functions
- Threading: shared mutable state without locks
- Missing `async with` / `async for` on async context managers/iterators
- f-strings in logger calls (eager formatting even when log level disabled)
- Response model class defined after the route that uses it (FastAPI NameError)

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

## Shell Checklist (`.sh`, `.bash`, `.zsh`)

- Read the complete file before judging it. Distinguish an executed script from a sourced library; a sourced library does not require a shebang and must not unconditionally change the caller's shell options.
- Detect strict mode wherever it appears, not only in the first 15 lines: `set -e`, `set -u`, `set -o pipefail`, and combined forms such as `set -euo pipefail`. A license block, comments, or helper prelude before strict mode is valid.
- Do not claim "unchecked exit" merely because a command is bare. Account for `errexit`, `if`/`while`/`until` tests, `&&`/`||` lists, negation, command substitutions, and callers that deliberately inspect `$?`.
- For pipelines, determine whether `pipefail` is active at that exact point. Without `pipefail`, an early-stage failure may be hidden; with it, do not report the same pipeline as unchecked without contrary evidence.
- Treat output capture as deliberate when the value or exit status is checked later. Trace assignments, command substitutions, redirections, and deferred status checks before reporting swallowed output or failure.
- Check quoting of expansions, safe temporary-file creation and cleanup, traps, signal forwarding, and cleanup on early exit.
- A claim that a guard, error check, trap, caller, or test is missing requires the positive search record defined in `agent-prompt.md`; absence by inspection of one local snippet is not proof.

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

## HTML/CSS/JS (Vanilla) Checklist

- `<img>` without `alt` attribute (accessibility)
- `<img>` without explicit `width`/`height` attributes (causes layout shift / CLS)
- `<html>` without `lang` attribute (screen readers can't detect language)
- Missing `<meta name="viewport">` tag (breaks mobile rendering)
- Missing `<meta name="description">` or `<meta property="og:*">` tags (SEO/sharing)
- Missing `<link rel="canonical">` on pages with duplicate URLs
- Heading hierarchy gaps (`<h1>` followed by `<h3>`, skipping `<h2>`)
- `<form>` without `<label>` on inputs (accessibility)
- `<input>` without `autocomplete` attribute on login/address forms
- Missing `aria-label` or `aria-labelledby` on interactive elements without visible text
- Missing `role` attributes on custom interactive widgets (tabs, accordions, dialogs)
- Hardcoded colors outside `:root` or CSS custom properties (inconsistent theming)
- `querySelector` / `getElementById` result used without null check
- `addEventListener` without corresponding `removeEventListener` on teardown
- Missing `{ passive: true }` on scroll/touch event listeners (blocks smooth scrolling)
- Missing `prefers-reduced-motion` media query for animations
- Inline scripts using parser-blocking DOM writes instead of createElement/appendChild
- Broken `<a href>` pointing to non-existent anchors or files
- Missing `rel="noopener"` on `target="_blank"` links (security + performance)

## Application-Level Checklist (all languages)

These checks go beyond per-file patterns — they look at whether features actually work end-to-end.

### UI / Frontend Logic
- Button or action rendered in UI but handler is a no-op, throws "not implemented", or is missing entirely
- Route guard or redirect that blocks a page that should be accessible (or vice versa)
- State machine with phases/states declared but never reached via any transition
- Component shows success feedback while the actual API request failed or was never sent
- Modal or panel that leaks resources (intervals, listeners) when closed without cleanup
- Feature flag checked in config but the code path behind it is unreachable for a different reason

### Backend / API Logic
- API route accepts a request field in the schema but never reads or uses it
- System prompt, workflow template, or configuration declared but never injected into the actual processing
- Duplicate detection logic that still enqueues/processes the item despite detecting a duplicate
- Queue or background task created more than once per single user action
- Silent fallback that returns a default value when the real response was an error (hides failures)
- Endpoint changes response shape in a new version but callers still read the old shape

### Cross-Service Integration
- Frontend sends payload field X, backend expects field Y (different name, type, or nesting)
- Proxy rewrite path doesn't match backend route path (404 at runtime despite both sides existing)
- Auth token propagation mismatch — frontend sends via header, backend reads from cookie (or vice versa)
- Frontend expects error `{ error: "..." }`, backend returns `{ detail: "..." }` or raw string
- Response assumed to be an array but backend returns `null`, an object, or HTML on error
- Document/entity scope mixing — action on item A accidentally processes or returns data for item B

### Data / Pipeline Logic
- Same document or entity processed twice (duplicate task creation, double indexing)
- Cache or index not invalidated after the underlying data changes
- Polling/completion check that stops polling when it shouldn't (wrong status transition)
- Batch operation that silently skips failures instead of reporting them

### Validation Gaps
- Build/compile passes but typecheck is not configured or is skipped in CI
- New feature has no test, no smoke check, and no manual verification step documented
- Backend route changed but no route-level test was updated
- Claims of "feature complete" based only on code reading, not execution

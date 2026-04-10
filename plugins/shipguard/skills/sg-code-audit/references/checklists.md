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
- `asyncio.get_event_loop()` (deprecated) instead of `get_running_loop()`
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

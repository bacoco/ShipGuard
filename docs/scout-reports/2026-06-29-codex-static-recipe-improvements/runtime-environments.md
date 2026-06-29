# Recorder And Sandboxed Runtime Environments

Read this when changing `sg-record`, browser setup, or Codex/Claude
environment instructions.

## P1.10 - Avoid Unbounded `npx` Prechecks In `sg-record`

### Finding

A precheck like `npx playwright --version` can hang or try network access,
especially outside a Node project.

### Proposal

Safer order:

1. `node -e "import('playwright')"` from the project
2. local `node_modules/.bin/playwright`
3. global binary if available
4. otherwise show install instructions without blocking
5. bound each command with a timeout

### Acceptance Criteria

- No unbounded `npx` command.
- Environment without Playwright fails fast with a clear message.

## P1.11 - Make Recorder Bootstrap Strictly Sequential

### Finding

Recorder file copies fail if they run before:

```bash
mkdir -p visual-tests/lib visual-tests/manifests
```

### Proposal

The runbook must impose:

```bash
mkdir -p visual-tests/lib visual-tests/manifests
cp ...
cp ...
```

Explicitly avoid parallelization for these steps.

### Acceptance Criteria

- Bootstrap from zero does not depend on shell-agent execution order.
- Re-running bootstrap is idempotent.

## P1.12 - Document Required Permissions

### Finding

Several legitimate ShipGuard actions are blocked by default sandboxing:

| Action | Why | Workaround |
|---|---|---|
| `agent-browser` | local socket in home | allow it or configure socket under `/tmp` |
| `build-review --serve` | local port | allow local server, bind `127.0.0.1` |
| `curl POST localhost` | endpoint test | allow local network |
| `gh api` | scout needs GitHub | explicit network permission |
| `npx` | can require network | avoid or require explicit install |
| Python compile | pycache outside workspace | `PYTHONPYCACHEPREFIX=/tmp/...` |

### Proposal

Add a `Sandbox / Codex / Claude` section in relevant skills.

### Acceptance Criteria

- User knows which permissions to accept.
- Sandbox errors are recognized as such in runbooks.

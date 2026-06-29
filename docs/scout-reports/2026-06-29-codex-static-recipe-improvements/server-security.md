# Local Review Server Security

Read this when changing `build-review.mjs --serve` or file-serving endpoints.

## P0.3 - Bind The Review Server To `127.0.0.1`

### Finding

`build-review.mjs --serve` uses `server.listen(PORT)` without an explicit host.
Depending on Node and environment, this can listen on an unspecified address.
Comments describe a localhost-only server, but code does not enforce it.

### Impact

The server exposes:

- files under `_results/`
- `POST /save-manifest`
- monitor endpoints
- wildcard CORS

On an untrusted network, accidental LAN exposure increases attack surface.

### Proposal

Default:

```js
const HOST = "127.0.0.1";
server.listen(PORT, HOST, () => {
  console.log(`Server: http://${HOST}:${PORT}`);
});
```

Add an explicit option:

```bash
node visual-tests/build-review.mjs --serve --host=0.0.0.0
```

Print a warning when `--host=0.0.0.0` is used.

### Acceptance Criteria

- Default server listens on `127.0.0.1`.
- The log prints the real host.
- LAN exposure requires an explicit option.

## P0.4 - Replace `startsWith` Path Traversal Guard

### Finding

The file server uses logic like:

```js
if (!filePath.startsWith(RESULTS_DIR)) forbidden;
```

String prefix checks are fragile. A resolved sibling directory with the same
prefix can bypass intent.

### Proposal

Use `resolve` and `relative`:

```js
import { resolve, relative, isAbsolute } from "path";

const root = resolve(RESULTS_DIR);
const target = resolve(root, requestedPath);
const rel = relative(root, target);

if (rel.startsWith("..") || isAbsolute(rel)) {
  res.writeHead(403);
  res.end("Forbidden");
  return;
}
```

### Acceptance Criteria

- `../` is refused.
- Encoded paths are refused after decoding and resolution.
- A sibling directory such as `_results-old` is not served.

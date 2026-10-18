# Private profile format (version 1)

JSON fields: schemaVersion (1), revision (nonempty string), updatedAt (ISO timestamp),
entries (array) and communication (array). Maximum file size: 128 KiB.
No credentials or raw transcripts. Unknown JSON fields are rejected to catch schema drift.

Each entry contains id, variants (nonempty strings), meaning, contexts (strings),
exclusions (strings), status (confirmed, corroborated or hypothesis), sources (nonempty references).
Contexts are advisory labels such as project or machine, not permission scopes.
Multiple entries may share a variant because it can have different meanings.
Each communication observation contains id, observation, status and sources.
Source references are opaque strings resolved by a private report/index.

Minimal synthetic example:

```json
{
  "schemaVersion": 1,
  "revision": "example-1",
  "updatedAt": "2026-01-01T00:00:00Z",
  "entries": [{
    "id": "ledger-alias",
    "variants": ["the ledger"],
    "meaning": "The accounting application",
    "contexts": ["project:accounting"],
    "exclusions": ["a physical notebook"],
    "status": "corroborated",
    "sources": ["case-1"]
  }],
  "communication": [{
    "id": "ordered-request",
    "observation": "Check ordering expressions before acting on a multi-step request.",
    "status": "corroborated",
    "sources": ["case-2"]
  }]
}
```

lookup returns literal phrase matches (Unicode normalized, case-insensitive, word boundaries),
candidate senses, requested context and a context-label match indicator. An indicator only reports
an exact label match, not whether the user's current intent matches that sense.
All senses remain visible, including hypotheses and competing project meanings. No automatic
substitution, authorization, remote access, learning, network request or file write occurs.

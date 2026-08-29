# Logic Audit Output Contract

Write both files under `visual-tests/_results/`:

- `logic-results.json`: canonical machine-readable result;
- `logic-report.md`: short human rendering of the same data.

## Canonical JSON

```json
{
  "schema_version": "1.0",
  "repo": "target-repository",
  "timestamp": "2026-08-29T10:00:00Z",
  "scope": {"type": "diff", "value": "main", "files": ["src/jobs/worker.py"]},
  "mode": "reason",
  "depth": "standard",
  "status": "completed",
  "summary": {
    "candidates_checked": 1,
    "obligations_checked": 2,
    "confirmed_violations": 1,
    "risks": 0,
    "contract_conflicts": 0,
    "questions": 0,
    "uncovered": 0,
    "by_severity": {"critical": 0, "high": 1, "medium": 0, "low": 0},
    "evidence_mix": {"reasoned": 1, "measured": 0}
  },
  "candidates": [
    {
      "id": "p01",
      "kind": "procedure",
      "name": "job retry lifecycle",
      "files": ["src/jobs/worker.py", "src/jobs/store.py"],
      "model": {
        "inputs": ["retry callback"],
        "states": ["running", "completed"],
        "effects": ["persist status", "ack callback"]
      },
      "obligations": [
        {
          "id": "o01",
          "statement": "A completed job cannot return to running",
          "source": {"file": "docs/job-lifecycle.md", "line": 42},
          "source_kind": "declared",
          "confidence": "high"
        }
      ],
      "findings": [
        {
          "id": "logic-001",
          "kind": "invariant-violation",
          "severity": "high",
          "status": "confirmed",
          "obligation_id": "o01",
          "evidence": "reasoned",
          "confidence": "high",
          "assumptions": ["callback is delivered after completion"],
          "counterexample": "deliver a stale retry callback after the completion commit",
          "trace": ["completed", "retry callback", "running"],
          "file": "src/jobs/worker.py",
          "line": 87,
          "related_audit_bug_id": null
        }
      ]
    }
  ],
  "contract_conflicts": [],
  "questions": [],
  "uncovered": [],
  "skipped": [],
  "impacted_backend": [
    {"endpoint": "worker:retry_job", "reason": "late retry can regress terminal state", "severity": "high"}
  ],
  "impacted_ui_routes": []
}
```

## Required values

- `status`: `completed | not-applicable | partial | error`
- candidate `kind`: `procedure | algorithm`
- finding `status`: `confirmed | risk`
- finding `kind`: `precondition-violation | postcondition-violation | invariant-violation |
  invalid-transition | ordering-error | idempotency-error | conservation-error | termination-error |
  bounds-error | authorization-gap | logic-error`
- `severity`: `critical | high | medium | low`
- `evidence`: `reasoned | measured`
- `source_kind`: `declared | observed-expectation | observed | assumed`
- `confidence`: `high | medium | low`

`contract-conflict`, `question`, and `uncovered` entries each require `description`, `candidate_id`,
and relevant source/file references. Never place an assumed obligation in `findings`; put it in
`questions`.

For `not-applicable`, keep arrays empty and explain the result in `skipped`, for example:

```json
{"candidate": "diff", "reason": "no workflow, state machine, retry, transaction, or non-trivial algorithm impacted"}
```

## Markdown report

Render, in order:

1. scope, mode, and evidence mix;
2. confirmed violations ordered by severity;
3. contract conflicts;
4. risks and questions;
5. uncovered and skipped paths.

For every confirmed violation show the obligation source, smallest counterexample, trace, evidence,
confidence, and assumptions. Do not add claims absent from the JSON.

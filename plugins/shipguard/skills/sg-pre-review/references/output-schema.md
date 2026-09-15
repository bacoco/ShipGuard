# Optional dashboard artifact (version 1.0)

When explicitly requested, write `visual-tests/_results/prereview-results.json` in the named
repository. This is an additive advisory report; do not overwrite other lanes or create a plan.
The default remains a chat report. The existing `sg-visual-review` builder consumes this file.

Required root fields:

- `schema_version`: `"1.0"`.
- `request`: original user request (string), not an agent reformulation.
- `status`: `completed | partial | error`. Completed means analysis delivered, never PASS.
- `candidates`: objects with `reference` (path/symbol), `decision`
  (`use | configure | extend | create | none | undetermined`) and `justification` (string).
- `interfaces`, `usages`: separate arrays of evidence objects with `reference`, `description`,
  `source_kind` (`declared | observed-expectation | observed | assumed`),
  `evidence` (`reasoned | measured`) and applicability. Static inspection is reasoned.
- `contract_conflicts`, `questions`, `uncovered`: arrays of concern objects with `description`
  and source references. Conflicts retain both sources and their incompatible consequences.
- `search_scope`: objects describing roots/queries/exclusions and a `state` of
  `not-found | absent-in-scope | inaccessible | not-active | unsuitable` when applicable.
- `context`: `{ "selected_references": [], "transmission": "not observable" }`.

Preserve repository/commit/local-change information when known. Compare an external plan only
when supplied; otherwise explicitly record that no plan was supplied. Never collect secrets.
Missing decisive evidence or an undetermined candidate requires partial status. An error or
partial report remains visible in the dashboard; malformed input is shown as an error.
The optional local-model runner's stdout is a distinct format, not this dashboard artifact.

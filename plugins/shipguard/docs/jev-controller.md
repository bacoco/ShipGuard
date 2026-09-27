# Experimental Jev dialogue controller — proposal

**Status: design only. No Jev adapter or associated test has been added by this change.**

## Scope

This proposal describes an optional controller behind the existing dialogue hook, not new
lifecycle hooks or a replacement for mission-lock. The first proposed check is deliberately
narrow: compare a final success/completion claim with explicitly supplied source evidence at
`Stop`. Implementation and its focused protocol tests remain to be done.

No provider is selected, installed, started or called by default. Existing host permissions,
mission-lock, hook trust, deadlines and recursion guards remain authoritative. GrillGoal stays
standalone. This work does not restart the previously cancelled model evaluations.

## Why an adapter

The existing controller speaks chat-completions. Jev instead accepts `model`, `state` and typed
`questions`, returning `answers`. Replacing the chat endpoint alone is not sufficient. Reuse
`SHIPGUARD_DIALOGUE_CONTROLLER` and the existing `validateController` result contract.

For the official protocol, see [TypeSafe HTTP API](https://docs.typesafe.ai/api). Typed values
are not proof of correctness; see [Jev limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).
These live references were consulted on 2026-09-27. No published model benchmark is reproduced here.

## Evidence and authority

Only the existing bounded, sanitized event view is eligible for transmission. The controller
must not collect transcripts, crawl a repository, read credentials from files, or invent missing
observations. A source excerpt supplied through `SHIPGUARD_DIALOGUE_CONTEXT` remains a source
claim, not proof of human acceptance or a receipt of actual tool execution.

Candidate passages come from exact supplied text. Code owns their identifiers, validates the
returned question/type/option, and maps a selected concern to a bounded template. Jev cannot
write a quotation, grant permission or claim that an unobserved action happened.

Missing, redacted or truncated required context means `unknown`. Invalid provider responses,
timeouts and transport failures mean `unavailable`. Neither state means verified. A low concern
score is not a success certificate. Any proposed contradiction remains a semantic suspicion.

## Proposed default and correction modes

The proposed adapter is advisory by default. A possible contradiction can be reported without
requesting another agent turn. An additional explicit correction opt-in may return an existing
`finding`, retaining source passages and the host's one-correction limit. It must never change
tool arguments, tool results, permissions, mission scope or persistent settings.

## Verification boundary

For implementation, use the existing dependency-free Node smoke-test convention. Cover
request/response mapping, exact passages, missing evidence, invalid options/types/probabilities,
timeout, no retry, redirect refusal, no default network call, and the existing hook's correction
recursion guard. Use only in-process or loopback HTTP fixtures. Protocol tests would not prove
live model quality, actual host activation, safety, latency savings or useful error detection.
No tests or live model calls were run for this documentation-only change.

Merge and live activation are separate decisions. A provider endpoint, model and transmission
scope must be explicitly selected before a live call; no fallback provider is allowed.

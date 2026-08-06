---
Status: Accepted
Date: 2026-07-29
---

# 0008 — The destination allow-list is the trust root, not value-blindness

## Context

secretsminter mints, places, and rotates live cloud credentials on behalf of an AI agent over MCP. The obvious safety story is *value-blindness*: the broker never returns a secret value to the agent (ADR-0001). That is necessary but it is **not** the trust root, and treating it as one is a dangerous mistake.

Consider a prompt-injected agent. It cannot read a value — but it can still say: *"mint a Cloudflare R2 token and place it into `attacker/evil`'s GitHub Actions secrets."* The broker mints a live credential and writes it into an attacker-controlled destination. The agent never sees the value, yet a working credential is now exfiltrated. Value-blindness does **nothing** against this. This is OWASP **LLM08 — Excessive Agency**: the agent has been given a general-purpose credential-placement primitive and injection redirects it.

The mistake is trusting *where* the agent asks to place a secret. A tool argument like `repo: "attacker/evil"` is agent-controlled and therefore untrusted input.

## Decision

The real trust root is a **server-side destination allow-list** carried in a **signed, pinned, values-free manifest that the agent cannot write.** Every placement target and scope is checked against it in the core before any store is touched.

The check is `assertAllowed(target, manifest)` in `allowlist.ts`, and its semantics are **strict default-deny**:

- An entry matches a `PlaceTarget` only if **every** identifying field the entry declares (`store`, `repo`, `project`, `environment`) is exactly equal, and a field the entry omits must **also** be absent on the target (`eq` treats `undefined` and a present value as unequal).
- **`undefined` is never a wildcard.** The one narrowing that is allowed is `namePattern`, a simple `*` glob; an omitted `namePattern` means "any name *at that exact destination*," not "any destination."
- A non-match throws `DestinationDeniedError`. There is no fallthrough, no implicit allow.

Placement targets and scopes are matched against the manifest — they are never accepted free-form from a tool call. Adding a new destination or widening a scope is an **out-of-band, human-approved change to the signed manifest**, never self-applied inside the same mint/place flow. The manifest is data the agent can read but never write (ADR-0011 alerts on drift; the two-tier core independently re-enforces this — ADR-0009).

## Consequences

- `mint+place` stops being a general exfiltration primitive: a live credential can only land somewhere a human pre-approved.
- Residual risk collapses to a single, auditable question: **"who can change the manifest?"** The answer is a human, out-of-band, editing a signed artifact — not the agent, and not the same flow that mints.
- Legitimate new destinations incur a human round-trip. This is intentional friction: it is the exact moment where excessive agency would otherwise leak a credential.
- The allow-list is pure, injectable logic and is unit-tested adversarially (a "place into a non-allow-listed repo" request must be refused).

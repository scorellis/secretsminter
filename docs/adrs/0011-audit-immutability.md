---
Status: Accepted
Date: 2026-07-29
---

# 0011 — Audit immutability

## Context

secretsminter mints and places live credentials unattended. When something goes wrong — an out-of-band mint, a placement into an unexpected destination, a compromised broker — the audit log is the only record of what actually happened. That makes the audit log itself a target. Three failure modes must be designed out:

1. **A tampered log.** An attacker who compromises the broker rewrites history to hide the exfiltration.
2. **A leaky log.** The audit becomes a second copy of every secret value it was meant to protect.
3. **A silent log.** High-privilege actions happen and nobody is told until it is too late; credentials exist at a provider that the manifest never authorized.

## Decision

**Hash-chained entries.** Each audit entry includes the hash of the prior entry, so the log is tamper-**evident**: altering or deleting any entry breaks the chain from that point forward and is detectable on verification. History cannot be silently rewritten, only visibly broken.

**Written to an external store with separate credentials.** The audit sink uses credentials distinct from the broker's minting keys, and lives outside the broker's own control plane. A broker compromise therefore cannot rewrite its own history — the attacker would additionally need the separate audit credential, which the broker does not use for anything else. (That audit-writer credential is itself a broker dependency and so is un-rotatable by the broker — ADR-0010 self-lockout.)

**Value-free entries.** An entry records `name` / `provider` / `scope` / `destination` and a **truncated keyed fingerprint** of the material via `auditFingerprint` in `crypto.ts` — an HMAC-SHA-256 over the value, sliced to 12 hex chars, keyed so fingerprints are **not comparable across installs**. The fingerprint lets two rotations of the same logical secret be correlated **without ever storing the value.** The audit obeys the same value-blindness discipline as the tool boundary (ADR-0001): it never holds a live secret.

**Out-of-band alerting on every high-privilege mint.** A token placed into a repo, a new provider credential minted — each fires an alert on a channel the agent cannot reach or suppress ("a token was placed into repo X"). Injection cannot self-silence what it cannot address.

**Periodic reconciliation / drift pass.** A recurring sweep compares what exists at each provider against the signed manifest. A token that exists at the provider but is **not** in the manifest signals an out-of-band mint or a compromise, and alerts. This closes the gap where an attacker mints *directly* at the provider, bypassing the broker entirely.

## Consequences

- The audit is trustworthy after a broker compromise: it may be broken (visibly) but not silently rewritten, and it never surrenders a secret value to whoever reads it.
- Detection does not depend on the broker being honest — reconciliation catches provider-side state the broker never recorded.
- Operators must provision and guard a **separate** audit credential and an alert channel; the design is only as strong as that separation.
- Fingerprints are deliberately non-reversible and install-scoped, so cross-install correlation of secrets is impossible by construction — a privacy property, at the cost of cross-install analytics.

---
Story: 0016
Status: active — NOT BUILT
---

# 0016 — Single-use approvals + rate limit / circuit breaker

**NOT BUILT.** An approval today authorizes an action hash until it **expires**, and the same approved
action can be requested **repeatedly** within that window — there is no single-use consumption and no
rate limit or circuit breaker on mutating tools. Within the operator's expiry window a prompt-injected
agent can replay an identical approved action arbitrarily (churn / DoS / repeated mint). The
`approvalNonce` field that previously hinted at this was decorative and has been removed from the tool
surface; this story builds the real control.

## Goal
An approval authorizes **exactly one execution**, and mutating tools are bounded by a rate limit /
circuit breaker so a compromised agent cannot churn even approved actions.

## Tasks
- Make the approval gate **consume** an approval on first successful use (single-use), keyed by the
  action hash, with the out-of-band store as the source of truth.
- Add a per-tool / per-destination **rate limit** and a **circuit breaker** that trips on a burst of
  failures or an anomalous mint rate, failing closed.
- Emit an alert when the breaker trips.
- Tests: a replay of a consumed approval is refused; a burst past the limit is refused with a safe
  reason code.

## Done when
- A second execution of the same approved action is refused (approval consumed).
- A burst of mutating calls past the configured limit trips the breaker and is refused, with an alert.

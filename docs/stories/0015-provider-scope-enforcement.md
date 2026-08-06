---
Story: 0015
Status: active — NOT BUILT
---

# 0015 — Enforce requested scopes at the providers

**NOT BUILT.** The signed manifest pins **destinations**, and a request may carry `scopes`, but those
scopes are **recorded, not enforced**: a minted credential currently carries the bootstrap's scope.
Concretely — Cloudflare hardcodes `permission: "object-read-write"` (`cloudflare.ts`), GitHub hands out
the installation's full permissions (`github.ts`), and Supabase ignores scopes (`supabase.ts`). So
"scope-limited minting" is not yet true.

## Goal
Make a minted credential carry **exactly the least privilege the request (and manifest) allow**, refusing
a request whose scopes exceed what the manifest permits for that destination.

## Tasks
- Add per-destination allowed-scope sets to the manifest schema (allow-list entries gain an optional
  `scopes` bound); default-deny anything broader.
- Cloudflare: map requested scopes to the R2 temp-credentials `permission` (e.g. read-only vs
  read-write) instead of the hardcoded constant.
- GitHub: request a **scoped** installation token (per-repository, per-permission) rather than the full
  installation permission set.
- Supabase: apply the requested key type/role where the Management API allows.
- Reject at the core (before any provider call) a request whose scopes exceed the manifest bound.

## Done when
- A request for a broader scope than the manifest allows is refused with a safe reason code, before any
  network call.
- Each provider mints a credential whose actual privilege matches the requested (and allowed) scope,
  proven in a unit test against the fake and re-checked at the next live run.

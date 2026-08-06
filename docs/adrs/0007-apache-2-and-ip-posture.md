# 0007 — Apache-2.0 license and IP posture

Status: Accepted
Date: 2026-07-29

## Context

secretsminter is a public, community-oriented security tool operating in a patent-active space (secrets management, credential brokering, agent tooling). Two questions had to be settled before publishing: which license, and whether there is patent risk in shipping the mechanism openly under the `secretsminter` name. A permissive vs. copyleft choice affects adoption and contribution; the patent-grant question matters specifically because a security primitive that others integrate into pipelines needs to come with clear, defensible patent terms rather than an implicit license.

## Decision

**License: Apache-2.0.** It is permissive (maximizing adoption and downstream integration for an infrastructure tool) and, decisively, carries an **explicit patent grant and a patent-retaliation clause** — the right properties for a security tool in a patent-active space. MIT/BSD would be permissive but silent on patents; Apache-2.0 gives contributors and users an express grant, which is the responsible default here.

**IP posture (record of the preliminary scan — not legal advice):**

- A name/IP scan found **LOW patent risk** and no blocking patent. The name `secretsminter` is an unused string across npm, crates, the GitHub org namespace, and common TLDs — chosen partly for supply-chain trust and typosquat resistance, which matter for a security package.
- **Prior art is dense**, which lowers the odds of a novel blocking patent: HashiCorp Vault dynamic secrets and the official Vault MCP; Infisical "Agent Vault"; `The-17/agentsecrets` (the closest twin — zero-knowledge, MCP-native, no `get()`); `RachidChabane/mcp-secrets-vault`; and the **CB4A IETF draft** (`draft-hartman-credential-broker-4-agents`), whose broker/agent separation the two-tier isolation (ADR-0009) mirrors.
- secretsminter's wedge is not "the agent never sees secrets" (now table stakes) but **AI-provisioned, self-maintaining secret infrastructure** — mint + place + self-maintaining rotation as a provisioning primitive.

## Consequences

**A full attorney freedom-to-operate (FTO) analysis is NOT required to publish the OSS project** under Apache-2.0, given the LOW-risk finding and dense prior art. It **IS warranted before** any of: commercializing, building a brand around the name, or raising funding. Before a brand/funding commitment, also verify domain WHOIS and a USPTO/TESS trademark search, and defensively register near-miss package names. The scan is preliminary and explicitly not a substitute for counsel; this ADR records the basis for the publish-now decision and the trigger conditions for escalating to a formal FTO.

import { describe, expect, it } from "vitest";
import {
  allowlistMatch,
  assertAllowed,
  DestinationDeniedError,
  type Manifest,
} from "../src/allowlist.js";
import type { PlaceTarget } from "../src/types.js";

const manifest: Manifest = {
  version: 1,
  allow: [
    { store: "github-actions", repo: "acme/api" },
    { store: "github-actions", repo: "acme/web", namePattern: "R2_*" },
    { store: "cloudflare-pages", project: "acme-site", environment: "production" },
  ],
};

function target(over: Partial<PlaceTarget>): PlaceTarget {
  return { store: "github-actions", repo: "acme/api", name: "ANY_SECRET", ...over };
}

describe("destination allow-list (the trust root)", () => {
  it("allows an exact allow-listed repo, any secret name", () => {
    expect(allowlistMatch(target({}), manifest)).toBe(true);
  });

  it("REFUSES an attacker-controlled repo — the exfiltration primitive the review named", () => {
    const evil = target({ repo: "attacker/evil", name: "R2_TOKEN" });
    expect(allowlistMatch(evil, manifest)).toBe(false);
    expect(() => assertAllowed(evil, manifest)).toThrow(DestinationDeniedError);
  });

  it("enforces the name pattern where one is declared", () => {
    expect(allowlistMatch(target({ repo: "acme/web", name: "R2_ACCESS_KEY_ID" }), manifest)).toBe(true);
    expect(allowlistMatch(target({ repo: "acme/web", name: "AWS_ROOT_KEY" }), manifest)).toBe(false);
  });

  it("default-deny: an omitted entry field is not a wildcard", () => {
    // cloudflare-pages entry requires environment=production; a different env must not match
    const staging: PlaceTarget = {
      store: "cloudflare-pages",
      project: "acme-site",
      environment: "staging",
      name: "SUPABASE_URL",
    };
    expect(allowlistMatch(staging, manifest)).toBe(false);
  });

  it("does not cross stores", () => {
    const wrongStore = target({ store: "cloudflare-pages", repo: undefined, project: "acme-site" });
    expect(allowlistMatch(wrongStore, manifest)).toBe(false);
  });
});

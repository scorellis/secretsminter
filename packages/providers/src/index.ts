/**
 * @secretsminter/providers — vendor plugins.
 *
 * Every cloud provider here has a real network path (mint/place/rotate/revoke/verify) — none is a stub.
 * Their live-run status varies and is tracked per story (docs/stories/): Cloudflare R2 mint is
 * live-verified (0003) and Cloudflare Pages placement has had a live run (0013); the GitHub (0004)
 * and Supabase (0005) paths are exercised against fakes in unit tests but not yet run against the real
 * vendor. The pure derivations these providers rely on (e.g. the R2 S3-secret derivation) are tested
 * in @secretsminter/core.
 *
 * The `LocalSecretProvider` (0020) is the exception by design: it has NO network path — it mints
 * app-level random secrets locally with the CSPRNG, needs no bootstrap credential, and is always
 * available.
 */

export { CloudflareProvider, r2S3Credentials } from "./cloudflare.js";
export { CloudflarePagesStore, type RedeployHook, type CloudflarePagesConfig } from "./cloudflare-pages.js";
export {
  githubWorkflowDispatchHook,
  githubWorkflowDispatchHookFromEnv,
  type GithubWorkflowDispatchConfig,
} from "./redeploy-hooks.js";
export { GithubProvider, GithubActionsStore, makeAppJwt } from "./github.js";
export { SupabaseProvider } from "./supabase.js";
export { LocalSecretProvider } from "./local-secret.js";

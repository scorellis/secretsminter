/**
 * @secretsminter/daemon — the composition root. Assembles the key-holding broker (core) with providers,
 * stores, durable state, out-of-band controls, and sinks from config, and runs the rotation loop. This
 * is the deployable service an operator stands up to run their own secretsminter. It stores no secrets and
 * has no CI of its own; bootstraps are injected at runtime.
 */

export { configFromEnv, type DaemonConfig } from "./config.js";
export { buildBroker, defaultIo, type AssembledBroker, type DaemonIo } from "./build.js";
export { startRotationLoop } from "./loop.js";

/**
 * The scheduler — the clock behind the self-maintaining loop (docs/adrs/0013, story 0009).
 *
 * The broker owns the schedule (it holds the keys and is the only thing that can mint), so the clock
 * lives here rather than in an external cron. `runScheduledRotations` on the broker is the per-tick
 * work; a `Scheduler` just decides *when* to call it.
 *
 * Two-tier cadence (ADR-0013): long-lived placed secrets rotate on a cadence set at mint time;
 * ephemeral credentials self-expire and are never scheduled. v1 ships `InProcessScheduler`; a
 * Durable-Object-alarm scheduler for a Worker deployment is future work.
 */

export interface Scheduler {
  start(): void;
  stop(): void;
}

/**
 * Calls `tick` every `intervalMs` using `setInterval`. Thin by design — all the real work (find due
 * secrets, rotate through the full gate) is in the injected `tick`, which is fully unit-tested on the
 * broker. Overlapping ticks are suppressed: if a tick is still running when the next fires, it is
 * skipped rather than run concurrently.
 */
export class InProcessScheduler implements Scheduler {
  #timer: ReturnType<typeof setInterval> | null = null;
  #running = false;
  readonly #tick: () => void | Promise<void>;
  readonly #intervalMs: number;
  readonly #keepAlive: boolean;

  /**
   * @param keepAlive when true, the timer keeps the process alive (a long-running daemon wants this so
   *   the rotation loop keeps a container running). When false (default), the timer is `unref`'d so it
   *   never holds a process open on its own — the right choice for tests and short-lived tools.
   */
  constructor(tick: () => void | Promise<void>, intervalMs: number, keepAlive = false) {
    this.#tick = tick;
    this.#intervalMs = intervalMs;
    this.#keepAlive = keepAlive;
  }

  start(): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => {
      void this.#runOnce();
    }, this.#intervalMs);
    if (!this.#keepAlive) {
      const t = this.#timer as { unref?: () => void };
      if (typeof t.unref === "function") t.unref();
    }
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async #runOnce(): Promise<void> {
    if (this.#running) return; // suppress overlapping ticks
    this.#running = true;
    try {
      await this.#tick();
    } catch {
      /* a tick must never throw out of the timer; failures surface via the broker's alert sink */
    } finally {
      this.#running = false;
    }
  }
}

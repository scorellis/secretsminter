/**
 * The rotation loop — the "walk away and it keeps working" heartbeat. Ticks the broker's scheduled
 * rotations on an interval; each due secret rotates through the full gate (kill switch, approval,
 * NEVER_ROTATE, self-lockout) and reschedules. Overlapping ticks are suppressed by the scheduler.
 */

import { InProcessScheduler, type Broker, type Scheduler } from "@secretsminter/core";

export function startRotationLoop(broker: Broker, intervalMs: number): Scheduler {
  // keepAlive: true — the daemon is long-running; the loop must keep the container/process alive.
  const scheduler = new InProcessScheduler(
    async () => {
      await broker.runScheduledRotations();
    },
    intervalMs,
    true,
  );
  scheduler.start();
  return scheduler;
}

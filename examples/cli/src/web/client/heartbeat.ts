/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** How often the page asks the CLI whether it is still there. */
export const HEARTBEAT_MS = 1000;

/**
 * How long one probe may take before it counts as a miss.
 *
 * Longer than the interval, because a busy CLI answering slowly is still
 * alive — but bounded, or a probe against a half-open socket never settles and
 * the page waits on it forever while showing controls that cannot work.
 */
export const HEARTBEAT_TIMEOUT_MS = 2500;

export interface CliLiveness {
  /** The CLI answered its last probe. Everything that talks to it is gated on this. */
  readonly online: boolean;
  /** `startedAt` of the process that last answered, or undefined before the first. */
  readonly startedAt: number | undefined;
  /**
   * The CLI answered, but it is a DIFFERENT process than the one this page was
   * talking to. It is reachable, and it remembers none of the runs on screen.
   */
  readonly restarted: boolean;
}

export const INITIAL_LIVENESS: CliLiveness = {
  // Assumed alive until a probe says otherwise: the page is served BY the CLI,
  // so it was reachable a moment ago, and disabling everything for the first
  // second of every page load would be its own kind of wrong.
  online: true,
  startedAt: undefined,
  restarted: false,
};

/**
 * Folds one probe result into the liveness state.
 *
 * Pure, so the rule that matters — what counts as a restart — can be tested
 * without a server or a timer.
 */
export function reduceHeartbeat(
  previous: CliLiveness,
  probe: { readonly ok: boolean; readonly startedAt?: number | undefined }
): CliLiveness {
  if (!probe.ok) {
    // The identity of the process we were talking to is kept: coming back with
    // the SAME `startedAt` is a paused CLI, and its runs are still there.
    return { online: false, startedAt: previous.startedAt, restarted: previous.restarted };
  }

  const startedAt = probe.startedAt;
  if (startedAt === undefined) {
    return { online: true, startedAt: previous.startedAt, restarted: previous.restarted };
  }
  // A first answer establishes identity rather than reporting a restart — the
  // page has nothing older to have been talking to.
  if (previous.startedAt === undefined) return { online: true, startedAt, restarted: false };
  if (previous.startedAt === startedAt) {
    return { online: true, startedAt, restarted: previous.restarted };
  }
  return { online: true, startedAt, restarted: true };
}

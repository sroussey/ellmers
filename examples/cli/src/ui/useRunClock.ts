/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";

const TICK_MS = 250;

/**
 * Wall-clock for the run as a whole, from the moment the UI mounted — which is
 * the moment the run started, since mounting is what starts it.
 *
 * Deliberately not derived from task timestamps the way a row's duration is. A
 * graph whose first task has not started yet, or whose tasks are all waiting on
 * a rate limiter, has no task clock running and yet the operator has plainly
 * been waiting; a footer that reads `0:00` for the first twenty seconds of a
 * queued run is answering a question nobody asked.
 *
 * Freezes the instant the run settles, so the finished frame reports how long
 * the run took rather than how long the terminal has been open.
 */
export function useRunClock(running: boolean): number {
  const startRef = useRef<number | undefined>(undefined);
  startRef.current ??= Date.now();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const start = startRef.current ?? Date.now();
    const read = (): void => setElapsedMs(Date.now() - start);
    read();
    if (!running) return;
    const id = setInterval(read, TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  return elapsedMs;
}

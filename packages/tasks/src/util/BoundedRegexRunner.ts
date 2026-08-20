/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Seam for running a single regex against a single value.
 *
 * The shape screen in `regexSafety.ts` is a heuristic, not a decision
 * procedure — `^(a?b?)*$` passes it and still backtracks catastrophically. What
 * contains that is a wall-clock budget at match time, which needs a `vm` and so
 * cannot live in the browser build. The Node/Bun/Electron entrypoints register
 * the bounded implementation (see `BoundedRegex.server.ts`); the browser default
 * matches unbounded, where a hostile pattern blocks that tab rather than the
 * process hosting a local API.
 */

/** Runs one compiled regex against one value. */
export interface RegexRunner {
  /**
   * The full match followed by its capture groups, or `undefined` when the
   * pattern did not match. An unmatched optional group stays `undefined` in
   * place rather than being dropped, so group indices keep their meaning.
   */
  readonly exec: (value: string) => (string | undefined)[] | undefined;
  /** Every non-empty full match, for a regex carrying the `g` flag. */
  readonly execAll: (value: string) => string[];
}

export type RegexRunnerFactory = (regex: RegExp) => RegexRunner;

/** Advances past a zero-length match so the scan cannot stall on it. */
function execAllUnbounded(regex: RegExp, value: string): string[] {
  const matches: string[] = [];
  regex.lastIndex = 0;
  let result = regex.exec(value);
  while (result !== null) {
    if (result[0].length === 0) {
      regex.lastIndex++;
    } else {
      matches.push(result[0]);
    }
    if (!regex.global) break;
    result = regex.exec(value);
  }
  return matches;
}

/** Plain, unbounded matching on the calling thread. */
export const defaultRegexRunnerFactory: RegexRunnerFactory = (regex) => ({
  exec: (value) => {
    regex.lastIndex = 0;
    const result = regex.exec(value);
    return result === null ? undefined : (result.slice(0) as (string | undefined)[]);
  },
  execAll: (value) => execAllUnbounded(regex, value),
});

let currentFactory: RegexRunnerFactory = defaultRegexRunnerFactory;

/**
 * Register a platform-specific runner factory. The Node/Bun entrypoints call
 * this at module load time to install the budgeted implementation from
 * `BoundedRegex.server.ts`.
 *
 * Returns the previously registered factory so callers can safely restore it
 * after a temporary override.
 */
export function registerRegexRunnerFactory(fn: RegexRunnerFactory): RegexRunnerFactory {
  const previousFactory = currentFactory;
  currentFactory = fn;
  return previousFactory;
}

export function getRegexRunnerFactory(): RegexRunnerFactory {
  return currentFactory;
}

/** Restores the default unbounded implementation. */
export function resetRegexRunnerFactory(): void {
  currentFactory = defaultRegexRunnerFactory;
}

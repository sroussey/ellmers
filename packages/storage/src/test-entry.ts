/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test-only surface for `@workglow/storage`.
 *
 * The connection-mutex reset hooks live here rather than on `.` because they
 * are test scaffolding, not API: `__resetAlsForTesting` tears down the process
 * -wide `AsyncLocalStorage` singleton and `isSynchronousAls` reports which
 * implementation is installed. Shipping them on the public entry made them
 * things the package has to keep working for consumers who should never call
 * them.
 *
 * Everything here is re-exported from the PUBLIC entry's {@link _internal} bag
 * rather than imported relatively, and that is load-bearing. This file is built
 * with `--packages=external`, so a relative `./tabular/ConnectionMutex.server`
 * would be INLINED into this bundle — a second `defineConnectionMutex` closure
 * with its own handle states and its own ALS. Tests would then reset one mutex
 * and exercise another, and nothing would fail loudly. Going through the
 * package specifier keeps the import external, so both entries resolve to the
 * one instance.
 *
 * Nothing here is public API.
 */

import { _internal } from "@workglow/storage";

/**
 * Drops the installed ALS so the next call re-creates it. Pass `true` to
 * install the synchronous shim in place of `node:async_hooks`, which is how
 * the browser runtime's behaviour is exercised under Node.
 */
export const __resetAlsForTesting: (useShim?: boolean) => void = _internal.__resetAlsForTesting;

/** `true` when the installed ALS is the synchronous shim rather than a real one. */
export const isSynchronousAls: () => boolean = _internal.isSynchronousAls;

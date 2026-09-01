/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ensureAls, __resetAlsForTesting as resetAlsForTesting } from "./connectionAls.browser";
import { defineConnectionMutex } from "./defineConnectionMutex";

export { ConnectionReentryError } from "./defineConnectionMutex";

export const {
  runOnConnection,
  runInTransactionOnConnection,
  getAlsStore,
  isSynchronousAls,
  __resetAlsForTesting,
} = defineConnectionMutex({
  ensureAls,
  __resetAlsForTesting: resetAlsForTesting,
});

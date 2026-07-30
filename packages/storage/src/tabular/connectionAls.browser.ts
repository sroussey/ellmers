/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createShimAls, makeCachedAls } from "./connectionAls.shared";

export type { Als, AlsContext } from "./connectionAls.shared";

/**
 * Browser build: always the synchronous shim. Never touch `node:async_hooks`.
 */
export const { ensureAls, __resetAlsForTesting } = makeCachedAls(createShimAls);

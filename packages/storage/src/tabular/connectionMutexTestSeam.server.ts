/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { __resetAlsForTesting, isSynchronousAls } from "./ConnectionMutex.server";
import type { ConnectionMutexTestSeam } from "./connectionMutexTestSeam.shared";

/** @internal — test seam, re-exported by `@workglow/storage/test`. Not API. */
export const _internal: ConnectionMutexTestSeam = { __resetAlsForTesting, isSynchronousAls };

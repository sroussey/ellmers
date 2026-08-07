/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test-only surface for `@workglow/util`.
 *
 * Everything here is reached **through the package's own public entry** rather
 * than by importing the declaring module directly. That is load-bearing: each
 * entry is a separate `bun build --packages=external` bundle, so importing
 * `./media/texturePool.browser` here would give this bundle its own copy of that
 * module — two texture pools, two GPU-device caches, and a reset that resets the
 * wrong one. A bare-specifier self-import stays external and resolves to the same
 * instance the code under test uses.
 */

import { _utilMediaInternal } from "@workglow/util/media";

/** Drops the cached GPU device so the next request re-acquires one. */
export const resetGpuDeviceForTests: () => void = _utilMediaInternal.resetGpuDeviceForTests;

/** Empties the texture pool so pooled textures do not leak across tests. */
export const resetTexturePoolForTests: () => void = _utilMediaInternal.resetTexturePoolForTests;

/**
 * Logger for tests: quiet by default, console when `WORKGLOW_TEST_LOG`,
 * `LOGGER_LEVEL`, `DEV`, or GitHub Actions debug is set.
 *
 * Unlike the reset hooks above this is stateless with respect to the package's
 * own modules — it constructs loggers from the public entry rather than mutating
 * anything inside it — so it can live in this bundle outright.
 */
export { getTestingLogger, setTestingLogger } from "./testing/TestingLogger";

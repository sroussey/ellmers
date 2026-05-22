/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

export * from "./ai/common/Cactus_Constants";
export * from "./ai/common/Cactus_ModelCatalog";
export * from "./ai/common/Cactus_ModelSchema";
// Mutable runtime state lives on a globalThis-keyed singleton (see
// `Cactus_RuntimeState`). The `./ai` and `./ai-runtime` entry points are
// bundled separately; if each held its own module-level Map, reads on one
// bundle would not see writes from the other. Routing through the singleton
// keeps state consistent across bundles in the same realm.
export * from "./ai/CactusProvider";
export * from "./ai/CactusQueuedProvider";
export * from "./ai/registerCactus";

import { CactusQueuedProvider } from "./ai/CactusQueuedProvider";
import { CACTUS_RUN_FN_SPECS } from "./ai/common/Cactus_Capabilities";
import { CACTUS_RUN_FNS } from "./ai/common/Cactus_JobRunFns";
import { getCactusConfigJson, getCactusEngines } from "./ai/common/Cactus_Runtime";

/**
 * @internal Symbols exported only for use by `@workglow/test`. Not part of the stable public API.
 *
 * Test consumers should call `cactusEngines()` / `cactusConfigJson()` to obtain
 * the underlying Maps. Because runtime state is now backed by a
 * `globalThis`-keyed singleton, both the `./ai` and `./ai-runtime` bundles
 * observe the same Map identity — but accessing via functions also lets tests
 * call `__resetRuntimeForTests()` between specs without stale captures.
 */
export const _testOnly = {
  CactusQueuedProvider,
  CACTUS_RUN_FN_SPECS,
  CACTUS_RUN_FNS,
  cactusEngines: getCactusEngines,
  cactusConfigJson: getCactusConfigJson,
} as const;

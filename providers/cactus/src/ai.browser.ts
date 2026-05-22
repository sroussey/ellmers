/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

export * from "./ai/common/Cactus_Constants";
export * from "./ai/common/Cactus_ModelCatalog";
export * from "./ai/common/Cactus_ModelSchema";
// Mutable runtime state (e.g. cactusEngines, cactusEngineLoadsInFlight,
// cactusConfigJson, cactusSessions) is intentionally NOT re-exported here.
// The `./ai` and `./ai-runtime` entry points are bundled separately, so
// re-exporting from both creates two distinct module instances — and reads
// on one would not see writes from the other. Import runtime state from
// `@workglow/cactus/ai-runtime` instead.
export * from "./ai/CactusProvider";
export * from "./ai/CactusQueuedProvider";
export * from "./ai/registerCactus";

import { CactusQueuedProvider } from "./ai/CactusQueuedProvider";
import { CACTUS_RUN_FN_SPECS } from "./ai/common/Cactus_Capabilities";
import { CACTUS_RUN_FNS } from "./ai/common/Cactus_JobRunFns";
import { cactusConfigJson, cactusEngines } from "./ai/common/Cactus_Runtime.browser";

/**
 * @internal Symbols exported only for use by `@workglow/test`. Not part of the stable public API.
 *
 * `cactusEngines` and `cactusConfigJson` are re-exported here so that tests can
 * seed and inspect the runtime state used by the run-fns bundled into the `./ai`
 * entry point. The `./ai` and `./ai-runtime` entry points are bundled separately
 * — their copies of `Cactus_Runtime.ts` are distinct module instances. Reading
 * the runtime state via `_testOnly` (rather than `@workglow/cactus/ai-runtime`)
 * guarantees the test observes the same Map that the run-fns mutate.
 */
export const _testOnly = {
  CactusQueuedProvider,
  CACTUS_RUN_FN_SPECS,
  CACTUS_RUN_FNS,
  cactusEngines,
  cactusConfigJson,
} as const;

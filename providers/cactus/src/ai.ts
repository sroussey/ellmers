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
export * from "./ai/registerCactus";

import { CactusQueuedProvider } from "./ai/CactusQueuedProvider";
import {
  CACTUS_HASH_PLACEHOLDER,
  CactusIntegrityError,
  isHashPlaceholder,
  sha256Hex,
  verifySha256,
} from "./ai/common/Cactus_Integrity";
import { CACTUS_RUN_FNS } from "./ai/common/Cactus_JobRunFns";
import { cactusConfigJson, cactusEngines } from "./ai/common/Cactus_Runtime";

/**
 * @internal Symbols exported only for use by `@workglow/test`. Not part of the stable public API.
 *
 * `cactusEngines` and `cactusConfigJson` are re-exported here so that tests can
 * seed and inspect the runtime state used by the run-fns bundled into the `./ai`
 * entry point. The `./ai` and `./ai-runtime` entry points are bundled separately
 * — their copies of `Cactus_Runtime.ts` are distinct module instances. Reading
 * the runtime state via `_testOnly` (rather than `@workglow/cactus/ai-runtime`)
 * guarantees the test observes the same Map that the run-fns mutate.
 *
 * The `Cactus_Integrity` symbols (sha256Hex, verifySha256, CactusIntegrityError,
 * isHashPlaceholder, CACTUS_HASH_PLACEHOLDER) are pure/stateless helpers exposed
 * here for unit testing only. They are not part of the stable public API; depend
 * on the catalog's `sha256` field instead.
 */
export const _testOnly = {
  CactusQueuedProvider,
  CACTUS_RUN_FNS,
  cactusEngines,
  cactusConfigJson,
  CACTUS_HASH_PLACEHOLDER,
  CactusIntegrityError,
  isHashPlaceholder,
  sha256Hex,
  verifySha256,
} as const;

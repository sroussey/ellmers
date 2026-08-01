/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker server and main-thread inline TensorFlow MediaPipe registration (pulls in `TFMP_JobRunFns`),
 * plus MediaPipe SDK loaders (`TFMP_Client`).
 * Import from `@workglow/tf-mediapipe/ai-runtime` — not from the main `tf-mediapipe` barrel.
 *
 * Use `export *` (not `export { … } from "…"`) so the Bun bundler keeps the module graph.
 */
// organize-imports-ignore

export * from "./common/TFMP_Client";
export * from "./registerTensorFlowMediaPipeInline";
export * from "./registerTensorFlowMediaPipeWorker";

// The fileset base URLs are module-level state in whichever bundle resolves
// them, and this entry is the only one that does (both inline and worker
// registration pull their run-fns from here). So the override must be set
// through THIS entry — a `./ai` import reaches a different copy of the module,
// and a main-thread override never crosses the worker boundary either.
//
// Named re-export rather than `export *` on purpose: TFMP_Runtime's remaining
// exports (`wasm_tasks`, `getWasmTask`, `modelTaskCache`, …) are internals. The
// module graph is retained regardless, because the run-fns re-exported above
// already import it.
export type { ITFMPWasmBaseUrls } from "./common/TFMP_Runtime";
export {
  getTfmpWasmBaseUrls,
  resetTfmpWasmBaseUrls,
  setTfmpWasmBaseUrls,
} from "./common/TFMP_Runtime";

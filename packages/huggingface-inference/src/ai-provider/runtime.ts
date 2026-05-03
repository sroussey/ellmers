/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker server and main-thread inline Hugging Face Inference registration (pulls in `HFI_JobRunFns`),
 * plus API client helpers (`HFI_Client`).
 * Import from `@workglow/ai-provider/hf-inference/runtime` — not from the main `hf-inference` barrel.
 *
 * Use `export *` (not `export { … } from "…"`) so the Bun bundler keeps the module graph.
 */
export * from "./common/HFI_Client";
export * from "./registerHfInferenceInline";
export * from "./registerHfInferenceWorker";

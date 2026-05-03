/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker server and main-thread inline Gemini registration (pulls in `Gemini_JobRunFns`),
 * plus SDK client helpers (`Gemini_Client`).
 * Import from `@workglow/ai-provider/gemini/runtime` — not from the main `gemini` barrel.
 *
 * Use `export *` (not `export { … } from "…"`) so the Bun bundler keeps the module graph.
 */
export * from "./common/Gemini_Client";
export * from "./registerGeminiInline";
export * from "./registerGeminiWorker";

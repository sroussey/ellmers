/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker server and main-thread inline xAI registration (pulls in `Xai_JobRunFns`),
 * plus SDK client helpers (`Xai_Client`).
 * Import from `@workglow/xai/ai-runtime` — not from the main `xai` barrel.
 *
 * Use `export *` (not `export { … } from "…"`) so the Bun bundler keeps the module graph.
 */
// organize-imports-ignore

export * from "./common/Xai_Client";
export * from "./common/Xai_EffortPolicy";
export * from "./registerXaiInline";
export * from "./registerXaiWorker";

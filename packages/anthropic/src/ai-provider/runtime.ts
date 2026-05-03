/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker server and main-thread inline Anthropic registration (pulls in `Anthropic_JobRunFns`),
 * plus SDK client helpers (`Anthropic_Client`).
 * Import from `@workglow/ai-provider/anthropic/runtime` — not from the main `anthropic` barrel.
 *
 * Use `export *` (not `export { … } from "…"`) so the Bun bundler keeps the module graph.
 */
export * from "./common/Anthropic_Client";
export * from "./registerAnthropicInline";
export * from "./registerAnthropicWorker";

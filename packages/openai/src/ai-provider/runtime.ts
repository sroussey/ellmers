/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker server and main-thread inline OpenAI registration (pulls in `OpenAI_JobRunFns`),
 * plus SDK client helpers (`OpenAI_Client`).
 * Import from `@workglow/ai-provider/openai/runtime` — not from the main `openai` barrel.
 *
 * Use `export *` (not `export { … } from "…"`) so the Bun bundler keeps the module graph.
 */
export * from "./common/OpenAI_Client";
export * from "./registerOpenAiInline";
export * from "./registerOpenAiWorker";

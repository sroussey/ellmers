/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Browser build for OpenAI runtime registration (uses `js-tiktoken` instead of WASM `tiktoken`).
 * Import from `@workglow/openai/ai-provider-runtime` — not from the main `openai` barrel.
 *
 * Use `export *` (not `export { … } from "…"`) so the Bun bundler keeps the module graph.
 */
export * from "./common/OpenAI_Client";
export * from "./registerOpenAiInline.browser";
export * from "./registerOpenAiWorker.browser";

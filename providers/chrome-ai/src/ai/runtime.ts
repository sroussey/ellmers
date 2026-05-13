/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worker server and main-thread inline WebBrowser provider registration (pulls in `WebBrowser_JobRunFns`).
 * Import from `@workglow/chrome-ai/ai-runtime` — not from the main `chrome-ai` barrel.
 *
 * Use `export *` (not `export { … } from "…"`) so the Bun bundler keeps the module graph.
 */
// organize-imports-ignore

export * from "./registerWebBrowserInline";
export * from "./registerWebBrowserWorker";

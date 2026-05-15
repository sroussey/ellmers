/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DisposeStrategy, type IDisposeStrategy } from "@workglow/util";

/**
 * Suggested default dispose strategy for AI-heavy hosts.
 *
 * AI *local* models (node-llama-cpp, transformers.js, Ollama-local) live in
 * a global registry, not in a scope. Cloud providers (Anthropic, OpenAI,
 * Gemini) hold no disposable state. So the AI package itself has nothing
 * scope-managed to clean up — `never` is the right default.
 */
export const aiDisposeStrategy = (): IDisposeStrategy => DisposeStrategy.never();

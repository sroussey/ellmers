/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

/// <reference types="dom-chromium-ai" />
// The Chrome built-in AI globals (LanguageModel, Summarizer, Rewriter,
// Translator, LanguageDetector, Availability) are ambient, and this package
// reaches them through `types` in its own tsconfig — a compiler option no
// consumer can see. Stating the reference at the entry puts them in the
// program for anyone compiling this package from source too.

export * from "./ai/index";

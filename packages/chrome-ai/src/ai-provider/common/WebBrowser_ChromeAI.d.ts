/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ambient type declarations for Chrome Built-in AI APIs (Gemini Nano).
 * These APIs are browser globals available in Chrome 129+.
 *
 * @see https://developer.chrome.com/docs/ai/built-in-apis
 */

export type AIAvailability = "unavailable" | "downloadable" | "available";

// ---------------------------------------------------------------------------
// Summarizer API
// ---------------------------------------------------------------------------

interface AISummarizerCreateOptions {
  type?: "tl;dr" | "key-points" | "teaser" | "headline";
  length?: "short" | "medium" | "long";
  format?: "plain-text" | "markdown";
  sharedContext?: string;
  signal?: AbortSignal;
}

interface AISummarizer {
  summarize(input: string, options?: { signal?: AbortSignal; context?: string }): Promise<string>;
  summarizeStreaming(
    input: string,
    options?: { signal?: AbortSignal; context?: string }
  ): ReadableStream<string>;
  destroy(): void;
}

interface AISummarizerFactory {
  availability(): Promise<AIAvailability>;
  create(options?: AISummarizerCreateOptions): Promise<AISummarizer>;
}

// ---------------------------------------------------------------------------
// Language Detector API
// ---------------------------------------------------------------------------

interface AILanguageDetectorDetectResult {
  detectedLanguage: string;
  confidence: number;
}

interface AILanguageDetectorCreateOptions {
  signal?: AbortSignal;
}

interface AILanguageDetector {
  detect(
    input: string,
    options?: { signal?: AbortSignal }
  ): Promise<AILanguageDetectorDetectResult[]>;
  destroy(): void;
}

interface AILanguageDetectorFactory {
  availability(): Promise<AIAvailability>;
  create(options?: AILanguageDetectorCreateOptions): Promise<AILanguageDetector>;
}

// ---------------------------------------------------------------------------
// Translator API
// ---------------------------------------------------------------------------

interface AITranslatorCreateOptions {
  sourceLanguage: string;
  targetLanguage: string;
  signal?: AbortSignal;
}

interface AITranslator {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  translateStreaming(input: string, options?: { signal?: AbortSignal }): ReadableStream<string>;
  destroy(): void;
}

interface AITranslatorFactory {
  availability(options?: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<AIAvailability>;
  create(options: AITranslatorCreateOptions): Promise<AITranslator>;
}

// ---------------------------------------------------------------------------
// Language Model (Prompt API)
// ---------------------------------------------------------------------------

interface AILanguageModelCreateOptions {
  systemPrompt?: string;
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
}

interface AILanguageModel {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  promptStreaming(input: string, options?: { signal?: AbortSignal }): ReadableStream<string>;
  destroy(): void;
}

interface AILanguageModelFactory {
  availability(): Promise<AIAvailability>;
  create(options?: AILanguageModelCreateOptions): Promise<AILanguageModel>;
}

// ---------------------------------------------------------------------------
// Rewriter API
// ---------------------------------------------------------------------------

interface AIRewriterCreateOptions {
  tone?: "as-is" | "more-formal" | "more-casual";
  length?: "as-is" | "shorter" | "longer";
  format?: "as-is" | "plain-text" | "markdown";
  sharedContext?: string;
  signal?: AbortSignal;
}

interface AIRewriter {
  rewrite(input: string, options?: { signal?: AbortSignal; context?: string }): Promise<string>;
  rewriteStreaming(
    input: string,
    options?: { signal?: AbortSignal; context?: string }
  ): ReadableStream<string>;
  destroy(): void;
}

interface AIRewriterFactory {
  availability(): Promise<AIAvailability>;
  create(options?: AIRewriterCreateOptions): Promise<AIRewriter>;
}

// ---------------------------------------------------------------------------
// Global augmentations
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    readonly ai?: {
      readonly summarizer?: AISummarizerFactory;
      readonly languageDetector?: AILanguageDetectorFactory;
      readonly translator?: AITranslatorFactory;
      readonly languageModel?: AILanguageModelFactory;
      readonly rewriter?: AIRewriterFactory;
    };
  }

  const Summarizer: AISummarizerFactory | undefined;
  const LanguageDetector: AILanguageDetectorFactory | undefined;
  const Translator: AITranslatorFactory | undefined;
  const LanguageModel: AILanguageModelFactory | undefined;
  const Rewriter: AIRewriterFactory | undefined;
}

export {};

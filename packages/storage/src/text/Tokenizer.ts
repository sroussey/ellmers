/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pluggable tokenizer for text indexes. Implementations must be deterministic
 * and side-effect free: indexing and querying always pass through the same
 * tokenizer, so any non-determinism produces silent recall regressions.
 */
export interface Tokenizer {
  tokenize(input: string): string[];
}

/**
 * Default English stopwords. Exported so callers can extend (rather than
 * replace) the default list:
 *
 * ```ts
 * const stopwords = new Set([...DEFAULT_ENGLISH_STOPWORDS, "foo", "bar"]);
 * ```
 */
export const DEFAULT_ENGLISH_STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "he",
  "her",
  "hers",
  "him",
  "his",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "ours",
  "she",
  "so",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "they",
  "this",
  "to",
  "us",
  "was",
  "we",
  "were",
  "will",
  "with",
  "you",
  "your",
  "yours",
]);

export interface DefaultTokenizerOptions {
  readonly stopwords?: ReadonlySet<string>;
  readonly minTokenLength?: number;
}

/**
 * Default tokenizer: lowercase, split on Unicode non-letter/non-digit
 * characters, drop tokens shorter than `minTokenLength`, drop stopwords.
 *
 * No stemming. Identical at index and query time.
 */
export function createDefaultTokenizer(options: DefaultTokenizerOptions = {}): Tokenizer {
  const stopwords = options.stopwords ?? DEFAULT_ENGLISH_STOPWORDS;
  const minTokenLength = options.minTokenLength ?? 2;
  const splitter = /[^\p{L}\p{N}]+/u;

  return {
    tokenize(input: string): string[] {
      if (!input) return [];
      const out: string[] = [];
      for (const raw of input.toLowerCase().split(splitter)) {
        if (raw.length < minTokenLength) continue;
        if (stopwords.has(raw)) continue;
        out.push(raw);
      }
      return out;
    },
  };
}

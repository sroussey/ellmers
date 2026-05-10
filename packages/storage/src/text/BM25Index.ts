/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITextIndex, TextFields, TextSearchOptions, TextSearchResult } from "./ITextIndex";
import type { Tokenizer } from "./Tokenizer";
import { createDefaultTokenizer } from "./Tokenizer";

/**
 * Default per-field weights for {@link BM25Index} when indexing
 * {@link ChunkRecord}-shaped data. Tuned for hierarchical chunks — title and
 * section headings are heavier than the body to reflect their navigational
 * value, summaries are slightly above body, parent summaries are de-weighted
 * because they are inherited context rather than direct content.
 */
export const DEFAULT_CHUNK_FIELD_WEIGHTS: Readonly<Record<string, number>> = {
  doc_title: 3,
  sectionTitles: 2,
  summary: 1.5,
  text: 1,
  parentSummaries: 0.5,
};

export interface BM25IndexOptions {
  /** Tokenizer used at index- and query-time. Defaults to {@link createDefaultTokenizer}. */
  readonly tokenizer?: Tokenizer;
  /**
   * Per-field weight map. Fields not in this map are ignored at index time.
   * Defaults to {@link DEFAULT_CHUNK_FIELD_WEIGHTS}.
   */
  readonly fieldWeights?: Readonly<Record<string, number>>;
  /** BM25 term-saturation parameter. Typical values 1.2–2.0. */
  readonly k1?: number;
  /** BM25 length-normalisation parameter. Typical values 0.5–0.75. */
  readonly b?: number;
}

interface Posting {
  readonly chunkId: string;
  readonly tf: number;
}

interface SerialisedBM25State {
  readonly version: 1;
  readonly k1: number;
  readonly b: number;
  readonly fieldWeights: Record<string, number>;
  readonly fieldStats: Record<string, { docCount: number; totalLength: number }>;
  readonly postings: Record<string, Record<string, Array<{ chunkId: string; tf: number }>>>;
  readonly docLengths: Record<string, Record<string, number>>;
  readonly chunkToDoc: Record<string, string>;
}

/**
 * In-memory BM25F text index. State is JSON-serialisable via
 * {@link toJSON} / {@link fromJSON}. Field weights and tokenizer are *not*
 * serialised — the caller is responsible for restoring an index with the
 * same configuration as the one that produced the state.
 *
 * Scoring formula (Lucene-style BM25F):
 *
 * ```
 * idf(t)        = ln(1 + (N - df(t) + 0.5) / (df(t) + 0.5))
 * tilde_tf(t,d) = sum_f weight(f) * tf(t,d,f) / (1 - b + b * len_f(d) / avgLen_f)
 * score(t,d)    = idf(t) * tilde_tf(t,d) / (k1 + tilde_tf(t,d))
 * ```
 *
 * Document frequency `df(t)` is the number of distinct chunks containing `t`
 * in *any* field. `N` is the total number of chunks. `tf(t,d,f)` is raw
 * term frequency in field `f` of chunk `d`. `len_f(d)` is the field length
 * (token count) for that chunk, and `avgLen_f` is the average length over
 * chunks that have field `f` populated.
 */
export class BM25Index implements ITextIndex {
  private readonly tokenizer: Tokenizer;
  private fieldWeights: Record<string, number>;
  private readonly k1: number;
  private readonly b: number;

  // term -> field -> postings (one entry per chunk that has the term in the field).
  private postings = new Map<string, Map<string, Posting[]>>();

  // chunkId -> field -> length (token count, post-tokenisation).
  private docLengths = new Map<string, Map<string, number>>();

  // field -> { docCount, totalLength } — running stats over chunks that have the field populated.
  private fieldStats = new Map<string, { docCount: number; totalLength: number }>();

  // chunkId -> docId, for removeByDocument cascades.
  private chunkToDoc = new Map<string, string>();

  // docId -> Set<chunkId>, for fast cascade deletes.
  private docToChunks = new Map<string, Set<string>>();

  constructor(options: BM25IndexOptions = {}) {
    this.tokenizer = options.tokenizer ?? createDefaultTokenizer();
    this.fieldWeights = { ...(options.fieldWeights ?? DEFAULT_CHUNK_FIELD_WEIGHTS) };
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
  }

  size(): number {
    return this.docLengths.size;
  }

  add(chunkId: string, docId: string, fields: TextFields): void {
    if (this.docLengths.has(chunkId)) {
      this.remove(chunkId);
    }

    const perField = new Map<string, number>();
    let anyTokens = false;

    for (const [field, weight] of Object.entries(this.fieldWeights)) {
      if (weight <= 0) continue;
      const raw = fields[field];
      if (raw === undefined) continue;
      const text = Array.isArray(raw) ? raw.join(" ") : (raw as string);
      const tokens = this.tokenizer.tokenize(text);
      if (tokens.length === 0) continue;

      anyTokens = true;
      perField.set(field, tokens.length);

      const tfMap = new Map<string, number>();
      for (const term of tokens) {
        tfMap.set(term, (tfMap.get(term) ?? 0) + 1);
      }
      for (const [term, tf] of tfMap) {
        let byField = this.postings.get(term);
        if (!byField) {
          byField = new Map();
          this.postings.set(term, byField);
        }
        let list = byField.get(field);
        if (!list) {
          list = [];
          byField.set(field, list);
        }
        list.push({ chunkId, tf });
      }
    }

    if (!anyTokens) return;

    for (const [field, len] of perField) {
      const stat = this.fieldStats.get(field) ?? { docCount: 0, totalLength: 0 };
      stat.docCount += 1;
      stat.totalLength += len;
      this.fieldStats.set(field, stat);
    }

    this.docLengths.set(chunkId, perField);
    this.chunkToDoc.set(chunkId, docId);
    let bucket = this.docToChunks.get(docId);
    if (!bucket) {
      bucket = new Set();
      this.docToChunks.set(docId, bucket);
    }
    bucket.add(chunkId);
  }

  remove(chunkId: string): void {
    const fieldLengths = this.docLengths.get(chunkId);
    if (!fieldLengths) return;

    for (const [field, len] of fieldLengths) {
      const stat = this.fieldStats.get(field);
      if (stat) {
        stat.docCount -= 1;
        stat.totalLength -= len;
        if (stat.docCount <= 0) {
          this.fieldStats.delete(field);
        } else {
          this.fieldStats.set(field, stat);
        }
      }
    }

    for (const [term, byField] of this.postings) {
      for (const [field, list] of byField) {
        const filtered = list.filter((p) => p.chunkId !== chunkId);
        if (filtered.length === 0) {
          byField.delete(field);
        } else if (filtered.length !== list.length) {
          byField.set(field, filtered);
        }
      }
      if (byField.size === 0) {
        this.postings.delete(term);
      }
    }

    this.docLengths.delete(chunkId);

    const docId = this.chunkToDoc.get(chunkId);
    this.chunkToDoc.delete(chunkId);
    if (docId !== undefined) {
      const bucket = this.docToChunks.get(docId);
      if (bucket) {
        bucket.delete(chunkId);
        if (bucket.size === 0) this.docToChunks.delete(docId);
      }
    }
  }

  removeByDocument(docId: string): void {
    const bucket = this.docToChunks.get(docId);
    if (!bucket) return;
    for (const chunkId of [...bucket]) {
      this.remove(chunkId);
    }
  }

  clear(): void {
    this.postings.clear();
    this.docLengths.clear();
    this.fieldStats.clear();
    this.chunkToDoc.clear();
    this.docToChunks.clear();
  }

  search(query: string, options: TextSearchOptions = {}): TextSearchResult[] {
    const topK = options.topK ?? 10;
    const totalDocs = this.docLengths.size;
    if (totalDocs === 0) return [];

    const queryTerms = this.tokenizer.tokenize(query);
    if (queryTerms.length === 0) return [];

    // De-duplicate query terms — repeated query terms shouldn't double-count.
    const uniqueTerms = Array.from(new Set(queryTerms));

    // pseudoTf[chunkId] accumulates the BM25F field-weighted, length-normalised
    // tf across all matching fields. We compute it per term, then convert to
    // the BM25 saturation curve and multiply by IDF.
    const scores = new Map<string, number>();

    for (const term of uniqueTerms) {
      const byField = this.postings.get(term);
      if (!byField) continue;

      const df = this.distinctChunkCount(byField);
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
      if (idf <= 0) continue;

      const pseudoTfByChunk = new Map<string, number>();
      for (const [field, list] of byField) {
        const weight = this.fieldWeights[field] ?? 0;
        if (weight <= 0) continue;
        const stat = this.fieldStats.get(field);
        if (!stat || stat.docCount === 0) continue;
        const avgLen = stat.totalLength / stat.docCount;

        for (const { chunkId, tf } of list) {
          const fieldLen = this.docLengths.get(chunkId)?.get(field) ?? 0;
          const norm = avgLen > 0 ? 1 - this.b + (this.b * fieldLen) / avgLen : 1;
          const contribution = (weight * tf) / (norm || 1);
          pseudoTfByChunk.set(chunkId, (pseudoTfByChunk.get(chunkId) ?? 0) + contribution);
        }
      }

      for (const [chunkId, pseudoTf] of pseudoTfByChunk) {
        const termScore = (idf * pseudoTf) / (this.k1 + pseudoTf);
        scores.set(chunkId, (scores.get(chunkId) ?? 0) + termScore);
      }
    }

    const ranked = Array.from(scores, ([chunkId, score]) => ({ chunkId, score }));
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, topK);
  }

  toJSON(): SerialisedBM25State {
    const postingsObj: SerialisedBM25State["postings"] = {};
    for (const [term, byField] of this.postings) {
      const fieldsObj: Record<string, Array<{ chunkId: string; tf: number }>> = {};
      for (const [field, list] of byField) {
        fieldsObj[field] = list.map((p) => ({ chunkId: p.chunkId, tf: p.tf }));
      }
      postingsObj[term] = fieldsObj;
    }

    const fieldStatsObj: SerialisedBM25State["fieldStats"] = {};
    for (const [field, stat] of this.fieldStats) {
      fieldStatsObj[field] = { docCount: stat.docCount, totalLength: stat.totalLength };
    }

    const docLengthsObj: SerialisedBM25State["docLengths"] = {};
    for (const [chunkId, perField] of this.docLengths) {
      docLengthsObj[chunkId] = Object.fromEntries(perField);
    }

    const chunkToDocObj: Record<string, string> = {};
    for (const [chunkId, docId] of this.chunkToDoc) {
      chunkToDocObj[chunkId] = docId;
    }

    return {
      version: 1,
      k1: this.k1,
      b: this.b,
      fieldWeights: { ...this.fieldWeights },
      fieldStats: fieldStatsObj,
      postings: postingsObj,
      docLengths: docLengthsObj,
      chunkToDoc: chunkToDocObj,
    };
  }

  fromJSON(state: unknown): void {
    const s = state as SerialisedBM25State;
    if (!s || typeof s !== "object" || s.version !== 1) {
      throw new Error("BM25Index.fromJSON: unsupported or missing state version");
    }

    this.clear();
    this.fieldWeights = { ...s.fieldWeights };

    for (const [field, stat] of Object.entries(s.fieldStats)) {
      this.fieldStats.set(field, { docCount: stat.docCount, totalLength: stat.totalLength });
    }

    for (const [term, fieldsObj] of Object.entries(s.postings)) {
      const byField = new Map<string, Posting[]>();
      for (const [field, list] of Object.entries(fieldsObj)) {
        byField.set(
          field,
          list.map((p) => ({ chunkId: p.chunkId, tf: p.tf }))
        );
      }
      this.postings.set(term, byField);
    }

    for (const [chunkId, perField] of Object.entries(s.docLengths)) {
      this.docLengths.set(chunkId, new Map(Object.entries(perField)));
    }

    for (const [chunkId, docId] of Object.entries(s.chunkToDoc)) {
      this.chunkToDoc.set(chunkId, docId);
      let bucket = this.docToChunks.get(docId);
      if (!bucket) {
        bucket = new Set();
        this.docToChunks.set(docId, bucket);
      }
      bucket.add(chunkId);
    }
  }

  private distinctChunkCount(byField: Map<string, Posting[]>): number {
    const seen = new Set<string>();
    for (const list of byField.values()) {
      for (const p of list) seen.add(p.chunkId);
    }
    return seen.size;
  }
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BM25Index,
  DEFAULT_CHUNK_FIELD_WEIGHTS,
  DEFAULT_ENGLISH_STOPWORDS,
  createDefaultTokenizer,
} from "@workglow/storage";
import { describe, expect, it } from "vitest";

describe("BM25Index", () => {
  const addDoc = (
    idx: BM25Index,
    chunkId: string,
    docId: string,
    text: string,
    extras: Record<string, string | string[]> = {}
  ) => {
    idx.add(chunkId, docId, { text, ...extras });
  };

  describe("basic search", () => {
    it("returns the only chunk for a single-doc index", () => {
      const idx = new BM25Index();
      addDoc(idx, "c1", "d1", "the rabbit jumps over the fence");
      const results = idx.search("rabbit");
      expect(results).toHaveLength(1);
      expect(results[0].chunkId).toBe("c1");
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("returns nothing when the query has no indexable terms", () => {
      const idx = new BM25Index();
      addDoc(idx, "c1", "d1", "rabbit fence garden");
      // All stopwords -> zero tokens after tokenisation.
      expect(idx.search("the and of")).toEqual([]);
    });

    it("returns nothing when index is empty", () => {
      const idx = new BM25Index();
      expect(idx.search("anything")).toEqual([]);
    });

    it("tokenises queries identically to indexed text (case-insensitive)", () => {
      const idx = new BM25Index();
      addDoc(idx, "c1", "d1", "Rabbit");
      const upper = idx.search("RABBIT");
      const lower = idx.search("rabbit");
      expect(upper).toEqual(lower);
    });
  });

  describe("ranking", () => {
    it("ranks rare terms above common terms (IDF)", () => {
      const idx = new BM25Index();
      // "fence" is in every doc; "wombat" is unique to c2.
      for (let i = 0; i < 10; i++) {
        addDoc(idx, `c${i}`, `d${i}`, "fence garden lawn");
      }
      addDoc(idx, "c-rare", "d-rare", "fence garden lawn wombat");

      const results = idx.search("wombat fence");
      // The doc containing the rare term should rank first.
      expect(results[0].chunkId).toBe("c-rare");
    });

    it("weights matches in doc_title above matches in body (BM25F)", () => {
      const idx = new BM25Index();
      addDoc(idx, "title-match", "d1", "unrelated body text", {
        doc_title: "rabbit",
      });
      addDoc(idx, "body-match", "d2", "rabbit appears here", {
        doc_title: "unrelated",
      });

      const results = idx.search("rabbit");
      // doc_title weight (3) > text weight (1), so title-match ranks higher.
      expect(results[0].chunkId).toBe("title-match");
    });

    it("respects custom field weights", () => {
      const idx = new BM25Index({ fieldWeights: { text: 1, doc_title: 0.1 } });
      addDoc(idx, "title-match", "d1", "unrelated body text", {
        doc_title: "rabbit",
      });
      addDoc(idx, "body-match", "d2", "rabbit appears here", {
        doc_title: "unrelated",
      });

      // With doc_title de-weighted, body-match should win.
      const results = idx.search("rabbit");
      expect(results[0].chunkId).toBe("body-match");
    });

    it("favours shorter documents on otherwise equal matches (length norm)", () => {
      const idx = new BM25Index();
      const short = "rabbit fence";
      const long = "rabbit fence " + "stuffing word ".repeat(50);
      addDoc(idx, "short", "d1", short);
      addDoc(idx, "long", "d2", long);

      const results = idx.search("rabbit");
      expect(results[0].chunkId).toBe("short");
    });

    it("indexes string-array fields by joining with whitespace", () => {
      const idx = new BM25Index();
      addDoc(idx, "c1", "d1", "body text", {
        sectionTitles: ["Mammals", "Rodents"],
      });
      addDoc(idx, "c2", "d2", "body text", {
        sectionTitles: ["Plants"],
      });

      const results = idx.search("rodents");
      expect(results.map((r) => r.chunkId)).toContain("c1");
      expect(results[0].chunkId).toBe("c1");
    });
  });

  describe("upsert / remove", () => {
    it("re-adding a chunkId is an idempotent upsert (does not double-count)", () => {
      const idx = new BM25Index();
      addDoc(idx, "c1", "d1", "rabbit");
      const firstScore = idx.search("rabbit")[0].score;

      // Re-add with the same content; counts should not double.
      addDoc(idx, "c1", "d1", "rabbit");
      expect(idx.size()).toBe(1);
      const secondScore = idx.search("rabbit")[0].score;
      expect(secondScore).toBeCloseTo(firstScore, 10);
    });

    it("re-adding overwrites previous content", () => {
      const idx = new BM25Index();
      addDoc(idx, "c1", "d1", "rabbit");
      addDoc(idx, "c1", "d1", "fox");
      expect(idx.search("rabbit")).toEqual([]);
      expect(idx.search("fox")).toHaveLength(1);
    });

    it("remove drops the chunk from search results and stats", () => {
      const idx = new BM25Index();
      addDoc(idx, "c1", "d1", "rabbit fence");
      addDoc(idx, "c2", "d2", "rabbit garden");
      idx.remove("c1");

      expect(idx.size()).toBe(1);
      const results = idx.search("rabbit");
      expect(results).toHaveLength(1);
      expect(results[0].chunkId).toBe("c2");
    });

    it("remove is a no-op for unknown chunkId", () => {
      const idx = new BM25Index();
      addDoc(idx, "c1", "d1", "rabbit");
      idx.remove("nonexistent");
      expect(idx.size()).toBe(1);
    });

    it("removeByDocument cascades over all chunks for the doc", () => {
      const idx = new BM25Index();
      addDoc(idx, "c1", "doc-a", "rabbit");
      addDoc(idx, "c2", "doc-a", "fox");
      addDoc(idx, "c3", "doc-b", "rabbit fence");
      idx.removeByDocument("doc-a");

      expect(idx.size()).toBe(1);
      const results = idx.search("rabbit");
      expect(results).toHaveLength(1);
      expect(results[0].chunkId).toBe("c3");
    });

    it("clear empties the index", () => {
      const idx = new BM25Index();
      addDoc(idx, "c1", "d1", "rabbit");
      addDoc(idx, "c2", "d2", "fox");
      idx.clear();
      expect(idx.size()).toBe(0);
      expect(idx.search("rabbit")).toEqual([]);
    });
  });

  describe("toJSON / fromJSON round-trip", () => {
    it("preserves search results exactly", () => {
      const a = new BM25Index();
      addDoc(a, "c1", "d1", "rabbit fence", { doc_title: "Animals" });
      addDoc(a, "c2", "d2", "fox garden", { doc_title: "Animals" });
      addDoc(a, "c3", "d3", "tomato vine", { doc_title: "Plants" });

      const state = JSON.parse(JSON.stringify(a.toJSON())) as unknown;
      const b = new BM25Index();
      b.fromJSON(state);

      const queries = ["rabbit", "fox garden", "Animals", "plants"];
      for (const q of queries) {
        const ra = a.search(q);
        const rb = b.search(q);
        expect(rb.map((r) => r.chunkId)).toEqual(ra.map((r) => r.chunkId));
        for (let i = 0; i < ra.length; i++) {
          expect(rb[i].score).toBeCloseTo(ra[i].score, 10);
        }
      }
    });

    it("rejects unknown state versions", () => {
      const idx = new BM25Index();
      expect(() => idx.fromJSON({ version: 999 })).toThrow();
    });

    it("restores k1 / b from serialised state (does not silently keep constructor defaults)", () => {
      const a = new BM25Index({ k1: 2.0, b: 0.5 });
      addDoc(a, "c1", "d1", "rabbit fence");
      addDoc(a, "c2", "d2", "rabbit");
      const stateA = JSON.parse(JSON.stringify(a.toJSON())) as unknown;

      // Fresh instance with *different* k1/b. After fromJSON, scoring must
      // match a, not the new instance's constructor defaults.
      const b = new BM25Index({ k1: 0.5, b: 0.9 });
      b.fromJSON(stateA);

      const ra = a.search("rabbit");
      const rb = b.search("rabbit");
      expect(rb.map((r) => r.chunkId)).toEqual(ra.map((r) => r.chunkId));
      for (let i = 0; i < ra.length; i++) {
        expect(rb[i].score).toBeCloseTo(ra[i].score, 10);
      }
    });

    it("preserves remove correctness after a fromJSON round-trip", () => {
      const a = new BM25Index();
      addDoc(a, "c1", "d1", "rabbit fence");
      addDoc(a, "c2", "d2", "rabbit garden");

      const b = new BM25Index();
      b.fromJSON(JSON.parse(JSON.stringify(a.toJSON())) as unknown);

      // The reverse-index for surgical remove must be reconstructed by
      // fromJSON; otherwise remove silently leaves stale postings.
      b.remove("c1");
      expect(b.size()).toBe(1);
      const hits = b.search("rabbit");
      expect(hits).toHaveLength(1);
      expect(hits[0].chunkId).toBe("c2");
    });

    it("preserves removeByDocument cascade after a fromJSON round-trip", () => {
      const a = new BM25Index();
      addDoc(a, "c1", "doc-a", "rabbit");
      addDoc(a, "c2", "doc-a", "fox");
      addDoc(a, "c3", "doc-b", "rabbit fence");

      const b = new BM25Index();
      b.fromJSON(JSON.parse(JSON.stringify(a.toJSON())) as unknown);

      // docToChunks must be reconstructed by fromJSON; otherwise cascade
      // delete is a no-op on the restored index.
      b.removeByDocument("doc-a");
      expect(b.size()).toBe(1);
      const hits = b.search("rabbit");
      expect(hits.map((h) => h.chunkId)).toEqual(["c3"]);
    });
  });

  describe("tokenizer & stopwords", () => {
    it("default tokenizer drops English stopwords and short tokens", () => {
      const tokenizer = createDefaultTokenizer();
      const tokens = tokenizer.tokenize("The quick brown fox is a jumper");
      expect(tokens).not.toContain("the");
      expect(tokens).not.toContain("is");
      expect(tokens).not.toContain("a");
      expect(tokens).toContain("quick");
      expect(tokens).toContain("brown");
      expect(tokens).toContain("fox");
      expect(tokens).toContain("jumper");
    });

    it("default stopwords are extensible without replacement", () => {
      const stopwords = new Set([...DEFAULT_ENGLISH_STOPWORDS, "rabbit"]);
      const tokenizer = createDefaultTokenizer({ stopwords });
      expect(tokenizer.tokenize("the rabbit jumps")).toEqual(["jumps"]);
    });

    it("custom tokenizer is used at index- and query-time", () => {
      const tokenizer = {
        tokenize: (s: string) =>
          s
            .split(/[^A-Z]+/i)
            .filter((t) => t.length > 0)
            .map((t) => t.toUpperCase()),
      };
      const idx = new BM25Index({ tokenizer });
      idx.add("c1", "d1", { text: "RABBIT" });
      // Query with lowercase; custom tokenizer uppercases both sides => match.
      expect(idx.search("rabbit")).toHaveLength(1);
    });
  });

  describe("default field weights", () => {
    it("exports a sensible default map", () => {
      expect(DEFAULT_CHUNK_FIELD_WEIGHTS.doc_title).toBeGreaterThan(
        DEFAULT_CHUNK_FIELD_WEIGHTS.text
      );
      expect(DEFAULT_CHUNK_FIELD_WEIGHTS.parentSummaries).toBeLessThan(
        DEFAULT_CHUNK_FIELD_WEIGHTS.text
      );
    });
  });
});

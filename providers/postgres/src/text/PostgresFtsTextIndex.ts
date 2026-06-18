/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Pool } from "@workglow/postgres/storage";
import type {
  ITextIndex,
  TextFields,
  TextSearchOptions,
  TextSearchResult,
} from "@workglow/storage";

/**
 * Per-field weights for {@link PostgresFtsTextIndex}. Postgres FTS supports
 * exactly four weight buckets — A (heaviest), B, C, D — and that maps
 * naturally onto the hierarchy of chunk fields:
 *
 *   - `text`            → A: direct chunk content
 *   - `doc_title`       → B: navigational
 *   - `sectionTitles`   → B: navigational
 *   - `summary`         → C: condensed body
 *   - `parentSummaries` → D: inherited context
 *
 * Fields outside this map are silently ignored at index time (no FTS bucket
 * to assign). Callers can override the mapping via
 * {@link PostgresFtsTextIndexOptions.fieldWeights}.
 */
export const DEFAULT_POSTGRES_FTS_FIELD_WEIGHTS: Readonly<Record<string, "A" | "B" | "C" | "D">> = {
  text: "A",
  doc_title: "B",
  sectionTitles: "B",
  summary: "C",
  parentSummaries: "D",
};

export interface PostgresFtsTextIndexOptions {
  /** Postgres text-search configuration name. Defaults to `"english"`. */
  readonly tsvectorConfig?: string;
  /**
   * Per-field FTS weight bucket. See {@link DEFAULT_POSTGRES_FTS_FIELD_WEIGHTS}
   * for the default mapping. Fields not listed are ignored at index time.
   */
  readonly fieldWeights?: Readonly<Record<string, "A" | "B" | "C" | "D">>;
}

/**
 * Postgres-native full-text index for {@link KnowledgeBase.hybridSearch} /
 * {@link KnowledgeBase.textSearch}. Stores postings on a single side table
 * keyed by `chunk_id`:
 *
 * ```sql
 * CREATE TABLE <table> (
 *   chunk_id TEXT PRIMARY KEY,
 *   doc_id   TEXT NOT NULL,
 *   tsv      TSVECTOR NOT NULL
 * );
 * CREATE INDEX <table>_tsv_idx ON <table> USING GIN (tsv);
 * CREATE INDEX <table>_doc_idx ON <table> (doc_id);
 * ```
 *
 * Scoring is `ts_rank_cd(tsv, plainto_tsquery(...))`; unbounded above and
 * non-negative, suitable for RRF fusion without normalisation.
 *
 * Lifecycle: {@link setupDatabase} must be called before any other method.
 * {@link beginRebuild}/{@link commitRebuild}/{@link abortRebuild} let
 * `KnowledgeBase.reindexText` wrap a full rebuild in a database
 * transaction; on `abort` the table is rolled back to its pre-`begin`
 * contents.
 *
 * State is durable on the database side; {@link toJSON} / {@link fromJSON}
 * are intentional no-ops (the table itself is the snapshot).
 */
export class PostgresFtsTextIndex implements ITextIndex {
  private readonly pool: Pool;
  private readonly table: string;
  private readonly options: PostgresFtsTextIndexOptions;

  // Tx state for beginRebuild/commitRebuild/abortRebuild. Acquired on
  // beginRebuild; released on commit/abort. When set, all DML methods
  // (`clear`, `add`, `remove`, `removeByDocument`) route through the
  // dedicated client so the rebuild is one BEGIN…COMMIT block.
  //
  // We hold a pre-bound `query` reference alongside the client. `pg.PoolClient`'s
  // `query` method depends on `this` being the client instance; if we returned
  // the raw method reference from the `exec` getter and call sites invoked it
  // as a plain function (which they do), `this` would be undefined and real
  // pg drivers would throw. Binding once at acquisition keeps every `exec(...)`
  // call safe regardless of how it's invoked.
  private rebuildClient:
    | {
        boundQuery: Pool["query"];
        release: () => void;
      }
    | undefined;

  constructor(pool: Pool, table: string, options: PostgresFtsTextIndexOptions = {}) {
    this.pool = pool;
    this.table = table;
    this.options = options;
  }

  private get tsvectorConfig(): string {
    return this.options.tsvectorConfig ?? "english";
  }

  private get fieldWeights(): Readonly<Record<string, "A" | "B" | "C" | "D">> {
    return this.options.fieldWeights ?? DEFAULT_POSTGRES_FTS_FIELD_WEIGHTS;
  }

  /**
   * Routes a query to the rebuild-bound client when a rebuild is open.
   * Returns a function that is safe to call without preserving `this` —
   * the underlying `pg.PoolClient.query` is bound at acquisition time.
   */
  private get exec(): Pool["query"] {
    if (this.rebuildClient) return this.rebuildClient.boundQuery;
    return this.pool.query.bind(this.pool) as Pool["query"];
  }

  /**
   * Identifier-quote a table name. The constructor accepts an arbitrary
   * string, so we whitelist it (alphanumerics + underscores) and reject
   * anything else before splicing into DDL.
   */
  private get quotedTable(): string {
    if (!/^[A-Z_]\w*$/i.test(this.table)) {
      throw new Error(
        `PostgresFtsTextIndex: refusing to use unsafe table name ${JSON.stringify(this.table)}; ` +
          `expected /^[A-Za-z_][A-Za-z0-9_]*$/.`
      );
    }
    return `"${this.table}"`;
  }

  /**
   * Create the postings table + GIN index. Idempotent.
   */
  async setupDatabase(): Promise<void> {
    const table = this.quotedTable;
    const exec = this.exec as (sql: string) => Promise<unknown>;
    await exec(
      `CREATE TABLE IF NOT EXISTS ${table} (
        chunk_id TEXT PRIMARY KEY,
        doc_id   TEXT NOT NULL,
        tsv      TSVECTOR NOT NULL
      )`
    );
    await exec(`CREATE INDEX IF NOT EXISTS "${this.table}_tsv_idx" ON ${table} USING GIN (tsv)`);
    await exec(`CREATE INDEX IF NOT EXISTS "${this.table}_doc_idx" ON ${table} (doc_id)`);
  }

  async add(chunkId: string, docId: string, fields: TextFields): Promise<void> {
    const weights = this.fieldWeights;
    const cfg = this.tsvectorConfig;

    const params: (string | null)[] = [];
    const tsvParts: string[] = [];
    params.push(cfg); // $1

    let nextParam = 2;
    for (const [field, weight] of Object.entries(weights)) {
      const raw = fields[field];
      if (raw === undefined) continue;
      const text = Array.isArray(raw) ? raw.join(" ") : (raw as string);
      // Skip empty/whitespace-only — they'd contribute a zero-length tsvector
      // and waste a parameter slot.
      if (typeof text !== "string" || text.trim().length === 0) continue;
      params.push(text);
      const pIdx = nextParam++;
      tsvParts.push(`setweight(to_tsvector($1::regconfig, coalesce($${pIdx}, '')), '${weight}')`);
    }

    const table = this.quotedTable;

    if (tsvParts.length === 0) {
      // Nothing indexable on this chunk — drop any prior postings so an
      // update that clears text is reflected. Mirror BM25Index.add's behaviour.
      await this.remove(chunkId);
      return;
    }

    params.push(chunkId);
    const chunkIdParam = `$${nextParam++}`;
    params.push(docId);
    const docIdParam = `$${nextParam++}`;

    const tsvExpr = tsvParts.join(" || ");
    const sql = `INSERT INTO ${table} (chunk_id, doc_id, tsv)
                 VALUES (${chunkIdParam}, ${docIdParam}, ${tsvExpr})
                 ON CONFLICT (chunk_id) DO UPDATE
                   SET doc_id = EXCLUDED.doc_id,
                       tsv    = EXCLUDED.tsv`;
    await (this.exec as (sql: string, params: unknown[]) => Promise<unknown>)(sql, params);
  }

  async remove(chunkId: string): Promise<void> {
    const sql = `DELETE FROM ${this.quotedTable} WHERE chunk_id = $1`;
    await (this.exec as (sql: string, params: unknown[]) => Promise<unknown>)(sql, [chunkId]);
  }

  async removeByDocument(docId: string): Promise<void> {
    const sql = `DELETE FROM ${this.quotedTable} WHERE doc_id = $1`;
    await (this.exec as (sql: string, params: unknown[]) => Promise<unknown>)(sql, [docId]);
  }

  async clear(): Promise<void> {
    // TRUNCATE is faster than DELETE and friendly to the GIN index; we hold
    // the rebuild's transaction (when present) so it still rolls back on abort.
    await (this.exec as (sql: string) => Promise<unknown>)(`TRUNCATE TABLE ${this.quotedTable}`);
  }

  async size(): Promise<number> {
    const res = (await (this.exec as (sql: string) => Promise<{ rows: Array<{ n: number }> }>)(
      `SELECT count(*)::int AS n FROM ${this.quotedTable}`
    )) as { rows: Array<{ n: number }> };
    return res.rows[0]?.n ?? 0;
  }

  async search(query: string, options: TextSearchOptions = {}): Promise<TextSearchResult[]> {
    const topK = options.topK ?? 10;
    if (typeof query !== "string" || query.trim().length === 0) return [];
    const sql = `
      SELECT chunk_id, ts_rank_cd(tsv, plainto_tsquery($1::regconfig, $2)) AS score
        FROM ${this.quotedTable}
       WHERE tsv @@ plainto_tsquery($1::regconfig, $2)
       ORDER BY score DESC
       LIMIT $3
    `;
    const res = (await (
      this.exec as (
        sql: string,
        params: unknown[]
      ) => Promise<{
        rows: Array<{ chunk_id: string; score: number }>;
      }>
    )(sql, [this.tsvectorConfig, query, topK])) as {
      rows: Array<{ chunk_id: string; score: number }>;
    };
    return res.rows.map((r) => ({ chunkId: r.chunk_id, score: Number(r.score) }));
  }

  async beginRebuild(): Promise<void> {
    if (this.rebuildClient) {
      throw new Error(
        `PostgresFtsTextIndex.beginRebuild on table "${this.table}" called while a rebuild was already open. Call commitRebuild() or abortRebuild() first.`
      );
    }
    this.rebuildClient = await this.acquireConnection();
    try {
      await this.rebuildClient.boundQuery(`BEGIN`);
    } catch (err) {
      this.rebuildClient.release();
      this.rebuildClient = undefined;
      throw err;
    }
  }

  async commitRebuild(): Promise<void> {
    if (!this.rebuildClient) {
      throw new Error(
        `PostgresFtsTextIndex.commitRebuild on table "${this.table}" called without an open rebuild.`
      );
    }
    try {
      await this.rebuildClient.boundQuery(`COMMIT`);
    } finally {
      this.rebuildClient.release();
      this.rebuildClient = undefined;
    }
  }

  async abortRebuild(): Promise<void> {
    if (!this.rebuildClient) return;
    try {
      await this.rebuildClient.boundQuery(`ROLLBACK`);
    } finally {
      this.rebuildClient.release();
      this.rebuildClient = undefined;
    }
  }

  /**
   * State lives server-side. `toJSON`/`fromJSON` are no-ops, mirrored on
   * {@link PostgresFtsTextIndex} so the {@link ITextIndex} contract still
   * round-trips for callers that snapshot/restore the index. Callers
   * relying on a real serialisation should use {@link beginRebuild} /
   * {@link commitRebuild} / {@link abortRebuild} for atomic mutations
   * instead.
   */
  toJSON(): { kind: "postgres-fts"; table: string } {
    return { kind: "postgres-fts", table: this.table };
  }

  fromJSON(state: unknown): void {
    if (
      !state ||
      typeof state !== "object" ||
      (state as { kind?: unknown }).kind !== "postgres-fts"
    ) {
      throw new Error(
        `PostgresFtsTextIndex.fromJSON: expected { kind: "postgres-fts" }, got ${JSON.stringify(
          state
        )}`
      );
    }
    // Symmetric with toJSON: if the snapshot carries a `table`, it must
    // match this instance's table. A snapshot from a different table
    // round-tripping through a mismatched instance would silently mask
    // bugs (the server-side data still lives in the original table).
    const snapshotTable = (state as { table?: unknown }).table;
    if (snapshotTable !== undefined && snapshotTable !== this.table) {
      throw new Error(
        `PostgresFtsTextIndex.fromJSON: snapshot table "${String(snapshotTable)}" does not match this index's table "${this.table}".`
      );
    }
    // No-op beyond validation: state is server-side. We accept the
    // snapshot for API parity.
  }

  /**
   * Mirror of `PostgresTabularStorage.acquireConnection`: prefer `pool.connect()`
   * when available (real `pg.Pool`); fall back to routing through `pool.query`
   * directly for single-connection wrappers (PGlite / PGLitePool). Failing
   * fast on anything else keeps BEGIN/COMMIT bracket sanity.
   *
   * Returns a pre-bound `boundQuery` rather than the raw `query` reference so
   * call sites invoking it as a plain function (`exec(sql, params)`) don't
   * lose the `pg.PoolClient` `this` binding.
   */
  private async acquireConnection(): Promise<{
    boundQuery: Pool["query"];
    release: () => void;
  }> {
    const supportsConnect =
      typeof (this.pool as unknown as { connect?: unknown }).connect === "function";
    if (supportsConnect) {
      const client = await (
        this.pool as unknown as {
          connect: () => Promise<{ query: Pool["query"]; release: () => void }>;
        }
      ).connect();
      return {
        boundQuery: client.query.bind(client) as Pool["query"],
        release: () => client.release(),
      };
    }
    const poolAny = this.pool as unknown as {
      waitReady?: unknown;
      exec?: unknown;
      constructor?: { name?: string };
    };
    const ctorName = poolAny.constructor?.name;
    const looksLikePGlite = typeof poolAny.exec === "function" && poolAny.waitReady !== undefined;
    const looksLikePGLitePool = ctorName === "PGLitePool";
    if (!looksLikePGlite && !looksLikePGLitePool) {
      throw new Error(
        `PostgresFtsTextIndex requires a pg.Pool with connect() or a known single-connection wrapper (PGLitePool, PGlite); got ${
          ctorName ?? typeof this.pool
        }.`
      );
    }
    return {
      boundQuery: this.pool.query.bind(this.pool) as Pool["query"],
      release: () => {},
    };
  }
}

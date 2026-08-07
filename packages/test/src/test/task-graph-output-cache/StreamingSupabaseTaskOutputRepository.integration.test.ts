/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `StreamingSupabaseTaskOutputRepository` is a durable streaming cache backing:
 * JSON rows via `SupabaseTabularStorage`, port payloads as ordered `bytea`
 * chunk rows via `TabularBlobChunkStore`. Exercised against the in-process
 * Supabase mock client (no network).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { runStreamingTaskOutputRepositoryContract } from "@workglow/task-graph/test";
import { uuid4 } from "@workglow/util";
import { afterAll } from "vitest";
import { StreamingSupabaseTaskOutputRepository } from "../../binding/StreamingSupabaseTaskOutputRepository";
import { createSupabaseMockClient } from "../helpers/SupabaseMockClient";

const client = createSupabaseMockClient();

afterAll(async () => {
  await client.close();
});

runStreamingTaskOutputRepositoryContract({
  name: "StreamingSupabaseTaskOutputRepository",
  refScheme: "supablob",
  foreignRefScheme: "pgblob",
  makeRepo: async () => {
    const table = `t_${uuid4().replace(/-/g, "_")}`;
    const repo = new StreamingSupabaseTaskOutputRepository(
      client as unknown as SupabaseClient,
      table
    );
    await repo.setupDatabase();
    return { repo, table };
  },
  makeSibling: async (table) => {
    const sibling = new StreamingSupabaseTaskOutputRepository(
      client as unknown as SupabaseClient,
      table
    );
    await sibling.setupDatabase();
    return sibling;
  },
});

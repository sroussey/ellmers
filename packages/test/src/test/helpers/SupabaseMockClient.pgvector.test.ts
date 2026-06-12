/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, describe, expect, it } from "vitest";
import { createSupabaseMockClient } from "./SupabaseMockClient";

describe("SupabaseMockClient pgvector + match_* RPC", () => {
  const client = createSupabaseMockClient();

  afterAll(async () => {
    await client.close();
  });

  it("supports the pgvector extension and routes arbitrary RPC functions positionally", async () => {
    const setup = await client.rpc("exec_sql", {
      query: `
        create extension if not exists vector;
        create table v(id text primary key, vec vector(3));
        insert into v(id, vec) values ('a', '[1,0,0]'), ('b', '[0,1,0]');
        create function match_v(q vector(3), n int)
          returns table(id text, score float)
          language sql stable
          as $$
            select v.id, (1 - (v.vec <=> q)) as score
            from v
            order by v.vec <=> q
            limit n
          $$;
      `,
    });
    expect(setup.error).toBeNull();

    const { data, error } = await client.rpc("match_v", { q: "[1,0,0]", n: 5 });
    expect(error).toBeNull();
    expect(data?.[0]?.id).toBe("a");
  });
});

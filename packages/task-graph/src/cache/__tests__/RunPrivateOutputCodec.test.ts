/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage } from "@workglow/storage";
import {
  RunPrivateTaskOutputPrimaryKeyNames,
  RunPrivateTaskOutputRepository,
  RunPrivateTaskOutputSchema,
} from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

function freshRepo(outputCompression: boolean): RunPrivateTaskOutputRepository {
  return new RunPrivateTaskOutputRepository({
    storage: new InMemoryTabularStorage(
      RunPrivateTaskOutputSchema,
      RunPrivateTaskOutputPrimaryKeyNames,
      ["createdAt"]
    ),
    outputCompression,
  });
}

describe("RunPrivateTaskOutputRepository output codec", () => {
  for (const outputCompression of [true, false]) {
    it(`round-trips output (outputCompression=${outputCompression})`, async () => {
      const repo = freshRepo(outputCompression);
      await repo.saveOutputForRun("rT", "T", { x: 1 }, { nested: { ok: true }, n: 42 });
      expect(await repo.getOutputForRun("rT", "T", { x: 1 })).toEqual({
        nested: { ok: true },
        n: 42,
      });
    });
  }

  it("decodes an uncompressed value handed back as a plain Uint8Array (durable backend shape)", async () => {
    // SQL/IndexedDB backends return blob columns as a Uint8Array, not a Buffer;
    // calling `.toString()` on that would yield comma-separated byte numbers and
    // crash JSON.parse. Simulate that round-trip shape directly.
    const storage = new InMemoryTabularStorage(
      RunPrivateTaskOutputSchema,
      RunPrivateTaskOutputPrimaryKeyNames,
      ["createdAt"]
    );
    const repo = new RunPrivateTaskOutputRepository({ storage, outputCompression: false });

    const key = await repo.keyFromInputs({ x: 1 });
    const bytes = new Uint8Array(Buffer.from(JSON.stringify({ ok: "z" })));
    await storage.put({
      runId: "rZ",
      key,
      taskType: "T",
      value: bytes as unknown as string,
      createdAt: new Date().toISOString(),
    });

    expect(await repo.getOutputForRun("rZ", "T", { x: 1 })).toEqual({ ok: "z" });
  });
});

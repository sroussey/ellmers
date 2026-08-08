/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A binary streaming port WITHOUT a `format` annotation must still round-trip
 * through a JSON-row cache backing. `assertBinaryFormat` defaults a missing
 * format to `"blob"`, so serialization falls back to the mode-derived binary
 * codec — without that, `JSON.stringify(Blob)` is `"{}"`: the row silently
 * stores an empty object and every later cache hit returns corrupt output.
 */

import type { StreamEvent, TaskInput, TaskOutput } from "@workglow/task-graph";
import { Task, TaskOutputRepository, TaskStatus } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

/** Row repo that JSON round-trips every row, like real JSON-column backings. */
class JsonRowRepo extends TaskOutputRepository {
  public readonly rows = new Map<string, TaskOutput>();
  constructor() {
    super({ outputCompression: false });
  }
  override async saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput) {
    this.rows.set(taskType + JSON.stringify(inputs), JSON.parse(JSON.stringify(output)));
  }
  override async getOutput(taskType: string, inputs: TaskInput) {
    return this.rows.get(taskType + JSON.stringify(inputs));
  }
  override async clear() {
    this.rows.clear();
  }
  override async size() {
    return this.rows.size;
  }
  override async clearOlderThan() {}
  override isDurable() {
    return false;
  }
}

type Out = { data: Blob };

class FormatlessBinaryTask extends Task<Record<string, never>, Out> {
  public static override type = "FormatlessBinaryPort_Task";
  public static override category = "Test";
  public static override cacheable = true;
  public static executions = 0;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      // NOTE: no `format` annotation — the mode-derived default is "blob".
      properties: { data: { type: "object", "x-stream": "binary" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(): AsyncIterable<StreamEvent<Out>> {
    FormatlessBinaryTask.executions++;
    yield { type: "binary-delta", port: "data", binaryDelta: new Uint8Array([1, 2]) };
    yield { type: "binary-delta", port: "data", binaryDelta: new Uint8Array([3]) };
    yield { type: "finish", data: {} as Out };
  }
}

describe("format-less binary port through a JSON-row cache", () => {
  it("serializes via the mode-derived codec and replays a real Blob on cache hit", async () => {
    const repo = new JsonRowRepo();

    const t1 = new FormatlessBinaryTask();
    const out1 = await t1.run({}, { outputCache: repo });
    expect(out1.data).toBeInstanceOf(Blob);
    expect(Array.from(new Uint8Array(await out1.data.arrayBuffer()))).toEqual([1, 2, 3]);

    // The stored row carries the wire form (base64), not a destroyed "{}".
    expect(repo.rows.size).toBe(1);
    const row = [...repo.rows.values()][0] as Record<string, any>;
    expect(row.data).toBeDefined();
    expect(row.data.__binaryPortWire).toBe(1);
    expect(typeof row.data.base64).toBe("string");
    expect(row.data.size).toBe(3);

    // Second run: cache hit — no re-execution, and the output is a real Blob
    // with the original bytes.
    const before = FormatlessBinaryTask.executions;
    const t2 = new FormatlessBinaryTask();
    const out2 = await t2.run({}, { outputCache: repo });
    expect(t2.status).toBe(TaskStatus.COMPLETED);
    expect(FormatlessBinaryTask.executions).toBe(before);
    expect(out2.data).toBeInstanceOf(Blob);
    expect(Array.from(new Uint8Array(await out2.data.arrayBuffer()))).toEqual([1, 2, 3]);
  });
});

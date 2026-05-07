/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server";
import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { IHumanRequest, IHumanResponse } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";

import type { MockResponseEntry, MockResponseScript } from "../../contract/human-connector/types";

interface PairedMcpHarness {
  readonly server: Server;
  readonly script: MockResponseScript;
  dispose(): Promise<void>;
}

type ImmediateQueueEntry = { readonly kind: "immediate"; readonly entry: MockResponseEntry };

type DeferredQueueEntry = {
  readonly kind: "deferred";
  /** Resolves when release() is called (or pre-resolved if release ran first). */
  readonly promise: Promise<IHumanResponse>;
};

type HarnessQueueEntry = ImmediateQueueEntry | DeferredQueueEntry;

class HarnessScript implements MockResponseScript {
  private readonly _received: IHumanRequest[] = [];
  private readonly _queue: HarnessQueueEntry[] = [];

  get received(): ReadonlyArray<IHumanRequest> {
    return this._received;
  }

  recordReceived(req: IHumanRequest): void {
    this._received.push(req);
  }

  push(entry: MockResponseEntry): void {
    this._queue.push({ kind: "immediate", entry });
  }

  pushDeferred(): { release(response: IHumanResponse): void } {
    let resolveFn: (res: IHumanResponse) => void = () => {};
    let settled = false;
    const promise = new Promise<IHumanResponse>((resolve) => {
      resolveFn = resolve;
    });
    this._queue.push({ kind: "deferred", promise });
    return {
      release: (response) => {
        if (settled) return;
        settled = true;
        resolveFn(response);
      },
    };
  }

  /**
   * Consumed by the elicit handler to resolve the next outgoing prompt.
   *
   * If a deferred entry is awaiting release, this awaits the deferred promise.
   * The conformance suite's abort-mid-elicit test aborts the upstream signal
   * BEFORE release is called — `Server.elicitInput` rejects on the connector
   * side and the dangling promise is GC'd at dispose time. No leak.
   */
  async takeNext(req: IHumanRequest): Promise<IHumanResponse> {
    const next = this._queue.shift();
    if (!next) {
      return { requestId: req.requestId, action: "accept", content: undefined, done: true };
    }
    if (next.kind === "immediate") {
      const resolved =
        typeof next.entry === "function" ? await next.entry(req) : next.entry;
      return { ...resolved, requestId: req.requestId };
    }
    const resolved = await next.promise;
    return { ...resolved, requestId: req.requestId };
  }

  clear(): void {
    this._received.length = 0;
    this._queue.length = 0;
  }
}

export async function createPairedMcpHarness(): Promise<PairedMcpHarness> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new Server({ name: "test-server", version: "0.0.0" }, { capabilities: {} });
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    // Advertise form-mode elicitation support so the server routes elicitInput() here.
    // The elicitation capability type uses a zod transform, requiring a cast.
    { capabilities: { elicitation: { form: {} } } as unknown as ClientCapabilities }
  );

  const script = new HarnessScript();

  // Translate incoming MCP elicit/create into a synthetic IHumanRequest, run
  // it through the script, and convert the IHumanResponse back into the MCP
  // ElicitResult shape the SDK expects.
  client.setRequestHandler(ElicitRequestSchema, async (mcpReq) => {
    // Only form-mode elicitation carries requestedSchema; URL-mode has a `url` field instead.
    // The harness only ever processes form-mode requests (the connector always sends mode:"form").
    type FormParams = { requestedSchema: { properties: Record<string, unknown>; required?: string[] } };
    const params = mcpReq.params as typeof mcpReq.params & Partial<FormParams>;
    const requestedSchema = params.requestedSchema;
    const synthetic: IHumanRequest = {
      requestId: `harness-${script.received.length + 1}`,
      targetHumanId: "default",
      kind: "elicit",
      message: params.message,
      contentSchema: {
        type: "object",
        properties: requestedSchema?.properties ?? {},
        ...(requestedSchema?.required ? { required: requestedSchema.required } : {}),
      } as unknown as DataPortSchema,
      contentData: undefined,
      expectsResponse: true,
      mode: "single",
      metadata: undefined,
    };
    script.recordReceived(synthetic);
    const res = await script.takeNext(synthetic);
    // Zod v4 (used by the MCP SDK's ElicitResultSchema) requires the `content` key to be
    // explicitly present (even as undefined) for the schema to parse successfully. Omitting
    // the key entirely triggers "expected nonoptional, received undefined" for decline/cancel.
    return {
      action: res.action,
      content: res.action === "accept" ? res.content : undefined,
    };
  });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    server,
    script,
    dispose: async () => {
      await client.close();
      await server.close();
      script.clear();
    },
  };
}

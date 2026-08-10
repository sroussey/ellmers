/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  AiProviderRunFnRegistration,
  Capability,
  ChatChunkReference,
  ChatMessage,
  ModelConfig,
} from "@workglow/ai";
import { AiChatWithKbTask, AiProvider, getAiProviderRegistry, registerAiTasks } from "@workglow/ai";
import type { ChunkSearchResult, KnowledgeBase } from "@workglow/knowledge-base";
import { getGlobalKnowledgeBases } from "@workglow/knowledge-base";
import type { IExecuteContext, StreamEvent, Usage } from "@workglow/task-graph";
import { TaskRegistry } from "@workglow/task-graph";
import type { IHumanConnector, IHumanRequest, IHumanResponse, ILogger } from "@workglow/util";
import {
  Container,
  getLogger,
  HUMAN_CONNECTOR,
  ResourceScope,
  ServiceRegistry,
  setLogger,
} from "@workglow/util";
import { describe, expect, it } from "vitest";

const TEXT_GENERATION: readonly Capability[] = ["text.generation"];

describe("AiChatWithKbTask — schema and registration", () => {
  it("has required static properties", () => {
    expect(AiChatWithKbTask.type).toBe("AiChatWithKbTask");
    expect(AiChatWithKbTask.category).toBe("AI Chat");
    expect(AiChatWithKbTask.cachePolicy).toEqual({ kind: "none" });
  });

  it("input schema requires model, prompt, knowledgeBaseIds", () => {
    const schema = AiChatWithKbTask.inputSchema() as any;
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("model");
    expect(schema.required).toContain("prompt");
    expect(schema.required).toContain("knowledgeBaseIds");
    expect(schema.properties.topKPerKb.default).toBe(4);
    expect(schema.properties.minScore.default).toBeCloseTo(0.3);
    expect(schema.properties.maxReferences.default).toBe(6);
    expect(schema.properties.maxIterations.default).toBe(100);
    expect(schema.properties.noMatchReply).toBeDefined();
    expect(schema.properties.noMatchReferences).toBeDefined();
  });

  it("output schema declares text/messages/iterations/references streaming", () => {
    const schema = AiChatWithKbTask.outputSchema() as any;
    expect(schema.properties.text["x-stream"]).toBe("append");
    expect(schema.properties.messages["x-stream"]).toBe("object");
    expect(schema.properties.references["x-stream"]).toBe("object");
    expect(schema.properties.iterations).toBeDefined();
  });

  it("registers via registerAiTasks()", () => {
    registerAiTasks();
    expect(TaskRegistry.all.get("AiChatWithKbTask")).toBe(AiChatWithKbTask);
  });
});

// ========================================================================
// Chat-loop test helpers
// ========================================================================

function mkContext(connector?: IHumanConnector): IExecuteContext {
  const controller = new AbortController();
  const registry = new ServiceRegistry(new Container());
  if (connector) {
    registry.registerInstance(HUMAN_CONNECTOR, connector);
  }
  return {
    signal: controller.signal,
    updateProgress: async () => {},
    own: <T>(i: T) => i,
    registry,
    resourceScope: {
      register: (_key: string, _fn: () => Promise<void>) => {},
      dispose: async () => {},
    } as any,
  } as unknown as IExecuteContext;
}

function mkModel(): ModelConfig {
  return {
    provider: "fake-chat-kb",
    model: "fake-model",
    model_id: "fake-model",
  } as unknown as ModelConfig;
}

class FakeConnector implements IHumanConnector {
  public sent: IHumanRequest[] = [];
  constructor(private readonly scripted: IHumanResponse[]) {}
  async send(request: IHumanRequest, _signal: AbortSignal): Promise<IHumanResponse> {
    this.sent.push(request);
    const next = this.scripted.shift();
    if (!next) throw new Error("FakeConnector: no more scripted responses");
    return { ...next, requestId: request.requestId };
  }
}

class FakeChatKbProvider extends AiProvider {
  override readonly name = "fake-chat-kb";
  override readonly displayName = "Fake Chat KB";
  override readonly isLocal = true;
  override readonly supportsBrowser = false;
  override readonly supportsServer = true;

  constructor(promiseRunFns?: readonly AiProviderRunFnRegistration[]) {
    super(promiseRunFns);
  }
}

function registerFakeChatKbProvider(stream: AiProviderRunFn<any, any, ModelConfig>): () => void {
  const registry = getAiProviderRegistry();
  const provider = new FakeChatKbProvider();
  registry.registerProvider(provider);
  registry.registerRunFn("fake-chat-kb", {
    serves: TEXT_GENERATION,
    runFn: stream as AiProviderRunFn,
  });
  return () => registry.unregisterProvider("fake-chat-kb");
}

interface FakeKbCalls {
  query: string;
  opts: unknown;
}

interface FakeKbVectorCalls {
  vector: Float32Array;
  opts: unknown;
}

function makeFakeKb(opts: {
  id: string;
  label?: string;
  results: ChunkSearchResult[];
  /**
   * Per-doc-id metadata returned by the fake's `getDocument`. Optional;
   * when absent, every `getDocument` call resolves to undefined.
   */
  docMetadata?: Record<string, Record<string, unknown>>;
}): {
  kb: KnowledgeBase;
  calls: FakeKbCalls[];
  vectorCalls: FakeKbVectorCalls[];
  unregister: () => void;
} {
  const calls: FakeKbCalls[] = [];
  const vectorCalls: FakeKbVectorCalls[] = [];
  const kb = {
    title: opts.label ?? opts.id,
    description: "fake",
    search: async (q: string, searchOpts: unknown) => {
      calls.push({ query: q, opts: searchOpts });
      return opts.results;
    },
    similaritySearch: async (vector: Float32Array, searchOpts: unknown) => {
      vectorCalls.push({ vector, opts: searchOpts });
      return opts.results;
    },
    getDocument: async (docId: string) => {
      const md = opts.docMetadata?.[docId];
      return md ? { metadata: md } : undefined;
    },
  } as unknown as KnowledgeBase;
  // Bypass the KB registration flow (which persists to a repo) by poking
  // the live global Map directly. Tests own the lifecycle via `unregister`.
  const live = getGlobalKnowledgeBases();
  live.set(opts.id, kb);
  return {
    kb,
    calls,
    vectorCalls,
    unregister: () => {
      live.delete(opts.id);
    },
  };
}

interface AccumulatedKbChatOutput {
  readonly references: ChatChunkReference[];
  readonly messages: ChatMessage[];
  readonly events: StreamEvent<any>[];
}

async function accumulateKbChatStream(
  iterable: AsyncIterable<StreamEvent<any>>
): Promise<AccumulatedKbChatOutput> {
  const references: ChatChunkReference[] = [];
  const messages: ChatMessage[] = [];
  const events: StreamEvent<any>[] = [];
  for await (const ev of iterable) {
    events.push(ev);
    if (ev.type === "object-delta") {
      const e = ev as { port?: string; objectDelta?: unknown };
      if (e.port === "references" && Array.isArray(e.objectDelta)) {
        references.push(...(e.objectDelta as ChatChunkReference[]));
      } else if (e.port === "messages" && Array.isArray(e.objectDelta)) {
        messages.push(...(e.objectDelta as ChatMessage[]));
      }
    }
  }
  return { references, messages, events };
}

describe("AiChatWithKbTask — embedding-backed retrieval", () => {
  it("uses the supplied embedding model inside the chat run and defers unload until the shared resource scope is disposed", async () => {
    const fake = makeFakeKb({
      id: "kb-direct",
      label: "Direct KB",
      results: [
        {
          chunk_id: "c1",
          doc_id: "d1",
          score: 0.9,
          metadata: { doc_title: "Doc 1", text: "direct chunk text", url: "/help/d1" },
        } as any,
      ],
    });

    const registry = getAiProviderRegistry();
    const provider = new FakeChatKbProvider();
    let embedCalls = 0;
    let unloadCalls = 0;
    registry.registerProvider(provider);
    registry.registerRunFn("fake-chat-kb", {
      serves: ["text.embedding"],
      runFn: async (_input, _model, _signal, emit) => {
        embedCalls++;
        emit({ type: "finish", data: { vector: new Float32Array([1, 0, 0]) } });
      },
    });
    registry.registerRunFn("fake-chat-kb", {
      serves: TEXT_GENERATION,
      runFn: async (_input, _model, _signal, emit) => {
        emit({ type: "text-delta", port: "text", textDelta: "answer" });
        emit({ type: "finish", data: {} as any });
      },
    });
    registry.registerRunFn("fake-chat-kb", {
      serves: ["model.dispose"],
      runFn: async (_input, _model, _signal, emit) => {
        unloadCalls++;
        emit({ type: "finish", data: {} as any });
      },
    });

    const resourceScope = new ResourceScope();
    const connector = new FakeConnector([
      { action: "accept", content: { content: "follow up" }, done: false, requestId: "" },
      { action: "decline", content: undefined, done: true, requestId: "" },
    ]);
    const context = mkContext(connector);
    (context as any).resourceScope = resourceScope;
    (context as any).own = <T extends { runConfig?: Record<string, unknown> }>(task: T): T => {
      if (task.runConfig) {
        Object.assign(task.runConfig, { resourceScope });
      }
      return task;
    };

    const model: ModelConfig = {
      model_id: "chat-model",
      title: "Chat",
      description: "Chat",
      provider: "fake-chat-kb",
      capabilities: ["text.generation"],
      provider_config: {},
      metadata: {},
    };
    const embeddingModel: ModelConfig = {
      model_id: "embedding-model",
      title: "Embedding",
      description: "Embedding",
      provider: "fake-chat-kb",
      capabilities: ["text.embedding"],
      provider_config: {},
      metadata: {},
    };

    try {
      const task = new AiChatWithKbTask();
      await accumulateKbChatStream(
        task.executeStream(
          {
            model,
            embeddingModel,
            prompt: "tell me about doc 1",
            knowledgeBaseIds: ["kb-direct"],
            maxIterations: 2,
          } as any,
          context
        )
      );

      expect(embedCalls).toBe(2);
      expect(fake.calls).toHaveLength(0);
      expect(fake.vectorCalls).toHaveLength(2);
      expect(unloadCalls).toBe(0);

      await resourceScope.disposeAll();
      expect(unloadCalls).toBe(1);
    } finally {
      fake.unregister();
      registry.unregisterProvider("fake-chat-kb");
    }
  });
});

// ========================================================================
// Single-turn happy-path tests
// ========================================================================

describe("AiChatWithKbTask — single turn", () => {
  it("retrieves, emits per-chunk references with 1-based indices, and streams the provider", async () => {
    const fake = makeFakeKb({
      id: "kb1",
      label: "Help",
      results: [
        {
          chunk_id: "c1",
          doc_id: "d1",
          score: 0.9,
          metadata: { doc_title: "Doc 1", text: "first chunk text", url: "/help/d1" },
        } as any,
        {
          chunk_id: "c2",
          doc_id: "d2",
          score: 0.7,
          metadata: { doc_title: "Doc 2", text: "second chunk text", url: "/help/d2" },
        } as any,
      ],
    });

    let providerCalls = 0;
    let receivedSystemPrompt = "";
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      jobInput: any,
      _model,
      _signal,
      emit
    ) => {
      providerCalls++;
      const sys = (jobInput.messages as ChatMessage[]).find((m) => m.role === "system");
      receivedSystemPrompt = sys?.content[0]?.type === "text" ? sys.content[0].text : "";
      emit({ type: "text-delta", port: "text", textDelta: "hello" });
      emit({ type: "finish", data: {} as any });
    };
    const unregisterProvider = registerFakeChatKbProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "tell me about doc 1",
        knowledgeBaseIds: ["kb1"],
        maxIterations: 5,
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      const out = await accumulateKbChatStream(
        task.executeStream(input as any, mkContext(connector))
      );

      expect(providerCalls).toBe(1);
      expect(out.references.length).toBe(2);
      expect(out.references[0]).toMatchObject({
        kbId: "kb1",
        kbLabel: "Help",
        title: "Doc 1",
        url: "/help/d1",
        index: 1,
      });
      expect(out.references[1]).toMatchObject({ index: 2, url: "/help/d2" });

      expect(receivedSystemPrompt).toContain("--- Context ---");
      expect(receivedSystemPrompt).toContain("[1]");
      expect(receivedSystemPrompt).toContain("[2]");
      expect(fake.calls.length).toBe(1);
      expect(fake.calls[0]!.query).toBe("tell me about doc 1");
    } finally {
      unregisterProvider();
      fake.unregister();
    }
  });

  it("appends `#anchor` from the chunk's deepest sectionTitles entry", async () => {
    // Chunks ingested by HierarchicalChunkerTask carry `sectionTitles` so
    // the chat layer can produce section-level deep links. The slug must
    // match what the MDX rehype plugin emits as `id=…` on the heading,
    // both via @workglow/knowledge-base's slugifyHeading.
    const fake = makeFakeKb({
      id: "kb-anchor",
      label: "Blog",
      results: [
        {
          chunk_id: "c1",
          doc_id: "d1",
          score: 0.9,
          metadata: {
            text: "Map-backed store details",
            sectionTitles: ["Credential Stores", "EncryptedKvCredentialStore"],
          },
        } as any,
        {
          // Chunk without sectionTitles → URL stays as the doc URL.
          chunk_id: "c2",
          doc_id: "d2",
          score: 0.8,
          metadata: { text: "no section" },
        } as any,
        {
          // Chunk whose deepest title needs encoding (spaces + punctuation).
          chunk_id: "c3",
          doc_id: "d3",
          score: 0.7,
          metadata: {
            text: "encoded section",
            sectionTitles: ["Why?: Custom Stores"],
          },
        } as any,
      ],
      docMetadata: {
        d1: { url: "/blog/post/credential-management" },
        d2: { url: "/help/foo" },
        d3: { url: "/help/bar" },
      },
    });
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      _jobInput: any,
      _model,
      _signal,
      emit
    ) => {
      emit({ type: "text-delta", port: "text", textDelta: "ok" });
      emit({ type: "finish", data: {} as any });
    };
    const unregisterProvider = registerFakeChatKbProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "q",
        knowledgeBaseIds: ["kb-anchor"],
        maxIterations: 5,
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      const out = await accumulateKbChatStream(
        task.executeStream(input as any, mkContext(connector))
      );
      expect(out.references[0]?.url).toBe(
        "/blog/post/credential-management#EncryptedKvCredentialStore"
      );
      expect(out.references[1]?.url).toBe("/help/foo");
      expect(out.references[2]?.url).toBe("/help/bar#Why-Custom-Stores");
    } finally {
      unregisterProvider();
      fake.unregister();
    }
  });

  it("uses metadata.url when present, undefined otherwise — never falls back to sourceUri", async () => {
    // The chat layer deliberately ignores `sourceUri` because it carries
    // the raw `/raw/<domain>/...` asset path on legacy chunks. Routing
    // that through MarkdownLink's path-relative gate would produce a
    // clickable chip pointing at a non-existent page. Better to render
    // the chip without a click target.
    const fake = makeFakeKb({
      id: "kb2",
      label: "Blog",
      results: [
        {
          chunk_id: "c1",
          doc_id: "d1",
          score: 0.9,
          metadata: { text: "a", url: "/explicit" },
        } as any,
        {
          chunk_id: "c2",
          doc_id: "d2",
          score: 0.85,
          metadata: { text: "b", sourceUri: "/raw/x.mdx" },
        } as any,
        { chunk_id: "c3", doc_id: "d3", score: 0.8, metadata: { text: "c" } } as any,
      ],
    });
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      _jobInput: any,
      _model,
      _signal,
      emit
    ) => {
      emit({ type: "text-delta", port: "text", textDelta: "ok" });
      emit({ type: "finish", data: {} as any });
    };
    const unregisterProvider = registerFakeChatKbProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "q",
        knowledgeBaseIds: ["kb2"],
        maxIterations: 5,
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      const out = await accumulateKbChatStream(
        task.executeStream(input as any, mkContext(connector))
      );
      expect(out.references[0]?.url).toBe("/explicit");
      // No fallback to sourceUri: legacy chunk renders with no URL.
      expect(out.references[1]?.url).toBeUndefined();
      expect(out.references[2]?.url).toBeUndefined();
    } finally {
      unregisterProvider();
      fake.unregister();
    }
  });
});

describe("AiChatWithKbTask — no-match branches", () => {
  it("emits noMatchReply and skips the provider when zero chunks survive", async () => {
    const fake = makeFakeKb({ id: "kb-empty", results: [] });
    let providerCalls = 0;
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      _jobInput: any,
      _model,
      _signal,
      emit
    ) => {
      providerCalls++;
      emit({ type: "text-delta", port: "text", textDelta: "should-not-emit" });
      emit({ type: "finish", data: {} as any });
    };
    const unregisterProvider = registerFakeChatKbProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "q",
        knowledgeBaseIds: ["kb-empty"],
        maxIterations: 5,
        noMatchReply: "Sorry, I don't know.",
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      const out = await accumulateKbChatStream(
        task.executeStream(input as any, mkContext(connector))
      );

      expect(providerCalls).toBe(0);
      const textDeltas = out.events
        .filter((e) => e.type === "text-delta")
        .map((e: any) => e.textDelta);
      expect(textDeltas.join("")).toBe("Sorry, I don't know.");
      const lastAssistant = [...out.messages].reverse().find((m) => m.role === "assistant");
      expect(
        lastAssistant && lastAssistant.content[0]?.type === "text"
          ? (lastAssistant.content[0] as any).text
          : ""
      ).toBe("Sorry, I don't know.");
    } finally {
      unregisterProvider();
      fake.unregister();
    }
  });

  it("emits noMatchReferences verbatim on the references port when zero chunks survive", async () => {
    const fake = makeFakeKb({ id: "kb-empty2", results: [] });
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      _jobInput: any,
      _model,
      _signal,
      emit
    ) => {
      emit({ type: "text-delta", port: "text", textDelta: "ok" });
      emit({ type: "finish", data: {} as any });
    };
    const unregisterProvider = registerFakeChatKbProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "q",
        knowledgeBaseIds: ["kb-empty2"],
        maxIterations: 5,
        noMatchReply: "no info",
        noMatchReferences: [
          {
            kbId: "kb-empty2",
            kbLabel: "Help",
            title: "Browse Help",
            url: "/help",
            snippet: "Help docs",
            score: 0,
            index: 0,
          },
        ] as ChatChunkReference[],
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      const out = await accumulateKbChatStream(
        task.executeStream(input as any, mkContext(connector))
      );
      expect(out.references.length).toBe(1);
      expect(out.references[0]).toMatchObject({
        url: "/help",
        title: "Browse Help",
        index: 0,
      });
    } finally {
      unregisterProvider();
      fake.unregister();
    }
  });

  it("with no chunks and no noMatchReply: still calls the provider with empty Context block", async () => {
    const fake = makeFakeKb({ id: "kb-empty3", results: [] });
    let providerCalls = 0;
    let receivedSystemPrompt = "";
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      jobInput: any,
      _model,
      _signal,
      emit
    ) => {
      providerCalls++;
      const sys = (jobInput.messages as ChatMessage[]).find((m) => m.role === "system");
      receivedSystemPrompt = sys?.content[0]?.type === "text" ? sys.content[0].text : "";
      emit({ type: "text-delta", port: "text", textDelta: "model said" });
      emit({ type: "finish", data: {} as any });
    };
    const unregisterProvider = registerFakeChatKbProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "q",
        knowledgeBaseIds: ["kb-empty3"],
        maxIterations: 5,
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      await accumulateKbChatStream(task.executeStream(input as any, mkContext(connector)));
      expect(providerCalls).toBe(1);
      expect(receivedSystemPrompt).toContain("--- Context ---");
    } finally {
      unregisterProvider();
      fake.unregister();
    }
  });

  it("skips retrieval entirely for empty user text", async () => {
    const fake = makeFakeKb({ id: "kb-skip", results: [] });
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      _jobInput: any,
      _model,
      _signal,
      emit
    ) => {
      emit({ type: "text-delta", port: "text", textDelta: "ok" });
      emit({ type: "finish", data: {} as any });
    };
    const unregisterProvider = registerFakeChatKbProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: [{ type: "image", image: "data:image/png;base64,xxx" } as any],
        knowledgeBaseIds: ["kb-skip"],
        maxIterations: 5,
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      await accumulateKbChatStream(task.executeStream(input as any, mkContext(connector)));
      expect(fake.calls.length).toBe(0);
    } finally {
      unregisterProvider();
      fake.unregister();
    }
  });
});

describe("AiChatWithKbTask — multi-turn", () => {
  it("re-runs retrieval each turn against the latest user message", async () => {
    const fake = makeFakeKb({
      id: "kb-multi",
      label: "Help",
      results: [
        { chunk_id: "c", doc_id: "d", score: 0.9, metadata: { text: "x", url: "/help/d" } } as any,
      ],
    });
    let turnIdx = 0;
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      _jobInput: any,
      _model,
      _signal,
      emit
    ) => {
      turnIdx++;
      emit({ type: "text-delta", port: "text", textDelta: `turn-${turnIdx}` });
      emit({ type: "finish", data: {} as any });
    };
    const unregisterProvider = registerFakeChatKbProvider(stream);
    try {
      const connector = new FakeConnector([
        {
          action: "accept",
          content: { content: "follow up question" },
          done: false,
          requestId: "",
        },
        { action: "cancel", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "first question",
        knowledgeBaseIds: ["kb-multi"],
        maxIterations: 5,
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      const out = await accumulateKbChatStream(
        task.executeStream(input as any, mkContext(connector))
      );
      expect(turnIdx).toBe(2);
      expect(fake.calls.map((c) => c.query)).toEqual(["first question", "follow up question"]);
      expect(out.messages.filter((m) => m.role === "assistant").length).toBe(2);
    } finally {
      unregisterProvider();
      fake.unregister();
    }
  });

  it("on a follow-up with no new hits, reuses the previous turn's refs instead of firing noMatchReply", async () => {
    // First turn matches; follow-up ("tell me more") returns no hits.
    // Behaviour we want: the second turn keeps the conversation alive by
    // reusing the prior turn's refs as context, instead of replying with
    // the no-match boilerplate ("I don't have information…").
    let queryCount = 0;
    const kb = {
      title: "Help",
      description: "fake",
      search: async (q: string) => {
        queryCount++;
        if (q === "first question") {
          return [
            {
              chunk_id: "c1",
              doc_id: "d1",
              score: 0.9,
              metadata: { doc_title: "Credentials", text: "Map-backed", url: "/help/cred" },
            } as any,
          ];
        }
        return [];
      },
      getDocument: async (_docId: string) => ({ metadata: { url: "/help/cred" } }),
    } as unknown as KnowledgeBase;
    const live = getGlobalKnowledgeBases();
    live.set("kb-followup", kb);

    let providerCalls = 0;
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      _jobInput: any,
      _model,
      _signal,
      emit
    ) => {
      providerCalls++;
      emit({ type: "text-delta", port: "text", textDelta: `reply-${providerCalls}` });
      emit({ type: "finish", data: {} as any });
    };
    const unregisterProvider = registerFakeChatKbProvider(stream);
    try {
      const connector = new FakeConnector([
        // Follow-up that won't match the KB on its own.
        { action: "accept", content: { content: "tell me more" }, done: false, requestId: "" },
        { action: "cancel", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "first question",
        knowledgeBaseIds: ["kb-followup"],
        maxIterations: 5,
        noMatchReply: "I don't have information about that in our help docs or blog.",
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      const out = await accumulateKbChatStream(
        task.executeStream(input as any, mkContext(connector))
      );

      // Both turns hit the provider — the second turn must NOT short-circuit
      // into noMatchReply just because retrieval came back empty.
      expect(providerCalls).toBe(2);
      expect(queryCount).toBe(2);
      const textDeltas = out.events
        .filter((e) => e.type === "text-delta")
        .map((e: any) => e.textDelta as string)
        .join("");
      expect(textDeltas).not.toContain("I don't have information about that");
      // And the second turn's `references` port re-emits the carried-forward refs
      // so the chat UI can render citations against the prior chunk.
      const referencePortDeltas = out.events.filter(
        (e: any) => e.type === "object-delta" && e.port === "references"
      );
      expect(referencePortDeltas.length).toBeGreaterThanOrEqual(2);
      const secondTurnRefs = referencePortDeltas[1] as any;
      expect(Array.isArray(secondTurnRefs.objectDelta)).toBe(true);
      expect(secondTurnRefs.objectDelta.length).toBe(1);
      expect(secondTurnRefs.objectDelta[0].url).toBe("/help/cred");
    } finally {
      unregisterProvider();
      live.delete("kb-followup");
    }
  });

  it("a follow-up with no hits AND no prior hits still uses noMatchReply", async () => {
    // Regression guard for the no-match path on a true cold start: if the
    // *first* turn already has no hits, carry-forward has nothing to draw
    // on, so the no-match boilerplate must still fire.
    const fake = makeFakeKb({ id: "kb-cold", results: [] });
    let providerCalls = 0;
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      _jobInput: any,
      _model,
      _signal,
      emit
    ) => {
      providerCalls++;
      emit({ type: "text-delta", port: "text", textDelta: "should-not-emit" });
      emit({ type: "finish", data: {} as any });
    };
    const unregisterProvider = registerFakeChatKbProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "q",
        knowledgeBaseIds: ["kb-cold"],
        maxIterations: 5,
        noMatchReply: "Sorry, I don't know.",
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      const out = await accumulateKbChatStream(
        task.executeStream(input as any, mkContext(connector))
      );
      expect(providerCalls).toBe(0);
      const textDeltas = out.events
        .filter((e) => e.type === "text-delta")
        .map((e: any) => e.textDelta as string)
        .join("");
      expect(textDeltas).toBe("Sorry, I don't know.");
    } finally {
      unregisterProvider();
      fake.unregister();
    }
  });

  it("connector cancel ends the loop and emits a bare finish", async () => {
    const fake = makeFakeKb({
      id: "kb-cancel",
      results: [
        { chunk_id: "c", doc_id: "d", score: 0.9, metadata: { text: "x", url: "/help/d" } } as any,
      ],
    });
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      _jobInput: any,
      _model,
      _signal,
      emit
    ) => {
      emit({ type: "text-delta", port: "text", textDelta: "ok" });
      emit({ type: "finish", data: {} as any });
    };
    const unregisterProvider = registerFakeChatKbProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "cancel", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "q",
        knowledgeBaseIds: ["kb-cancel"],
        maxIterations: 5,
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      const out = await accumulateKbChatStream(
        task.executeStream(input as any, mkContext(connector))
      );
      // The finish event now carries the `iterations` field via `data`
      // (required-but-non-streamed output schema field — see review fix
      // for libs PR #482). On cancel after the first assistant turn the
      // count is 1.
      const finish = out.events.find((e) => e.type === "finish") as any;
      expect(finish).toBeDefined();
      expect(finish.data).toEqual({ iterations: 1 });
    } finally {
      unregisterProvider();
      fake.unregister();
    }
  });
});

describe("AiChatWithKbTask — responseFormat", () => {
  it("schema declares responseFormat with default 'text'", () => {
    const schema = AiChatWithKbTask.inputSchema() as any;
    expect(schema.properties.responseFormat).toBeDefined();
    expect(schema.properties.responseFormat.enum).toEqual(["text", "markdown"]);
    expect(schema.properties.responseFormat.default).toBe("text");
  });

  it("when 'markdown', injects the markdown addendum AND the inline-citation directive", async () => {
    const fake = makeFakeKb({
      id: "kb1",
      label: "Help",
      results: [
        {
          chunk_id: "c1",
          doc_id: "d1",
          score: 0.9,
          metadata: { doc_title: "Doc 1", text: "A", url: "/help/d1" },
        } as any,
      ],
    });
    let capturedSystemPrompt = "";
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      taskInput: any,
      _model,
      _signal,
      emit
    ) => {
      const sys = (taskInput.messages as ChatMessage[]).find((m) => m.role === "system");
      capturedSystemPrompt = sys?.content[0]?.type === "text" ? sys.content[0].text : "";
      emit({ type: "text-delta", port: "text", textDelta: "ok" });
      emit({ type: "finish", data: {} as any });
    };
    const unregister = registerFakeChatKbProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "what is doc 1?",
        knowledgeBaseIds: ["kb1"],
        systemPrompt: "You are helpful.",
        responseFormat: "markdown" as const,
        maxIterations: 1,
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      for await (const _ev of task.executeStream(input as any, mkContext(connector))) {
        // drain
      }
      expect(capturedSystemPrompt).toContain("You are helpful.");
      expect(capturedSystemPrompt).toContain("GitHub-flavored Markdown");
      expect(capturedSystemPrompt).toContain("Markdown link");
      expect(capturedSystemPrompt).toContain("Do not use numeric `[1]`-style");
      expect(capturedSystemPrompt).toContain("--- Context ---");
    } finally {
      unregister();
      fake.unregister();
    }
  });

  it("markdown-mode chunk formatter emits the URL line for chunks with metadata.url", async () => {
    const fake = makeFakeKb({
      id: "kb1",
      label: "Help",
      results: [
        {
          chunk_id: "c1",
          doc_id: "d1",
          score: 0.9,
          metadata: { doc_title: "Doc 1", text: "first", url: "/help/d1" },
        } as any,
        {
          chunk_id: "c2",
          doc_id: "d2",
          score: 0.7,
          metadata: { doc_title: "Doc 2", text: "second" /* no url */ },
        } as any,
      ],
    });
    let captured = "";
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      taskInput: any,
      _model,
      _signal,
      emit
    ) => {
      const sys = (taskInput.messages as ChatMessage[]).find((m) => m.role === "system");
      captured = sys?.content[0]?.type === "text" ? sys.content[0].text : "";
      emit({ type: "text-delta", port: "text", textDelta: "ok" });
      emit({ type: "finish", data: {} as any });
    };
    const unregister = registerFakeChatKbProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "q",
        knowledgeBaseIds: ["kb1"],
        responseFormat: "markdown" as const,
        maxIterations: 1,
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      for await (const _ev of task.executeStream(input as any, mkContext(connector))) {
        // drain
      }
      // Doc 1 has a URL — expect a URL-bearing line.
      expect(captured).toMatch(/\[1\].*\[Help\].*\(Doc 1\).*<\/help\/d1>/);
      // Doc 2 has no URL — expect the legacy single-line shape.
      expect(captured).toMatch(/\[2\] \[Help\] \(Doc 2\) second/);
    } finally {
      unregister();
      fake.unregister();
    }
  });

  it("when 'text' (default), system prompt and chunk formatter are unchanged from today", async () => {
    const fake = makeFakeKb({
      id: "kb1",
      label: "Help",
      results: [
        {
          chunk_id: "c1",
          doc_id: "d1",
          score: 0.9,
          metadata: { doc_title: "Doc 1", text: "A", url: "/help/d1" },
        } as any,
      ],
    });
    let captured = "";
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      taskInput: any,
      _model,
      _signal,
      emit
    ) => {
      const sys = (taskInput.messages as ChatMessage[]).find((m) => m.role === "system");
      captured = sys?.content[0]?.type === "text" ? sys.content[0].text : "";
      emit({ type: "text-delta", port: "text", textDelta: "ok" });
      emit({ type: "finish", data: {} as any });
    };
    const unregister = registerFakeChatKbProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "q",
        knowledgeBaseIds: ["kb1"],
        systemPrompt: "You are helpful.",
        maxIterations: 1,
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      for await (const _ev of task.executeStream(input as any, mkContext(connector))) {
        // drain
      }
      expect(captured).not.toContain("GitHub-flavored Markdown");
      expect(captured).not.toContain("Markdown link");
      expect(captured).toMatch(/\[1\] \[Help\] \(Doc 1\) A/);
      // No `<url>` brackets in text mode.
      expect(captured).not.toContain("</help/d1>");
    } finally {
      unregister();
      fake.unregister();
    }
  });
});

describe("AiChatWithKbTask — usage aggregation across turns", () => {
  function mkUsage(partial: Partial<Usage>): Usage {
    return {
      input: undefined,
      output: undefined,
      cached: undefined,
      cacheWrite: undefined,
      reasoning: undefined,
      total: undefined,
      extra: undefined,
      ...partial,
    };
  }

  function mkKb(id: string) {
    return makeFakeKb({
      id,
      label: "Help",
      results: [
        {
          chunk_id: "c1",
          doc_id: "d1",
          score: 0.9,
          metadata: { doc_title: "Doc 1", text: "chunk" },
        } as any,
      ],
    });
  }

  it("sums every turn's usage onto the outer finish, alongside iterations", async () => {
    const fake = mkKb("kb-usage");

    // Each turn is its own provider request reporting its own token counts.
    const perTurnUsage = [
      mkUsage({ input: 100, output: 10, cached: 80, extra: { audioTokens: 4, tier: "standard" } }),
      mkUsage({ input: 150, output: 20, cached: 120, extra: { audioTokens: 6, tier: "priority" } }),
    ];
    let turn = 0;
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      _taskInput,
      _model,
      _signal,
      emit
    ) => {
      const usage = perTurnUsage[Math.min(turn, perTurnUsage.length - 1)];
      turn++;
      emit({ type: "text-delta", port: "text", textDelta: "answer" });
      emit({ type: "finish", data: {} as any, usage } as any);
    };
    const unregister = registerFakeChatKbProvider(stream);

    try {
      const connector = new FakeConnector([
        { action: "accept", content: { content: "follow up" }, done: false, requestId: "" },
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "q",
        knowledgeBaseIds: ["kb-usage"],
        maxIterations: 5,
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      const { events } = await accumulateKbChatStream(
        task.executeStream(input as any, mkContext(connector))
      );

      // Exactly two provider turns ran, so exactly two usages compose.
      expect(turn).toBe(2);
      const finishes = events.filter((e) => e.type === "finish");
      // Inner-turn finishes stay swallowed; only the outer one reaches the consumer.
      expect(finishes).toHaveLength(1);
      const outer = finishes[0] as { data: { iterations: number }; usage?: Usage };
      expect(outer.data.iterations).toBe(2);
      // Counters sum across turns; the string label takes the later turn's value.
      expect(outer.usage).toEqual(
        mkUsage({
          input: 250,
          output: 30,
          cached: 200,
          extra: { audioTokens: 10, tier: "priority" },
        })
      );
    } finally {
      unregister();
      fake.unregister();
    }
  });

  it("does not double-count: one turn reports exactly that turn's usage", async () => {
    const fake = mkKb("kb-usage-1");
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      _taskInput,
      _model,
      _signal,
      emit
    ) => {
      emit({ type: "text-delta", port: "text", textDelta: "answer" });
      emit({
        type: "finish",
        data: {} as any,
        usage: mkUsage({ input: 100, output: 10 }),
      } as any);
    };
    const unregister = registerFakeChatKbProvider(stream);

    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "q",
        knowledgeBaseIds: ["kb-usage-1"],
        maxIterations: 5,
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      const { events } = await accumulateKbChatStream(
        task.executeStream(input as any, mkContext(connector))
      );

      const outer = events.find((e) => e.type === "finish") as { usage?: Usage };
      expect(outer.usage).toEqual(mkUsage({ input: 100, output: 10 }));
    } finally {
      unregister();
      fake.unregister();
    }
  });

  it("omits usage entirely when no turn reported any", async () => {
    const fake = mkKb("kb-usage-none");
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      _taskInput,
      _model,
      _signal,
      emit
    ) => {
      emit({ type: "text-delta", port: "text", textDelta: "answer" });
      emit({ type: "finish", data: {} as any });
    };
    const unregister = registerFakeChatKbProvider(stream);

    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "q",
        knowledgeBaseIds: ["kb-usage-none"],
        maxIterations: 5,
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);
      const { events } = await accumulateKbChatStream(
        task.executeStream(input as any, mkContext(connector))
      );

      const outer = events.find((e) => e.type === "finish")!;
      expect("usage" in outer).toBe(false);
    } finally {
      unregister();
      fake.unregister();
    }
  });
});

describe("AiChatWithKbTask — usage telemetry", () => {
  function mkUsage(partial: Partial<Usage>): Usage {
    return {
      input: undefined,
      output: undefined,
      cached: undefined,
      cacheWrite: undefined,
      reasoning: undefined,
      total: undefined,
      extra: undefined,
      ...partial,
    };
  }

  /**
   * Intercepts the debug line `recordUsageTelemetry` writes. The logger is
   * global, so restoration is mandatory or sibling tests in this worker
   * inherit the stub.
   */
  async function withRecordedUsage(
    body: () => Promise<void>
  ): Promise<Array<Record<string, unknown> | undefined>> {
    const recorded: Array<Record<string, unknown> | undefined> = [];
    const previous = getLogger();
    setLogger({
      ...previous,
      debug: (message: string, meta?: Record<string, unknown>) => {
        if (message.startsWith("AI usage for")) recorded.push(meta);
      },
    } as ILogger);
    try {
      await body();
    } finally {
      setLogger(previous);
    }
    return recorded;
  }

  it("records usage telemetry once for the whole conversation", async () => {
    const fake = makeFakeKb({
      id: "kb-usage-telemetry",
      label: "Help",
      results: [
        {
          chunk_id: "c1",
          doc_id: "d1",
          score: 0.9,
          metadata: { doc_title: "Doc 1", text: "chunk" },
        } as any,
      ],
    });
    const perTurnUsage = [mkUsage({ input: 100, output: 10 }), mkUsage({ input: 150, output: 20 })];
    let turn = 0;
    const stream: AiProviderRunFn<any, any, ModelConfig> = async (
      _taskInput,
      _model,
      _signal,
      emit
    ) => {
      const usage = perTurnUsage[Math.min(turn, perTurnUsage.length - 1)];
      turn++;
      emit({ type: "text-delta", port: "text", textDelta: "answer" });
      emit({ type: "finish", data: {} as any, usage } as any);
    };
    const unregister = registerFakeChatKbProvider(stream);

    try {
      const connector = new FakeConnector([
        { action: "accept", content: { content: "follow up" }, done: false, requestId: "" },
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "q",
        knowledgeBaseIds: ["kb-usage-telemetry"],
        maxIterations: 5,
      };
      const task = new AiChatWithKbTask({ defaults: input } as any);

      const recorded = await withRecordedUsage(async () => {
        await accumulateKbChatStream(task.executeStream(input as any, mkContext(connector)));
      });

      expect(turn).toBe(2);
      // One record for the run, not one per turn.
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.usage).toEqual(mkUsage({ input: 250, output: 30 }));
      expect(recorded[0]?.model).toBe("fake-model");
    } finally {
      unregister();
      fake.unregister();
    }
  });
});

describe("AiChatWithKbTask — usage model attribution", () => {
  it("names the chat model, not the embedding model, on the task's run usage model id", async () => {
    const fake = makeFakeKb({
      id: "kb-usage-attribution",
      label: "Attribution KB",
      results: [
        {
          chunk_id: "c1",
          doc_id: "d1",
          score: 0.9,
          metadata: { doc_title: "Doc 1", text: "chunk text", url: "/help/d1" },
        } as any,
      ],
    });

    const registry = getAiProviderRegistry();
    registry.registerProvider(new FakeChatKbProvider());
    registry.registerRunFn("fake-chat-kb", {
      serves: ["text.embedding"],
      runFn: async (_input, _model, _signal, emit) => {
        emit({ type: "finish", data: { vector: new Float32Array([1, 0, 0]) } });
      },
    });
    registry.registerRunFn("fake-chat-kb", {
      serves: TEXT_GENERATION,
      runFn: async (_input, _model, _signal, emit) => {
        emit({ type: "text-delta", port: "text", textDelta: "answer" });
        emit({ type: "finish", data: {} as any });
      },
    });

    const model: ModelConfig = {
      model_id: "chat-model",
      title: "Chat",
      description: "Chat",
      provider: "fake-chat-kb",
      capabilities: ["text.generation"],
      provider_config: {},
      metadata: {},
    };
    const embeddingModel: ModelConfig = {
      model_id: "embedding-model",
      title: "Embedding",
      description: "Embedding",
      provider: "fake-chat-kb",
      capabilities: ["text.embedding"],
      provider_config: {},
      metadata: {},
    };

    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const context = mkContext(connector);
      (context as any).resourceScope = new ResourceScope();
      const task = new AiChatWithKbTask();
      await accumulateKbChatStream(
        task.executeStream(
          {
            model,
            embeddingModel,
            prompt: "tell me about doc 1",
            knowledgeBaseIds: ["kb-usage-attribution"],
            maxIterations: 2,
          } as any,
          context
        )
      );

      // The generation spend belongs to the chat model. Attributing it to the
      // embedding model (or to nothing) misfiles every token in byModel().
      expect(task.runUsageModelId).toBe("chat-model");
    } finally {
      fake.unregister();
      registry.unregisterProvider("fake-chat-kb");
    }
  });
});

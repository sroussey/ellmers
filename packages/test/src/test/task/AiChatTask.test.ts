/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderLegacyStreamFnRegistration,
  AiProviderStreamFn,
  Capability,
  ChatMessage,
  ModelConfig,
} from "@workglow/ai";
import { AiChatTask, AiProvider, getAiProviderRegistry, registerAiTasks } from "@workglow/ai";
import type { IExecuteContext, StreamEvent } from "@workglow/task-graph";
import { TaskRegistry } from "@workglow/task-graph";
import type { IHumanConnector, IHumanRequest, IHumanResponse } from "@workglow/util";
import { Container, HUMAN_CONNECTOR, ServiceRegistry } from "@workglow/util";
import { describe, expect, it } from "vitest";

const TEXT_GENERATION: readonly Capability[] = ["text.generation"];

describe.skip("AiChatTask — schema and registration", () => {
  it("has required static properties", () => {
    expect(AiChatTask.type).toBe("AiChatTask");
    expect(AiChatTask.category).toBe("AI Chat");
    expect(AiChatTask.cacheable).toBe(false);
  });

  it("declares input schema with required model and prompt", () => {
    const schema = AiChatTask.inputSchema() as any;
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("model");
    expect(schema.required).toContain("prompt");
    expect(schema.properties.maxIterations).toBeDefined();
  });

  it("declares output schema with text streaming", () => {
    const schema = AiChatTask.outputSchema() as any;
    expect(schema.properties.text["x-stream"]).toBe("append");
    expect(schema.properties.messages["x-stream"]).toBe("object");
    expect(schema.properties.iterations).toBeDefined();
  });

  it("registers via registerAiTasks()", () => {
    registerAiTasks();
    expect(TaskRegistry.all.get("AiChatTask")).toBe(AiChatTask);
  });
});

// ========================================================================
// Chat-loop tests
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
    provider: "fake-chat",
    model: "fake-model",
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

/** Concrete AiProvider for tests — abstract members filled with minimal stubs. */
class FakeChatProvider extends AiProvider {
  override readonly name = "fake-chat";
  override readonly displayName = "Fake Chat";
  override readonly isLocal = true;
  override readonly supportsBrowser = false;

  constructor(runFns?: readonly AiProviderLegacyStreamFnRegistration<any, any, ModelConfig>[]) {
    super(runFns);
  }
}

function registerFakeChatProvider(stream: AiProviderStreamFn<any, any, ModelConfig>): () => void {
  const registry = getAiProviderRegistry();
  const provider = new FakeChatProvider([{ serves: TEXT_GENERATION, runFn: stream }]);
  registry.registerProvider(provider);
  registry.registerLegacyStreamFn("fake-chat", { serves: TEXT_GENERATION, runFn: stream });
  return () => registry.unregisterProvider("fake-chat");
}

interface AccumulatedChatOutput {
  readonly text: string;
  readonly messages: ChatMessage[];
  readonly iterations: number;
  readonly events: StreamEvent<any>[];
}

/**
 * Drives a streaming chat task to completion and assembles the final
 * accumulator state from the emitted deltas — the same way the runtime
 * accumulates output via the task's x-stream declarations. Used after
 * AiChatTask drops finish.data and the execute() override.
 */
async function accumulateChatStream(
  iterable: AsyncIterable<StreamEvent<any>>
): Promise<AccumulatedChatOutput> {
  const messages: ChatMessage[] = [];
  const events: StreamEvent<any>[] = [];
  for await (const ev of iterable) {
    events.push(ev);
    if (ev.type === "object-delta" && (ev as any).port === "messages") {
      const items = (ev as any).objectDelta as ChatMessage[];
      messages.push(...items);
    }
  }
  // `text` accumulates across all turns; AiChatTask resets per turn so the
  // last assistant message's text is the final-turn text.
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const finalText =
    lastAssistant && lastAssistant.content[0]?.type === "text"
      ? (lastAssistant.content[0] as { type: "text"; text: string }).text
      : "";
  const iterations = messages.filter((m) => m.role === "assistant").length;
  return { text: finalText, messages, iterations, events };
}

describe.skip("AiChatTask — streaming output accumulation", () => {
  it("drives the stream to completion and accumulates final output via deltas", async () => {
    const stream: AiProviderStreamFn<any, any, ModelConfig> = async function* () {
      yield { type: "text-delta", port: "text", textDelta: "ok" };
      yield { type: "finish", data: {} as any };
    };
    const unregister = registerFakeChatProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);

      const input = {
        model: mkModel(),
        prompt: "hi",
        systemPrompt: undefined,
        maxTokens: undefined,
        temperature: undefined,
        maxIterations: 10,
        messages: undefined,
      };

      const task = new AiChatTask({ defaults: input });

      const result = await accumulateChatStream(
        task.executeStream(input as any, mkContext(connector))
      );
      expect(result.text).toBe("ok");
      expect(result.iterations).toBe(1);
      expect(result.messages.length).toBeGreaterThanOrEqual(2);
    } finally {
      unregister();
    }
  });
});

describe.skip("AiChatTask — connector resolution", () => {
  it("throws a helpful error when HUMAN_CONNECTOR is not registered", async () => {
    const stream: AiProviderStreamFn<any, any, ModelConfig> = async function* () {
      yield { type: "text-delta", port: "text", textDelta: "ok" };
      yield { type: "finish", data: {} as any };
    };
    const unregister = registerFakeChatProvider(stream);
    try {
      const input = {
        model: mkModel(),
        prompt: "hi",
        systemPrompt: undefined,
        maxTokens: undefined,
        temperature: undefined,
        maxIterations: 10,
        messages: undefined,
      };

      const task = new AiChatTask({ defaults: input } as any);

      await expect(
        (async () => {
          for await (const _ of task.executeStream(input as any, mkContext())) {
            // drain
          }
        })()
      ).rejects.toThrow(/HUMAN_CONNECTOR not registered/);
    } finally {
      unregister();
    }
  });
});

describe.skip("AiChatTask — chat loop", () => {
  it("runs one turn then stops on decline", async () => {
    const calls: number[] = [];
    const stream: AiProviderStreamFn<any, any, ModelConfig> = async function* () {
      calls.push(1);
      yield { type: "text-delta", port: "text", textDelta: "Hello" };
      yield { type: "text-delta", port: "text", textDelta: " there" };
      yield { type: "finish", data: {} as any };
    };
    const unregister = registerFakeChatProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);

      const input = {
        model: mkModel(),
        prompt: "hi",
        systemPrompt: undefined,
        maxTokens: undefined,
        temperature: undefined,
        maxIterations: 10,
        messages: undefined,
      };

      const task = new AiChatTask({ defaults: input });

      const result = await accumulateChatStream(
        task.executeStream(input as any, mkContext(connector))
      );
      const textDeltas = result.events
        .filter((e) => e.type === "text-delta")
        .map((e: any) => e.textDelta);
      expect(textDeltas.join("")).toBe("Hello there");
      expect(result.iterations).toBe(1);
      expect(calls.length).toBe(1);
      expect(connector.sent.length).toBe(1);
    } finally {
      unregister();
    }
  });

  it("runs two turns when connector accepts a follow-up", async () => {
    let callIdx = 0;
    const stream: AiProviderStreamFn<any, any, ModelConfig> = async function* () {
      callIdx++;
      yield { type: "text-delta", port: "text", textDelta: `Turn ${callIdx}` };
      yield { type: "finish", data: {} as any };
    };
    const unregister = registerFakeChatProvider(stream);
    try {
      const connector = new FakeConnector([
        {
          action: "accept",
          content: { content: [{ type: "text", text: "more" }] },
          done: false,
          requestId: "",
        },
        { action: "cancel", content: undefined, done: true, requestId: "" },
      ]);

      const input = {
        model: mkModel(),
        prompt: "hi",
        systemPrompt: undefined,
        maxTokens: undefined,
        temperature: undefined,
        maxIterations: 10,
        messages: undefined,
      };

      const task = new AiChatTask({ defaults: input });

      const result = await accumulateChatStream(
        task.executeStream(input as any, mkContext(connector))
      );
      expect(result.iterations).toBe(2);
      expect(result.text).toBe("Turn 2"); // last turn only, not "Turn 1Turn 2"
      expect(result.messages.length).toBeGreaterThan(2);
      expect(callIdx).toBe(2);
    } finally {
      unregister();
    }
  });

  it("maxIterations cap terminates the loop after exactly N turns", async () => {
    let callIdx = 0;
    const stream: AiProviderStreamFn<any, any, ModelConfig> = async function* () {
      callIdx++;
      yield { type: "text-delta", port: "text", textDelta: `T${callIdx}` };
      yield { type: "finish", data: {} as any };
    };
    const unregister = registerFakeChatProvider(stream);
    try {
      // Connector always accepts with done:false so the loop never stops naturally.
      const connector = new FakeConnector(
        Array.from({ length: 10 }, () => ({
          action: "accept" as const,
          content: { content: [{ type: "text" as const, text: "continue" }] },
          done: false,
          requestId: "",
        }))
      );

      const input = {
        model: mkModel(),
        prompt: "hi",
        systemPrompt: undefined,
        maxTokens: undefined,
        temperature: undefined,
        maxIterations: 3,
        messages: undefined,
      };

      const task = new AiChatTask({ defaults: input });

      const result = await accumulateChatStream(
        task.executeStream(input as any, mkContext(connector))
      );

      expect(result.events.find((e) => e.type === "finish")).toBeDefined();
      expect(result.iterations).toBe(3);
      expect(callIdx).toBe(3);
    } finally {
      unregister();
    }
  });

  it("aborts mid-turn when context.signal fires", async () => {
    const stream: AiProviderStreamFn<any, any, ModelConfig> = async function* (
      _in,
      _m,
      signal: AbortSignal
    ) {
      yield { type: "text-delta", port: "text", textDelta: "start" };
      // Simulate an in-flight provider call that checks the signal.
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => {
          signal.removeEventListener("abort", onAbort);
          reject(new Error("aborted"));
        };
        signal.addEventListener("abort", onAbort);
      });
      yield { type: "finish", data: {} as any };
    };
    const unregister = registerFakeChatProvider(stream);
    try {
      const controller = new AbortController();
      const connector = new FakeConnector([]);
      const registry = new ServiceRegistry(new Container());
      registry.registerInstance(HUMAN_CONNECTOR, connector);
      const context: IExecuteContext = {
        signal: controller.signal,
        updateProgress: async () => {},
        own: <T>(i: T) => i,
        registry,
        resourceScope: {
          register: (_key: string, _fn: () => Promise<void>) => {},
          dispose: async () => {},
        } as any,
      } as unknown as IExecuteContext;

      const input = {
        model: mkModel(),
        prompt: "hi",
        systemPrompt: undefined,
        maxTokens: undefined,
        temperature: undefined,
        maxIterations: 10,
        messages: undefined,
      };

      const task = new AiChatTask({ defaults: input });

      // Trigger abort after a tick so we enter the stream first.
      setTimeout(() => controller.abort(), 10);

      await expect(
        (async () => {
          for await (const _ of task.executeStream(input as any, context)) {
            // drain
          }
        })()
      ).rejects.toThrow(/aborted/);
    } finally {
      unregister();
    }
  });

  it("propagates connector errors out of executeStream", async () => {
    class ThrowingConnector implements IHumanConnector {
      async send(): Promise<IHumanResponse> {
        throw new Error("boom");
      }
    }

    const stream: AiProviderStreamFn<any, any, ModelConfig> = async function* () {
      yield { type: "text-delta", port: "text", textDelta: "ok" };
      yield { type: "finish", data: {} as any };
    };
    const unregister = registerFakeChatProvider(stream);
    try {
      const input = {
        model: mkModel(),
        prompt: "hi",
        systemPrompt: undefined,
        maxTokens: undefined,
        temperature: undefined,
        maxIterations: 10,
        messages: undefined,
      };

      const task = new AiChatTask({ defaults: input });

      await expect(
        (async () => {
          for await (const _ of task.executeStream(
            input as any,
            mkContext(new ThrowingConnector())
          )) {
            // drain
          }
        })()
      ).rejects.toThrow(/boom/);
    } finally {
      unregister();
    }
  });

  it("accepts ContentBlock[] as prompt and preserves block shape in history", async () => {
    const stream: AiProviderStreamFn<any, any, ModelConfig> = async function* () {
      yield { type: "text-delta", port: "text", textDelta: "response" };
      yield { type: "finish", data: {} as any };
    };
    const unregister = registerFakeChatProvider(stream);
    try {
      const blocks = [
        { type: "text" as const, text: "Hello" },
        { type: "image" as const, mimeType: "image/png", data: "base64data" },
      ];

      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);

      const input = {
        model: mkModel(),
        prompt: blocks,
        systemPrompt: undefined,
        maxTokens: undefined,
        temperature: undefined,
        maxIterations: 10,
        messages: undefined,
      };

      const task = new AiChatTask({ defaults: input });

      const result = await accumulateChatStream(
        task.executeStream(input as any, mkContext(connector))
      );
      // No systemPrompt, so index 0 is the initial user message.
      const userMsg = result.messages[0];
      expect(userMsg.role).toBe("user");
      expect(userMsg.content).toEqual(blocks);
    } finally {
      unregister();
    }
  });
});

describe.skip("AiChatTask — responseFormat", () => {
  it("schema declares responseFormat with default 'text'", () => {
    const schema = AiChatTask.inputSchema() as any;
    expect(schema.properties.responseFormat).toBeDefined();
    expect(schema.properties.responseFormat.enum).toEqual(["text", "markdown"]);
    expect(schema.properties.responseFormat.default).toBe("text");
  });

  it("when 'markdown', appends the markdown addendum to the per-turn system prompt", async () => {
    let capturedSystemPrompt: string | undefined;
    const stream: AiProviderStreamFn<any, any, ModelConfig> = async function* (taskInput: any) {
      const sys = (taskInput.messages as ChatMessage[] | undefined)?.find(
        (m) => m.role === "system"
      );
      capturedSystemPrompt = sys?.content[0]?.type === "text" ? sys.content[0].text : "";
      yield { type: "text-delta", port: "text", textDelta: "ok" };
      yield { type: "finish", data: {} as any };
    };
    const unregister = registerFakeChatProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "hello",
        systemPrompt: "You are helpful.",
        responseFormat: "markdown" as const,
        maxIterations: 1,
      };
      const task = new AiChatTask({ defaults: input } as any);
      for await (const _ev of task.executeStream(input as any, mkContext(connector))) {
        // drain
      }
      expect(capturedSystemPrompt).toContain("You are helpful.");
      expect(capturedSystemPrompt).toContain("GitHub-flavored Markdown");
    } finally {
      unregister();
    }
  });

  it("when 'text' (or omitted), the per-turn system prompt is the raw input.systemPrompt", async () => {
    let capturedSystemPrompt: string | undefined;
    const stream: AiProviderStreamFn<any, any, ModelConfig> = async function* (taskInput: any) {
      const sys = (taskInput.messages as ChatMessage[] | undefined)?.find(
        (m) => m.role === "system"
      );
      capturedSystemPrompt = sys?.content[0]?.type === "text" ? sys.content[0].text : "";
      yield { type: "text-delta", port: "text", textDelta: "ok" };
      yield { type: "finish", data: {} as any };
    };
    const unregister = registerFakeChatProvider(stream);
    try {
      const connector = new FakeConnector([
        { action: "decline", content: undefined, done: true, requestId: "" },
      ]);
      const input = {
        model: mkModel(),
        prompt: "hello",
        systemPrompt: "You are helpful.",
        maxIterations: 1,
      };
      const task = new AiChatTask({ defaults: input } as any);
      for await (const _ev of task.executeStream(input as any, mkContext(connector))) {
        // drain
      }
      expect(capturedSystemPrompt).toBe("You are helpful.");
      expect(capturedSystemPrompt).not.toContain("GitHub-flavored Markdown");
    } finally {
      unregister();
    }
  });
});

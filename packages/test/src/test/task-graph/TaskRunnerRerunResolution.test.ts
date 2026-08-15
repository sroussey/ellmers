/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig, ModelRecord } from "@workglow/ai";
import { getGlobalModelRepository, ModelConfigSchema } from "@workglow/ai";
import type { IExecuteContext } from "@workglow/task-graph";
import { Task, TaskConfigurationError } from "@workglow/task-graph";
import type { ICredentialStore, ServiceRegistry } from "@workglow/util";
import {
  Container,
  getGlobalCredentialStore,
  InMemoryCredentialStore,
  registerCredentialDefaults,
  ServiceRegistry as ServiceRegistryClass,
  setGlobalCredentialStore,
} from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeEach, describe, expect, test } from "vitest";

/**
 * `TaskRunner.resolveSchemas` writes a resolved value back onto the very port it
 * read the reference id from, and `run()` MERGES overrides into `runInputData`
 * rather than resetting it (`Task.setInput` skips `undefined` and leaves absent
 * keys untouched; neither `run()` nor `runPreview()` calls `resetInputData()`).
 * A second standalone run of one instance therefore re-resolves whatever the
 * first run left on the port.
 *
 * For `format: "model"` that is harmless — the resolver ignores a non-string, so
 * pass 2 is a no-op. `format: "credential"` is the lossy exception: it resolves
 * string → string, and on a store MISS it deliberately returns `undefined`
 * rather than echoing the id (echoing would send a credential's name as its
 * value). So run 2 looks the SECRET up as if it were a key, misses, and blanks
 * the port while leaving it an own property.
 *
 * Graph runs escape this entirely — `TaskGraphRunner.run` → `resetGraph` →
 * `EdgeMaterializer.resetTask` → `resetInputData()` puts the raw id back before
 * every run — and so do keys supplied as `run()` overrides, since `setInput`
 * rewrites those ports each time. What is left broken, and what these tests
 * pin, is the instance whose key lives in `defaults` and which is run twice
 * directly.
 */
describe("TaskRunner re-run input resolution", () => {
  const SECRET = "https://hooks.example.com/T000/B000/XXXXXXXX";
  const CREDENTIAL_KEY = "webhook-url";

  /**
   * A registry scoped to its own container so the credential store never leaks
   * into the global registry shared by the other suites in this section.
   */
  const createCredentialRegistry = async (
    entries: Readonly<Record<string, string>> = { [CREDENTIAL_KEY]: SECRET }
  ): Promise<ServiceRegistry> => {
    const registry = new ServiceRegistryClass(new Container());
    registerCredentialDefaults(registry);
    const store: ICredentialStore = new InMemoryCredentialStore();
    for (const [key, value] of Object.entries(entries)) {
      await store.put(key, value);
    }
    setGlobalCredentialStore(store, registry);
    return registry;
  };

  interface NotifyInput extends Record<string, unknown> {
    url_credential_key?: string;
    text?: string;
  }
  interface NotifyOutput extends Record<string, unknown> {
    posted_to: string;
  }

  /** Every URL a {@link WebhookNotifyTask} instance posted to, in order. */
  const posted: Array<{ url: string; text: string | undefined }> = [];

  /**
   * Stands in for a webhook-notify task: its endpoint URL lives in the
   * credential store, so the port carries a key on the way in and the secret
   * URL by the time `execute` sees it. Fail-closed — a blank URL is a
   * configuration error, never a silent no-op.
   */
  class WebhookNotifyTask extends Task<NotifyInput, NotifyOutput> {
    public static override type = "WebhookNotifyTask";
    public static override readonly title = "Webhook Notify";
    // Two runs of one instance is exactly the shape a cache hit would hide:
    // a served run never reaches `execute`, so the assertions would pass
    // without the second resolution ever happening.
    public static override cacheable = false;

    public static override inputSchema(): DataPortSchema {
      return {
        type: "object",
        properties: {
          url_credential_key: { type: "string", format: "credential" },
          text: { type: "string" },
        },
        additionalProperties: false,
      } as const satisfies DataPortSchema;
    }

    public static override outputSchema(): DataPortSchema {
      return {
        type: "object",
        properties: { posted_to: { type: "string" } },
        required: ["posted_to"],
        additionalProperties: false,
      } as const satisfies DataPortSchema;
    }

    override async execute(input: NotifyInput, _context: IExecuteContext): Promise<NotifyOutput> {
      const url = input.url_credential_key;
      if (!url) {
        throw new TaskConfigurationError("WebhookNotifyTask: no webhook URL was resolved.");
      }
      posted.push({ url, text: input.text });
      return { posted_to: url };
    }

    override async executePreview(input: NotifyInput): Promise<NotifyOutput> {
      return { posted_to: input.url_credential_key ?? "" };
    }
  }

  beforeEach(() => {
    posted.length = 0;
  });

  describe("re-run with a credential-backed URL", () => {
    /**
     * The regression: before the fix, run 2 resolved the SECRET as if it were a
     * key, missed, and left the port `undefined` — so a fail-closed task threw
     * and `FetchUrlTask` silently dropped its `Authorization` header. The
     * assertion is deliberately on the FIXED behaviour (two posts to the same
     * URL) rather than on either pre-fix error shape.
     */
    test("a defaults-configured credential key survives a second run", async () => {
      const registry = await createCredentialRegistry();
      const task = new WebhookNotifyTask({
        defaults: { url_credential_key: CREDENTIAL_KEY },
      });

      await task.run({ text: "one" }, { registry });
      await task.run({ text: "two" }, { registry });

      expect(posted).toEqual([
        { url: SECRET, text: "one" },
        { url: SECRET, text: "two" },
      ]);
    });

    /**
     * `runPreview()` shares `resolveSchemas` with `run()`, so a preview alone is
     * enough to burn the port for the real run that follows. Two different entry
     * points, one memo — the revert has to live on the runner, not inside `run`.
     *
     * `runPreview` takes no run config, so it resolves against the runner's own
     * registry (the global one); the key is put on the global store and removed
     * again rather than scoped to a private container like the other tests.
     */
    test("a preview followed by a run resolves the key both times", async () => {
      const key = "webhook-url-preview";
      const store = getGlobalCredentialStore();
      await store.put(key, SECRET);
      try {
        const task = new WebhookNotifyTask({ defaults: { url_credential_key: key } });

        const preview = await task.runPreview({ text: "preview" });
        expect(preview.posted_to).toBe(SECRET);

        const result = await task.run({ text: "real" });
        expect(result.posted_to).toBe(SECRET);
        expect(posted).toEqual([{ url: SECRET, text: "real" }]);
      } finally {
        await store.delete(key);
      }
    });

    /**
     * Fail-closed regression guard. The memo records a miss as
     * `{ resolved: undefined, original: "<key>" }`, so the second run reverts
     * the port to the key and asks the store again — it must NOT invent a value
     * or leave the key standing in for its own secret. An absent key is a
     * configuration error on BOTH runs, exactly as it is on the first.
     */
    test("an absent key still fails closed on both runs", async () => {
      const registry = await createCredentialRegistry({});
      const task = new WebhookNotifyTask({
        defaults: { url_credential_key: "no-such-key" },
      });

      await expect(task.run({ text: "one" }, { registry })).rejects.toThrow(TaskConfigurationError);
      await expect(task.run({ text: "two" }, { registry })).rejects.toThrow(TaskConfigurationError);
      expect(posted).toEqual([]);
    });

    /**
     * A store that was locked (or simply not yet populated) during run 1 and
     * available before run 2 now succeeds. Without the memo the port would hold
     * `undefined` forever after the first miss, so the instance could never
     * recover — the key it was configured with is gone.
     */
    test("a key that appears between runs resolves on the second run", async () => {
      const registry = await createCredentialRegistry({});
      const task = new WebhookNotifyTask({
        defaults: { url_credential_key: CREDENTIAL_KEY },
      });

      await expect(task.run({ text: "one" }, { registry })).rejects.toThrow(TaskConfigurationError);

      const store = new InMemoryCredentialStore();
      await store.put(CREDENTIAL_KEY, SECRET);
      setGlobalCredentialStore(store, registry);

      await task.run({ text: "two" }, { registry });
      expect(posted).toEqual([{ url: SECRET, text: "two" }]);
    });
  });

  describe("idempotent formats are unaffected", () => {
    const MODEL_ID = "rerun-resolution-test-model";

    interface ModelInput extends Record<string, unknown> {
      model?: string | ModelConfig;
    }
    interface ModelOutput extends Record<string, unknown> {
      provider: string;
      model_id: string;
    }

    /** Reads the resolved {@link ModelConfig} off a `format: "model"` port. */
    class ModelConsumerTask extends Task<ModelInput, ModelOutput> {
      public static override type = "RerunModelConsumerTask";
      public static override readonly title = "Rerun Model Consumer";
      // Both runs carry identical input, so a cache hit would serve run 2
      // without resolving anything and the test would pin nothing.
      public static override cacheable = false;

      public static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { model: ModelConfigSchema },
          required: ["model"],
          additionalProperties: false,
        } as DataPortSchema;
      }

      public static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            provider: { type: "string" },
            model_id: { type: "string" },
          },
          required: ["provider", "model_id"],
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }

      override async execute(input: ModelInput, _context: IExecuteContext): Promise<ModelOutput> {
        const model = input.model;
        if (typeof model !== "object" || model === null) {
          throw new TaskConfigurationError(
            `RerunModelConsumerTask: model port was not resolved (got ${JSON.stringify(model)}).`
          );
        }
        return { provider: model.provider, model_id: String(model.model_id) };
      }
    }

    /**
     * The memo reverts a rewritten port to the id it came from, so an
     * idempotent format now RE-resolves on run 2 where it used to pass the
     * already-resolved object straight through. That must land on an equivalent
     * model — this is the guard that the revert did not break the formats it was
     * never aimed at (`model` / `mcp-server` / storage all resolve string →
     * object and ignore a non-string on the next pass).
     */
    test("a defaults-configured model id resolves on both runs", async () => {
      const repo = getGlobalModelRepository();
      const existing = await repo.findByName(MODEL_ID).catch(() => undefined);
      if (!existing) {
        await repo.addModel({
          model_id: MODEL_ID,
          capabilities: ["text.generation"],
          title: "Re-run resolution test model",
          description: "Stub model used by the TaskRunner re-run resolution tests",
          provider: "rerun-test-provider",
          provider_config: {},
          metadata: {},
        } as ModelRecord);
      }

      const task = new ModelConsumerTask({ defaults: { model: MODEL_ID } });

      const first = await task.run({});
      const second = await task.run({});

      expect(first).toEqual({ provider: "rerun-test-provider", model_id: MODEL_ID });
      expect(second).toEqual(first);
    });
  });
});

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { kbDelete } from "@workglow/ai";
import { createKnowledgeBase } from "@workglow/knowledge-base";
import { uuid4 } from "@workglow/util";
import { describe, expect, it, vi } from "vitest";

describe("KbDeleteTask", () => {
  async function makeKbWithDeleteSpy() {
    const kb = await createKnowledgeBase({
      name: `kb-delete-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
    });
    const deleteSpy = vi.spyOn(kb, "delete").mockResolvedValue(undefined);
    return { kb, deleteSpy };
  }

  it("calls kb.delete with the given doc_id", async () => {
    const { kb, deleteSpy } = await makeKbWithDeleteSpy();

    await kbDelete({ knowledgeBase: kb, doc_id: "my-doc" });

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy.mock.calls[0][0]).toBe("my-doc");
  });

  it("echoes doc_id in the output", async () => {
    const { kb } = await makeKbWithDeleteSpy();

    const result = await kbDelete({ knowledgeBase: kb, doc_id: "my-doc" });

    expect(result.doc_id).toBe("my-doc");
  });

  it("threads run context (signal) to kb.delete", async () => {
    const { kb, deleteSpy } = await makeKbWithDeleteSpy();

    await kbDelete({ knowledgeBase: kb, doc_id: "my-doc" });

    const forwardedRunConfig = deleteSpy.mock.calls[0][1];
    expect(forwardedRunConfig).toMatchObject({ signal: expect.any(AbortSignal) });
  });
});

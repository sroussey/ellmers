/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { kbAddDocument } from "@workglow/ai";
import { Document, createKnowledgeBase } from "@workglow/knowledge-base";
import { uuid4 } from "@workglow/util";
import { describe, expect, it, vi } from "vitest";

describe("KbAddDocumentTask", () => {
  function makeDoc(docId?: string): Document {
    const doc = new Document({ type: "root", title: "T", children: [] } as never, {
      title: "Test",
    });
    if (docId) doc.setDocId(docId);
    return doc;
  }

  async function makeKbWithUpsertSpy() {
    const kb = await createKnowledgeBase({
      name: `kb-add-doc-${uuid4()}`,
      vectorDimensions: 3,
      register: false,
    });
    const doc = makeDoc("returned-id");
    const upsertSpy = vi.spyOn(kb, "upsert").mockResolvedValue(doc);
    return { kb, doc, upsertSpy };
  }

  it("calls kb.upsert with the provided document", async () => {
    const { kb, doc, upsertSpy } = await makeKbWithUpsertSpy();

    await kbAddDocument({ knowledgeBase: kb, document: doc });

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy.mock.calls[0][0]).toBe(doc);
  });

  it("returns the doc_id from the upserted document", async () => {
    const { kb, doc } = await makeKbWithUpsertSpy();

    const result = await kbAddDocument({ knowledgeBase: kb, document: doc });

    expect(result.doc_id).toBe("returned-id");
  });

  it("threads run context (signal) to kb.upsert", async () => {
    const { kb, upsertSpy } = await makeKbWithUpsertSpy();

    await kbAddDocument({ knowledgeBase: kb, document: makeDoc("x") });

    const forwardedRunConfig = upsertSpy.mock.calls[0][1];
    expect(forwardedRunConfig).toMatchObject({ signal: expect.any(AbortSignal) });
  });
});

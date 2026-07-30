/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/tf-mediapipe/ai";
import { describe, expect, it } from "vitest";

const { buildGenaiPrompt, optionsMatch, resolveTfmpChatTemplate, resolveTfmpDelegate } = _testOnly;

describe("resolveTfmpDelegate", () => {
  it("defaults vision to GPU", () => {
    expect(resolveTfmpDelegate("vision", undefined)).toBe("GPU");
    expect(resolveTfmpDelegate("vision", true)).toBe("GPU");
  });

  it("respects explicit gpu=false for vision", () => {
    expect(resolveTfmpDelegate("vision", false)).toBe("CPU");
  });

  it("never sets a delegate for CPU-only engines", () => {
    for (const engine of ["text", "audio"]) {
      expect(resolveTfmpDelegate(engine, true)).toBeUndefined();
      expect(resolveTfmpDelegate(engine, false)).toBeUndefined();
      expect(resolveTfmpDelegate(engine, undefined)).toBeUndefined();
    }
  });

  it("leaves genai to the genai runtime", () => {
    expect(resolveTfmpDelegate("genai", true)).toBeUndefined();
    expect(resolveTfmpDelegate("genai", false)).toBeUndefined();
  });
});

describe("buildGenaiPrompt", () => {
  it("wraps a single user message and opens a model turn", () => {
    const prompt = buildGenaiPrompt([{ role: "user", content: "Hello" }], "gemma");
    expect(prompt).toBe("<start_of_turn>user\nHello<end_of_turn>\n<start_of_turn>model\n");
  });

  it("folds the system prompt into the first user turn", () => {
    const prompt = buildGenaiPrompt(
      [
        { role: "system", content: "Be terse." },
        { role: "user", content: "Hi" },
      ],
      "gemma"
    );
    expect(prompt).toBe(
      "<start_of_turn>user\nBe terse.\n\nHi<end_of_turn>\n<start_of_turn>model\n"
    );
  });

  it("renders multi-turn history with model turns", () => {
    const prompt = buildGenaiPrompt(
      [
        { role: "user", content: "One" },
        { role: "assistant", content: "Two" },
        { role: "user", content: "Three" },
      ],
      "gemma"
    );
    expect(prompt).toBe(
      "<start_of_turn>user\nOne<end_of_turn>\n" +
        "<start_of_turn>model\nTwo<end_of_turn>\n" +
        "<start_of_turn>user\nThree<end_of_turn>\n" +
        "<start_of_turn>model\n"
    );
  });

  it("emits a lone system prompt as a user turn", () => {
    const prompt = buildGenaiPrompt([{ role: "system", content: "Rules." }], "gemma");
    expect(prompt).toBe("<start_of_turn>user\nRules.<end_of_turn>\n<start_of_turn>model\n");
  });

  it("none template passes a single message through verbatim", () => {
    expect(buildGenaiPrompt([{ role: "user", content: "raw prompt" }], "none")).toBe("raw prompt");
  });

  it("none template joins messages with blank lines", () => {
    expect(
      buildGenaiPrompt(
        [
          { role: "system", content: "S" },
          { role: "user", content: "U" },
        ],
        "none"
      )
    ).toBe("S\n\nU");
  });
});

describe("resolveTfmpChatTemplate", () => {
  it("defaults to gemma", () => {
    expect(resolveTfmpChatTemplate(undefined)).toBe("gemma");
    expect(resolveTfmpChatTemplate("gemma")).toBe("gemma");
    expect(resolveTfmpChatTemplate("bogus")).toBe("gemma");
  });
  it("honors none", () => {
    expect(resolveTfmpChatTemplate("none")).toBe("none");
  });
});

describe("optionsMatch", () => {
  it("deep-compares nested baseOptions", () => {
    expect(
      optionsMatch(
        { baseOptions: { delegate: "GPU", modelAssetPath: "m" } },
        { baseOptions: { delegate: "GPU", modelAssetPath: "m" } }
      )
    ).toBe(true);
    expect(
      optionsMatch(
        { baseOptions: { delegate: "GPU", modelAssetPath: "m" } },
        { baseOptions: { delegate: "CPU", modelAssetPath: "m" } }
      )
    ).toBe(false);
  });

  it("still compares scalars and arrays", () => {
    expect(optionsMatch({ numHands: 2 }, { numHands: 2 })).toBe(true);
    expect(optionsMatch({ numHands: 2 }, { numHands: 1 })).toBe(false);
    expect(optionsMatch({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(optionsMatch({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });

  it("rejects differing key sets", () => {
    expect(optionsMatch({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(optionsMatch({ a: 1 }, { b: 1 })).toBe(false);
  });
});

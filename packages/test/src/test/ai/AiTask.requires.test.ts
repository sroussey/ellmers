/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Capability, AiImageOutputTask, AiTask, StreamingAiTask } from "@workglow/ai";
import { AiVisionTask } from "@workglow/ai/test";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Base class defaults
// ---------------------------------------------------------------------------

describe("AiTask.requires", () => {
  it("is an empty readonly array by default", () => {
    expect(AiTask.requires).toStrictEqual([]);
  });

  it("subclass inherits [] when it does not declare requires", () => {
    class SubTask extends AiTask {
      static override readonly type = "SubTask";
    }
    expect((SubTask as typeof AiTask).requires).toStrictEqual([]);
  });

  it("subclass can override requires with specific capabilities", () => {
    class TextGenTask extends AiTask {
      static override readonly type = "TextGenTask";
      static override readonly requires = ["text.generation"] as const satisfies Capability[];
    }
    expect((TextGenTask as typeof AiTask).requires).toStrictEqual(["text.generation"]);
  });

  it("is accessible from an instance via (instance.constructor as typeof AiTask).requires", () => {
    class SubTask extends AiTask {
      static override readonly type = "SubTask2";
      static override readonly requires = ["text.embedding"] as const satisfies Capability[];
    }
    const instance = new SubTask({ defaults: { model: "test-model" } });
    expect((instance.constructor as typeof AiTask).requires).toStrictEqual(["text.embedding"]);
  });
});

// ---------------------------------------------------------------------------
// StreamingAiTask
// ---------------------------------------------------------------------------

describe("StreamingAiTask.requires", () => {
  it("is an empty readonly array by default", () => {
    expect(StreamingAiTask.requires).toStrictEqual([]);
  });

  it("subclass inherits [] when it does not declare requires", () => {
    class SubStreamTask extends StreamingAiTask {
      static override readonly type = "SubStreamTask";
    }
    expect((SubStreamTask as typeof AiTask).requires).toStrictEqual([]);
  });

  it("subclass can override requires with specific capabilities", () => {
    class StreamGenTask extends StreamingAiTask {
      static override readonly type = "StreamGenTask";
      static override readonly requires = ["text.generation"] as const satisfies Capability[];
    }
    expect((StreamGenTask as typeof AiTask).requires).toStrictEqual(["text.generation"]);
  });

  it("is accessible from an instance via (instance.constructor as typeof AiTask).requires", () => {
    class SubStreamTask2 extends StreamingAiTask {
      static override readonly type = "SubStreamTask2";
      static override readonly requires = ["tool-use"] as const satisfies Capability[];
    }
    const instance = new SubStreamTask2({ defaults: { model: "test-model" } });
    expect((instance.constructor as typeof AiTask).requires).toStrictEqual(["tool-use"]);
  });
});

// ---------------------------------------------------------------------------
// AiVisionTask
// ---------------------------------------------------------------------------

describe("AiVisionTask.requires", () => {
  it("is an empty readonly array by default", () => {
    expect(AiVisionTask.requires).toStrictEqual([]);
  });

  it("subclass inherits [] when it does not declare requires", () => {
    class SubVisionTask extends AiVisionTask {
      static override readonly type = "SubVisionTask";
    }
    expect((SubVisionTask as typeof AiTask).requires).toStrictEqual([]);
  });

  it("subclass can override requires with specific capabilities", () => {
    class FaceTask extends AiVisionTask {
      static override readonly type = "FaceTask";
      static override readonly requires = ["vision.face-detection"] as const satisfies Capability[];
    }
    expect((FaceTask as typeof AiTask).requires).toStrictEqual(["vision.face-detection"]);
  });

  it("is accessible from an instance via (instance.constructor as typeof AiTask).requires", () => {
    class SubVisionTask2 extends AiVisionTask {
      static override readonly type = "SubVisionTask2";
      static override readonly requires = ["vision.hand-landmarks"] as const satisfies Capability[];
    }
    const instance = new SubVisionTask2({ defaults: { model: "test-model" } });
    expect((instance.constructor as typeof AiTask).requires).toStrictEqual([
      "vision.hand-landmarks",
    ]);
  });
});

// ---------------------------------------------------------------------------
// AiImageOutputTask
// ---------------------------------------------------------------------------

describe("AiImageOutputTask.requires", () => {
  it("is an empty readonly array by default", () => {
    expect(AiImageOutputTask.requires).toStrictEqual([]);
  });

  it("subclass inherits [] when it does not declare requires", () => {
    class SubImageTask extends AiImageOutputTask {
      static override readonly type = "SubImageTask";
    }
    expect((SubImageTask as typeof AiTask).requires).toStrictEqual([]);
  });

  it("subclass can override requires with specific capabilities", () => {
    class ImageGenTask extends AiImageOutputTask {
      static override readonly type = "ImageGenTask";
      static override readonly requires = ["image.generation"] as const satisfies Capability[];
    }
    expect((ImageGenTask as typeof AiTask).requires).toStrictEqual(["image.generation"]);
  });

  it("is accessible from an instance via (instance.constructor as typeof AiTask).requires", () => {
    class SubImageTask2 extends AiImageOutputTask {
      static override readonly type = "SubImageTask2";
      static override readonly requires = ["image.editing"] as const satisfies Capability[];
    }
    const instance = new SubImageTask2({
      defaults: { model: "test-model", prompt: "test prompt" },
    });
    expect((instance.constructor as typeof AiTask).requires).toStrictEqual(["image.editing"]);
  });
});

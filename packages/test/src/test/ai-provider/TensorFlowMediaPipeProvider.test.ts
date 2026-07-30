/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord } from "@workglow/ai";
import { _testOnly } from "@workglow/tf-mediapipe/ai";
import { describe, expect, it } from "vitest";

const { TensorFlowMediaPipeQueuedProvider, TFMP_RUN_FN_SPECS, TFMP_RUN_FNS } = _testOnly;

function model(model_id: string, capabilities: readonly string[] = []): ModelRecord {
  return {
    model_id,
    title: model_id,
    description: "",
    provider: "TENSORFLOW_MEDIAPIPE",
    provider_config: { model_path: model_id },
    capabilities: [...capabilities],
    metadata: {},
  } as ModelRecord;
}

describe("TensorFlowMediaPipeQueuedProvider.inferCapabilities", () => {
  const provider = new TensorFlowMediaPipeQueuedProvider(TFMP_RUN_FNS);

  it("trusts declared capabilities", () => {
    const caps = provider.inferCapabilities(model("foo.tflite", ["text.classification"]));
    expect(caps).toEqual(["text.classification"]);
  });

  it("infers vision.gesture + hand-landmarks for gesture_recognizer", () => {
    const caps = provider.inferCapabilities(model("gesture_recognizer.task"));
    expect(caps).toContain("vision.gesture");
    expect(caps).toContain("vision.hand-landmarks");
  });

  it("infers face-landmarks for face_landmarker", () => {
    const caps = provider.inferCapabilities(model("face_landmarker.task"));
    expect(caps).toContain("vision.face-landmarks");
  });

  it("infers face-detection for blaze_face_short_range", () => {
    const caps = provider.inferCapabilities(model("blaze_face_short_range.tflite"));
    expect(caps).toContain("vision.face-detection");
  });

  it("infers hand-landmarks for hand_landmarker", () => {
    const caps = provider.inferCapabilities(model("hand_landmarker.task"));
    expect(caps).toContain("vision.hand-landmarks");
  });

  it("infers pose-landmarks for pose_landmarker", () => {
    const caps = provider.inferCapabilities(model("pose_landmarker_lite.task"));
    expect(caps).toContain("vision.pose-landmarks");
  });

  it("infers image.object-detection for efficientdet/object_detector", () => {
    expect(provider.inferCapabilities(model("efficientdet_lite0.tflite"))).toContain(
      "image.object-detection"
    );
    expect(provider.inferCapabilities(model("object_detector.task"))).toContain(
      "image.object-detection"
    );
  });

  it("infers image.segmentation for selfie/deeplab", () => {
    expect(provider.inferCapabilities(model("selfie_segmenter.tflite"))).toContain(
      "image.segmentation"
    );
    expect(provider.inferCapabilities(model("deeplab_v3.tflite"))).toContain("image.segmentation");
  });

  it("infers image.classification for efficientnet/mobilenet", () => {
    expect(provider.inferCapabilities(model("efficientnet_lite0.tflite"))).toContain(
      "image.classification"
    );
    expect(provider.inferCapabilities(model("mobilenet_v3_small.tflite"))).toContain(
      "image.classification"
    );
  });

  it("infers text.embedding for universal_sentence_encoder", () => {
    expect(provider.inferCapabilities(model("universal_sentence_encoder.tflite"))).toContain(
      "text.embedding"
    );
  });

  it("infers text.language-detection for language_detector", () => {
    expect(provider.inferCapabilities(model("language_detector.tflite"))).toContain(
      "text.language-detection"
    );
  });

  it("returns baseline meta-ops for unknown models", () => {
    const caps = provider.inferCapabilities(model("some-unrecognized-model.tflite"));
    expect(caps).toEqual(["model.search", "model.info"]);
  });

  it("infers text.generation for gemma bundles", () => {
    const caps = provider.inferCapabilities(model("gemma3-1b-it-int4-web.task"));
    expect(caps).toContain("text.generation");
    expect(caps).toContain("json-mode");
    expect(caps).toContain("model.count-tokens");
  });

  it("infers text.generation for .litertlm files", () => {
    expect(provider.inferCapabilities(model("some_model.litertlm"))).toContain("text.generation");
  });

  it("does not misclassify llm-substring words as genai", () => {
    expect(provider.inferCapabilities(model("hand_landmarker.task"))).not.toContain(
      "text.generation"
    );
  });
});

describe("capability-set parity", () => {
  it("TFMP_RUN_FN_SPECS matches TFMP_RUN_FNS serves shapes", () => {
    const fnsServes = TFMP_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    const specsServes = TFMP_RUN_FN_SPECS.map((s) => [...s.serves].sort().join(","));
    expect(specsServes).toEqual(fnsServes);
  });
});

describe("TFMP_RUN_FNS shape", () => {
  it("registers a runFn for every canonical TFMP capability set", () => {
    const sets = TFMP_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    expect(sets).toContain("text.embedding");
    expect(sets).toContain("text.classification");
    expect(sets).toContain("text.language-detection");
    expect(sets).toContain("image.classification");
    expect(sets).toContain("image.embedding");
    expect(sets).toContain("image.segmentation");
    expect(sets).toContain("image.object-detection");
    expect(sets).toContain("vision.face-detection");
    expect(sets).toContain("vision.face-landmarks");
    expect(sets).toContain("vision.hand-landmarks");
    expect(sets).toContain("vision.pose-landmarks");
    expect(sets).toContain("vision.gesture");
    expect(sets).toContain("model.download-remove");
    expect(sets).toContain("model.search");
    expect(sets).toContain("model.info");
  });

  it("registers genai text-generation capability sets", () => {
    const sets = TFMP_RUN_FNS.map((r) => [...r.serves].sort().join(","));
    expect(sets).toContain("text.generation");
    expect(sets).toContain("json-mode,text.generation");
    expect(sets).toContain("model.count-tokens");
  });
});

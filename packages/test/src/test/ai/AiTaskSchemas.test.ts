/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TypeLandmark, TypePoseLandmark } from "@workglow/ai";
import { describe, expect, test } from "vitest";

describe("AI task schemas", () => {
  test("exports shared landmark schemas", () => {
    expect(TypeLandmark.properties).toEqual({
      x: {
        type: "number",
        title: "X Coordinate",
        description: "X coordinate normalized to [0.0, 1.0]",
      },
      y: {
        type: "number",
        title: "Y Coordinate",
        description: "Y coordinate normalized to [0.0, 1.0]",
      },
      z: {
        type: "number",
        title: "Z Coordinate",
        description: "Z coordinate (depth)",
      },
    });
    expect(TypeLandmark.required).toEqual(["x", "y", "z"]);
    expect(TypeLandmark.additionalProperties).toBe(false);
  });

  test("exports pose landmarks as shared landmarks with pose scores", () => {
    expect(TypePoseLandmark.properties).toEqual({
      ...TypeLandmark.properties,
      visibility: {
        type: "number",
        title: "Visibility",
        description: "Likelihood of the landmark being visible within the image",
      },
      presence: {
        type: "number",
        title: "Presence",
        description: "Likelihood of the landmark being present in the image",
      },
    });
    expect(TypePoseLandmark.required).toEqual(TypeLandmark.required);
    expect(TypePoseLandmark.additionalProperties).toBe(false);
  });
});

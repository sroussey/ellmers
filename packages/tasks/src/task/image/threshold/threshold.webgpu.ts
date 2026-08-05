/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp, VERTEX_PRELUDE } from "@workglow/util/media";
import type { ThresholdParams } from "./threshold.cpu";

const SHADER_SRC = `${VERTEX_PRELUDE}
struct U { value: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  let v = u.value / 255.0;
  // Per-channel binary threshold to match cpuThreshold (each of R/G/B
  // compared independently); alpha preserved.
  let r = select(0.0, 1.0, s.r >= v);
  let g = select(0.0, 1.0, s.g >= v);
  let b = select(0.0, 1.0, s.b >= v);
  return vec4f(r, g, b, s.a);
}
`;

registerFilterOp<ThresholdParams>("webgpu", "threshold", (image, { value }) => {
  const buf = new ArrayBuffer(16); // std140 alignment: scalar in 16-byte slot
  new Float32Array(buf, 0, 1)[0] = value;
  return (image as WebGpuImage).apply({ shader: SHADER_SRC, uniforms: buf });
});

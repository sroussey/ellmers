/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp, VERTEX_PRELUDE } from "@workglow/util/media";
import type { BrightnessParams } from "./brightness.cpu";

const SHADER_SRC = `${VERTEX_PRELUDE}
struct U { amount: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  let d = u.amount / 255.0;
  return vec4f(clamp(s.rgb + vec3f(d), vec3f(0.0), vec3f(1.0)), s.a);
}
`;

registerFilterOp<BrightnessParams>("webgpu", "brightness", (image, { amount }) => {
  const buf = new ArrayBuffer(16); // std140 alignment: scalar in 16-byte slot
  new Float32Array(buf, 0, 1)[0] = amount;
  return (image as WebGpuImage).apply({ shader: SHADER_SRC, uniforms: buf });
});

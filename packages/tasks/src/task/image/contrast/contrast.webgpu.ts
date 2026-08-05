/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp, VERTEX_PRELUDE } from "@workglow/util/media";
import type { ContrastParams } from "./contrast.cpu";

const SHADER_SRC = `${VERTEX_PRELUDE}
struct U { amount: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  // Standard "GIMP" contrast curve, matching cpuContrast.
  let factor = (259.0 * (u.amount + 255.0)) / (255.0 * (259.0 - u.amount));
  let rgb = factor * (s.rgb - vec3f(0.5)) + vec3f(0.5);
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), s.a);
}
`;

registerFilterOp<ContrastParams>("webgpu", "contrast", (image, { amount }) => {
  const buf = new ArrayBuffer(16); // std140 alignment: scalar in 16-byte slot
  new Float32Array(buf, 0, 1)[0] = amount;
  return (image as WebGpuImage).apply({ shader: SHADER_SRC, uniforms: buf });
});

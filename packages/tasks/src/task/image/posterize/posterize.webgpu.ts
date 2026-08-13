/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp, VERTEX_PRELUDE } from "@workglow/util/media";
import type { PosterizeParams } from "./posterize.cpu";

const SHADER_SRC = `${VERTEX_PRELUDE}
struct U { levels: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  let n = max(u.levels, 2.0);
  // Round-to-nearest quantization, matching cpuPosterize's LUT semantics.
  let q = round(s.rgb * (n - 1.0)) / (n - 1.0);
  return vec4f(clamp(q, vec3f(0.0), vec3f(1.0)), s.a);
}
`;

registerFilterOp<PosterizeParams>("webgpu", "posterize", (image, { levels }) => {
  const buf = new ArrayBuffer(16);
  new Float32Array(buf, 0, 1)[0] = levels;
  return (image as WebGpuImage).apply({ shader: SHADER_SRC, uniforms: buf });
});

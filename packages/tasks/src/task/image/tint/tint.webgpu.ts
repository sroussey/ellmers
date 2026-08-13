/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { WebGpuImage } from "@workglow/util/media";
import { VERTEX_PRELUDE, registerFilterOp, resolveColor } from "@workglow/util/media";
import type { TintParams } from "./tint.cpu";

const SHADER_SRC = `${VERTEX_PRELUDE}
struct U { color: vec4f, amount: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  let tinted = mix(s.rgb, u.color.rgb, u.amount);
  return vec4f(clamp(tinted, vec3f(0.0), vec3f(1.0)), s.a);
}
`;

registerFilterOp<TintParams>("webgpu", "tint", (image, { color, amount }) => {
  const c = resolveColor(color);
  const buf = new ArrayBuffer(32); // vec4f (16) + amount (4) padded to vec4 alignment
  const f = new Float32Array(buf);
  f[0] = c.r / 255;
  f[1] = c.g / 255;
  f[2] = c.b / 255;
  f[3] = 1.0;
  f[4] = amount;
  return (image as WebGpuImage).apply({ shader: SHADER_SRC, uniforms: buf });
});

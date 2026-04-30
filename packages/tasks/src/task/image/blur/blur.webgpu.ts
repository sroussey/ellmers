/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { registerFilterOp, VERTEX_PRELUDE, WebGpuImage } from "@workglow/util/media";
import type { BlurParams } from "./blur.cpu";

const SHADER_SRC = `${VERTEX_PRELUDE}
struct U { radius: u32, direction: u32, width: f32, height: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let r = i32(u.radius);
  var sum = vec4f(0.0);
  let texel = vec2f(1.0 / u.width, 1.0 / u.height);
  // direction: 0 = horizontal, 1 = vertical.
  let dir = select(vec2f(0.0, texel.y), vec2f(texel.x, 0.0), u.direction == 0u);
  for (var k: i32 = -r; k <= r; k = k + 1) {
    let uv = clamp(in.uv + dir * f32(k), vec2f(0.0), vec2f(1.0));
    sum = sum + textureSample(src, src_sampler, uv);
  }
  let n = f32(2 * r + 1);
  return sum / n;
}
`;

function makeUniforms(
  radius: number,
  direction: 0 | 1,
  width: number,
  height: number
): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const u = new Uint32Array(buf, 0, 2);
  u[0] = Math.max(1, radius | 0);
  u[1] = direction;
  const f = new Float32Array(buf, 8, 2);
  f[0] = width;
  f[1] = height;
  return buf;
}

registerFilterOp<BlurParams>("webgpu", "blur", (image, { radius }) => {
  const w = (image as WebGpuImage).width;
  const h = (image as WebGpuImage).height;
  const horiz = (image as WebGpuImage).apply({
    shader: SHADER_SRC,
    uniforms: makeUniforms(radius, 0, w, h),
  });
  const vert = horiz.apply({ shader: SHADER_SRC, uniforms: makeUniforms(radius, 1, w, h) });
  horiz.dispose();
  return vert;
});

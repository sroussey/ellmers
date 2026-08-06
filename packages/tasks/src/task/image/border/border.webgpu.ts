/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { WebGpuImage } from "@workglow/util/media";
import { VERTEX_PRELUDE, registerFilterOp, resolveColor } from "@workglow/util/media";
import type { BorderParams } from "./border.cpu";

const SHADER_SRC = `${VERTEX_PRELUDE}
struct U { color: vec4f, borderWidth: f32, srcWidth: f32, srcHeight: f32, _pad: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let outW = u.srcWidth + 2.0 * u.borderWidth;
  let outH = u.srcHeight + 2.0 * u.borderWidth;
  let px = in.uv.x * outW;
  let py = in.uv.y * outH;
  let inside = px >= u.borderWidth && px < (u.borderWidth + u.srcWidth)
            && py >= u.borderWidth && py < (u.borderWidth + u.srcHeight);
  if (!inside) {
    return u.color;
  }
  let sx = (px - u.borderWidth) / u.srcWidth;
  let sy = (py - u.borderWidth) / u.srcHeight;
  return textureSample(src, src_sampler, vec2f(sx, sy));
}
`;

registerFilterOp<BorderParams>("webgpu", "border", (image, { borderWidth, color }) => {
  const w = (image as WebGpuImage).width;
  const h = (image as WebGpuImage).height;
  const c = resolveColor(color);
  const buf = new ArrayBuffer(32);
  const f = new Float32Array(buf);
  f[0] = c.r / 255;
  f[1] = c.g / 255;
  f[2] = c.b / 255;
  f[3] = c.a / 255;
  f[4] = borderWidth;
  f[5] = w;
  f[6] = h;
  return (image as WebGpuImage).apply({
    shader: SHADER_SRC,
    uniforms: buf,
    outSize: { width: w + 2 * borderWidth, height: h + 2 * borderWidth },
  });
});

/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp, VERTEX_PRELUDE } from "@workglow/util/media";
import type { CropParams } from "./crop.cpu";

const SHADER_SRC = `${VERTEX_PRELUDE}
struct U { left: f32, top: f32, srcWidth: f32, srcHeight: f32, outWidth: f32, outHeight: f32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let px = u.left + in.uv.x * u.outWidth;
  let py = u.top + in.uv.y * u.outHeight;
  let uv = vec2f(px / u.srcWidth, py / u.srcHeight);
  return textureSample(src, src_sampler, uv);
}
`;

registerFilterOp<CropParams>("webgpu", "crop", (image, { left, top, width, height }) => {
  const w = (image as WebGpuImage).width;
  const h = (image as WebGpuImage).height;
  const buf = new ArrayBuffer(32);
  const f = new Float32Array(buf);
  f[0] = left;
  f[1] = top;
  f[2] = w;
  f[3] = h;
  f[4] = width;
  f[5] = height;
  return (image as WebGpuImage).apply({
    shader: SHADER_SRC,
    uniforms: buf,
    outSize: { width, height },
  });
});

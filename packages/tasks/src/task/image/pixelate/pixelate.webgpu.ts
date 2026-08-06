/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp, VERTEX_PRELUDE } from "@workglow/util/media";
import type { PixelateParams } from "./pixelate.cpu";

const SHADER_SRC = `${VERTEX_PRELUDE}
struct U { blockSize: u32, width: u32, height: u32, _pad: u32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let px = u32(in.uv.x * f32(u.width));
  let py = u32(in.uv.y * f32(u.height));
  let bx = px / u.blockSize;
  let by = py / u.blockSize;
  let startX = bx * u.blockSize;
  let startY = by * u.blockSize;
  let endX = min(startX + u.blockSize, u.width);
  let endY = min(startY + u.blockSize, u.height);

  let invW = 1.0 / f32(u.width);
  let invH = 1.0 / f32(u.height);

  var sum = vec4f(0.0);
  var count: f32 = 0.0;
  for (var sy: u32 = startY; sy < endY; sy = sy + 1u) {
    for (var sx: u32 = startX; sx < endX; sx = sx + 1u) {
      // Sample at exact texel center. With a linear sampler, the bilinear
      // weight collapses to 1.0 on this texel, giving a lossless read.
      let suv = vec2f((f32(sx) + 0.5) * invW, (f32(sy) + 0.5) * invH);
      sum = sum + textureSampleLevel(src, src_sampler, suv, 0.0);
      count = count + 1.0;
    }
  }
  return sum / count;
}
`;

registerFilterOp<PixelateParams>("webgpu", "pixelate", (image, { blockSize }) => {
  const w = (image as WebGpuImage).width;
  const h = (image as WebGpuImage).height;
  const buf = new ArrayBuffer(16);
  const u = new Uint32Array(buf);
  u[0] = Math.max(1, blockSize | 0);
  u[1] = w;
  u[2] = h;
  return (image as WebGpuImage).apply({ shader: SHADER_SRC, uniforms: buf });
});

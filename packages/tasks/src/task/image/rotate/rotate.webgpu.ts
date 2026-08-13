/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp, VERTEX_PRELUDE } from "@workglow/util/media";
import type { RotateParams } from "./rotate.cpu";

const SHADER_SRC = `${VERTEX_PRELUDE}
struct U { angle: u32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  // Map output uv back to source uv via inverse rotation.
  var srcUv = in.uv;
  if (u.angle == 90u) {
    srcUv = vec2f(in.uv.y, 1.0 - in.uv.x);
  } else if (u.angle == 180u) {
    srcUv = vec2f(1.0 - in.uv.x, 1.0 - in.uv.y);
  } else if (u.angle == 270u) {
    srcUv = vec2f(1.0 - in.uv.y, in.uv.x);
  }
  return textureSample(src, src_sampler, srcUv);
}
`;

registerFilterOp<RotateParams>("webgpu", "rotate", (image, { angle }) => {
  const w = (image as WebGpuImage).width;
  const h = (image as WebGpuImage).height;
  const swap = angle === 90 || angle === 270;
  const buf = new ArrayBuffer(16);
  new Uint32Array(buf, 0, 1)[0] = angle;
  return (image as WebGpuImage).apply({
    shader: SHADER_SRC,
    uniforms: buf,
    outSize: { width: swap ? h : w, height: swap ? w : h },
  });
});

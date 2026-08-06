/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp, VERTEX_PRELUDE } from "@workglow/util/media";

const SHADER_SRC = `${VERTEX_PRELUDE}
@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  let s = textureSample(src, src_sampler, in.uv);
  // Match cpuGrayscale's BT.601-ish (77,150,29)/256 weights.
  let g = (s.r * 77.0 + s.g * 150.0 + s.b * 29.0) / 256.0;
  return vec4f(g, g, g, s.a);
}
`;

registerFilterOp<undefined>("webgpu", "grayscale", (image, _params) => {
  return (image as WebGpuImage).apply({ shader: SHADER_SRC, uniforms: undefined });
});

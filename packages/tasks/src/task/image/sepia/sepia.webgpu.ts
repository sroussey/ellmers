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
  let r = s.r * 0.393 + s.g * 0.769 + s.b * 0.189;
  let g = s.r * 0.349 + s.g * 0.686 + s.b * 0.168;
  let b = s.r * 0.272 + s.g * 0.534 + s.b * 0.131;
  return vec4f(clamp(r, 0.0, 1.0), clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0), s.a);
}
`;

registerFilterOp<undefined>("webgpu", "sepia", (image, _params) => {
  return (image as WebGpuImage).apply({ shader: SHADER_SRC, uniforms: undefined });
});

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
  return vec4f(1.0 - s.rgb, s.a);
}
`;

registerFilterOp<undefined>("webgpu", "invert", (image, _params) => {
  return (image as WebGpuImage).apply({ shader: SHADER_SRC, uniforms: undefined });
});

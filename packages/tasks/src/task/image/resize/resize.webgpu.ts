/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp, VERTEX_PRELUDE } from "@workglow/util/media";
import type { ResizeParams } from "./resize.cpu";

const SHADER_SRC = `${VERTEX_PRELUDE}
@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  return textureSample(src, src_sampler, in.uv);
}
`;

registerFilterOp<ResizeParams>("webgpu", "resize", (image, { width, height }) => {
  return (image as WebGpuImage).apply({
    shader: SHADER_SRC,
    uniforms: undefined,
    outSize: { width, height },
  });
});

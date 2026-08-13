/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { WebGpuImage } from "@workglow/util/media";
import { registerFilterOp, VERTEX_PRELUDE } from "@workglow/util/media";
import type { FlipParams } from "./flip.cpu";

const SHADER_SRC = `${VERTEX_PRELUDE}
struct U { direction: u32 };
@group(0) @binding(2) var<uniform> u: U;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  // direction: 0 = horizontal (flip x), 1 = vertical (flip y).
  let flipX = u.direction == 0u;
  let flipY = u.direction == 1u;
  let uv = vec2f(
    select(in.uv.x, 1.0 - in.uv.x, flipX),
    select(in.uv.y, 1.0 - in.uv.y, flipY),
  );
  return textureSample(src, src_sampler, uv);
}
`;

const DIRECTION_TO_CODE = { horizontal: 0, vertical: 1 } as const;

registerFilterOp<FlipParams>("webgpu", "flip", (image, { direction }) => {
  const buf = new ArrayBuffer(16);
  new Uint32Array(buf, 0, 1)[0] = DIRECTION_TO_CODE[direction];
  return (image as WebGpuImage).apply({ shader: SHADER_SRC, uniforms: buf });
});

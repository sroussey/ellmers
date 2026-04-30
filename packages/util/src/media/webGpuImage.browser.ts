/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import type { ImageChannels } from "./imageTypes";
import type { GpuImage as IGpuImage, GpuImageEncodeFormat } from "./gpuImage";
import { registerGpuImageFactory } from "./gpuImage";
import type { ImageValue } from "./imageValue";
import { imageValueFromBitmap, isBrowserImageValue, isNodeImageValue } from "./imageValue";
import { getGpuDevice } from "./gpuDevice.browser";
import { getTexturePool } from "./texturePool.browser";
import { getShaderCache, PASSTHROUGH_SHADER_SRC } from "./shaderRegistry.browser";

const TEX_FORMAT: GPUTextureFormat = "rgba8unorm";

export interface ApplyParams {
  shader: string;
  uniforms: ArrayBuffer | undefined;
  outSize?: { width: number; height: number };
}

export class WebGpuImage implements IGpuImage {
  readonly backend = "webgpu" as const;
  readonly channels: ImageChannels = 4;

  private constructor(
    private device: GPUDevice,
    private texture: GPUTexture | null,
    readonly width: number,
    readonly height: number,
  ) {}

  static async from(value: ImageValue): Promise<WebGpuImage> {
    const dev = await getGpuDevice();
    if (!dev) throw new Error("WebGpuImage.from: WebGPU device unavailable");
    if (isNodeImageValue(value)) {
      throw new Error("WebGpuImage.from: NodeImageValue not supported in browser runtime");
    }
    if (!isBrowserImageValue(value)) {
      throw new Error("WebGpuImage.from: unrecognized ImageValue shape");
    }
    // Now we know value is BrowserImageValue.
    const tex = getTexturePool(dev).acquire(value.width, value.height, TEX_FORMAT);
    dev.queue.copyExternalImageToTexture(
      { source: value.bitmap },
      { texture: tex },
      [value.width, value.height, 1],
    );
    return new WebGpuImage(dev, tex, value.width, value.height);
  }

  apply(params: ApplyParams): WebGpuImage {
    if (!this.texture) throw new Error("WebGpuImage.apply called on a disposed image");
    const outW = params.outSize?.width ?? this.width;
    const outH = params.outSize?.height ?? this.height;
    const out = getTexturePool(this.device).acquire(outW, outH, TEX_FORMAT);
    const shaderModule = getShaderCache(this.device).get(params.shader);
    const pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module: shaderModule, entryPoint: "vs" },
      fragment: { module: shaderModule, entryPoint: "fs", targets: [{ format: TEX_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });
    const sampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    const bindEntries: GPUBindGroupEntry[] = [
      { binding: 0, resource: this.texture.createView() },
      { binding: 1, resource: sampler },
    ];
    if (params.uniforms) {
      const ubo = this.device.createBuffer({
        size: params.uniforms.byteLength,
        usage: 0x40 | 0x08,
      });
      this.device.queue.writeBuffer(ubo, 0, params.uniforms);
      bindEntries.push({ binding: 2, resource: { buffer: ubo } });
    }
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: bindEntries,
    });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: out.createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: [0, 0, 0, 0],
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    return new WebGpuImage(this.device, out, outW, outH);
  }

  /** Synchronous transfer to ImageBitmap via OffscreenCanvas. The transfer
   *  drains the texture; this image is disposed afterward. */
  async transferToImageBitmap(): Promise<ImageBitmap> {
    if (!this.texture) throw new Error("WebGpuImage.transferToImageBitmap on a disposed image");
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("WebGpuImage.transferToImageBitmap requires OffscreenCanvas");
    }
    const off = new OffscreenCanvas(this.width, this.height);
    const ctx = off.getContext("webgpu") as GPUCanvasContext | null;
    if (!ctx) throw new Error("WebGpuImage.transferToImageBitmap: no webgpu context");
    const presentationFormat = (
      navigator.gpu as unknown as { getPreferredCanvasFormat(): GPUTextureFormat }
    ).getPreferredCanvasFormat();
    ctx.configure({ device: this.device, format: presentationFormat, alphaMode: "premultiplied" });
    const view = ctx.getCurrentTexture().createView();
    const shaderModule = getShaderCache(this.device).get(PASSTHROUGH_SHADER_SRC);
    const pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module: shaderModule, entryPoint: "vs" },
      fragment: { module: shaderModule, entryPoint: "fs", targets: [{ format: presentationFormat }] },
      primitive: { topology: "triangle-list" },
    });
    const sampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.texture.createView() },
        { binding: 1, resource: sampler },
      ],
    });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    try {
      return await createImageBitmap(off);
    } finally {
      this.dispose();
    }
  }

  async toImageValue(previewScale: number): Promise<ImageValue> {
    const bitmap = await this.transferToImageBitmap();
    return imageValueFromBitmap(bitmap, this.width, this.height, previewScale);
  }

  /** Encode the image to a compressed format. Single-use: the underlying
   *  texture is disposed during encoding (via `transferToImageBitmap`); a
   *  second call on the same instance throws. */
  async encode(format: GpuImageEncodeFormat, quality?: number): Promise<Uint8Array> {
    if (!this.texture) throw new Error("WebGpuImage.encode on a disposed image");
    const off = new OffscreenCanvas(this.width, this.height);
    const ctx = off.getContext("2d");
    if (!ctx) throw new Error("WebGpuImage.encode could not acquire a 2D context");
    const bitmap = await this.transferToImageBitmap();
    ctx.drawImage(bitmap, 0, 0);
    const blob = await off.convertToBlob({ type: `image/${format}`, quality });
    return new Uint8Array(await blob.arrayBuffer());
  }

  dispose(): void {
    if (!this.texture) return;
    const tex = this.texture;
    this.texture = null;
    try {
      getTexturePool(this.device).release(tex);
    } catch {
      // device lost or pool drained
    }
  }
}

registerGpuImageFactory("from", WebGpuImage.from.bind(WebGpuImage));

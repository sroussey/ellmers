/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import "@workglow/util/media";
import "@workglow/tasks";
import {
  ImageBlurTask,
  ImageBorderTask,
  ImageFlipTask,
  ImagePixelateTask,
  ImagePosterizeTask,
  ImageSepiaTask,
  ImageTextTask,
} from "@workglow/tasks";
import { CpuImage, imageValueFromBuffer, type ImageValue } from "@workglow/util/media";

const SIZES = [
  { name: "480p", w: 854, h: 480 },
  { name: "720p", w: 1280, h: 720 },
  { name: "1080p", w: 1920, h: 1080 },
];

async function runChain(start: ImageValue): Promise<ImageValue> {
  let img = start;
  img = (await new ImageTextTask().executePreview(
    {
      image: img,
      text: "PERF",
      font: "sans-serif",
      fontSize: 32,
      bold: false,
      italic: false,
      color: "#ffffff",
      position: "middle-center",
    } as never,
    {} as never,
  ))!.image as ImageValue;
  img = (await new ImageFlipTask().executePreview(
    { image: img, direction: "horizontal" } as never,
    {} as never,
  ))!.image as ImageValue;
  img = (await new ImageSepiaTask().executePreview({ image: img } as never, {} as never))!
    .image as ImageValue;
  img = (await new ImageBlurTask().executePreview({ image: img, radius: 2 } as never, {} as never))!
    .image as ImageValue;
  img = (await new ImagePosterizeTask().executePreview(
    { image: img, levels: 4 } as never,
    {} as never,
  ))!.image as ImageValue;
  img = (await new ImageBorderTask().executePreview(
    { image: img, borderWidth: 4, color: "#000000" } as never,
    {} as never,
  ))!.image as ImageValue;
  img = (await new ImagePixelateTask().executePreview(
    { image: img, blockSize: 2 } as never,
    {} as never,
  ))!.image as ImageValue;
  // Force a materialization round-trip so the timer covers the full preview chain.
  await CpuImage.from(img);
  return img;
}

async function bench(name: string, w: number, h: number, ITERS = 5): Promise<void> {
  const data = new Uint8ClampedArray(w * h * 4).fill(128);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const start = imageValueFromBuffer(buf, "raw-rgba", w, h);
  // Warm.
  await runChain(start);
  const t0 = performance.now();
  for (let i = 0; i < ITERS; i++) await runChain(start);
  const dt = (performance.now() - t0) / ITERS;
  console.log(`${name.padEnd(6)}: ${dt.toFixed(2)} ms/run (${(1000 / dt).toFixed(1)} fps)`);
}

console.log(
  "imageChainPerf — 7-stage chain (Text → Flip → Sepia → Blur → Posterize → Border → Pixelate)",
);
console.log(
  "Backend: cpu (default in node). Targets: 720p sharp ≤100ms, 720p webgpu ≤33ms, 720p cpu fallback ≤1500ms.\n",
);
for (const s of SIZES) await bench(s.name, s.w, s.h);

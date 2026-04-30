/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { Task } from "@workglow/task-graph";
import type {
  IExecuteContext,
  IExecutePreviewContext,
  TaskConfig,
} from "@workglow/task-graph";
import { applyFilter, CpuImage, GpuImageFactory, hasFilterOp } from "@workglow/util/media";
import type { GpuImage, ImageValue } from "@workglow/util/media";

export interface ImageFilterInput { image: ImageValue; }
export interface ImageFilterOutput { image: ImageValue; }

export abstract class ImageFilterTask<
  P,
  Input extends ImageFilterInput & Record<string, unknown> = ImageFilterInput & Record<string, unknown>,
  Output extends ImageFilterOutput & Record<string, unknown> = ImageFilterOutput & Record<string, unknown>,
  Config extends TaskConfig = TaskConfig,
> extends Task<Input, Output, Config> {
  protected abstract readonly filterName: string;
  protected abstract opParams(input: Input): P;

  /** Override in subclasses with pixel-space params. Default is identity.
   *  Always called before applyFilter; multiply-by-1 in run mode is a no-op.
   *  Now called by both execute() and executePreview() since ImageValue
   *  carries previewScale on the value, not the run mode. */
  protected scalePreviewParams(params: P, _scale: number): P {
    return params;
  }

  private async runFilter(input: Input): Promise<Output | undefined> {
    const previewScale = input.image.previewScale;
    let gpu: GpuImage = await GpuImageFactory.from(input.image);
    try {
      if (!hasFilterOp(gpu.backend, this.filterName)) {
        const cpu = await CpuImage.from(input.image);
        gpu.dispose();
        gpu = cpu;
      }
      const params = this.scalePreviewParams(this.opParams(input), previewScale);
      const out = applyFilter(gpu, this.filterName, params);
      gpu.dispose();
      try {
        const value = await out.toImageValue(previewScale);
        return { image: value } as Output;
      } catch (err) {
        // toImageValue self-disposes on its happy path; this catches a throw
        // before that disposal runs (e.g. a sync precondition failure).
        try {
          out.dispose();
        } catch {
          // already disposed — fall through
        }
        throw err;
      }
    } catch (err) {
      gpu.dispose();
      throw err;
    }
  }

  override async execute(input: Input, _ctx: IExecuteContext): Promise<Output | undefined> {
    return this.runFilter(input);
  }

  override async executePreview(
    input: Input,
    _ctx: IExecutePreviewContext,
  ): Promise<Output | undefined> {
    return this.runFilter(input);
  }
}

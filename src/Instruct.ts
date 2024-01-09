//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

import type { Model } from "./Model";

export class Instruct {
  public queryInstruction: string = "";
  public storageInstruction: string = "";
  public model: Model | null = null;
  public parameters: Record<string, string | number> = {};

  constructor(
    public name: string,
    public description: string,
    options?: Partial<
      Pick<
        Instruct,
        "queryInstruction" | "storageInstruction" | "model" | "parameters"
      >
    >
  ) {
    Object.assign(this, options);
  }
}

export type InstructList = Instruct[];

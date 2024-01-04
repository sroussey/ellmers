//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

export class Model {
  constructor(
    public name: string,
    public dimensions: number,
    public pipeline: string,
    public parameters: Record<string, string | number>
  ) {}
}
export type ModelList = Model[];

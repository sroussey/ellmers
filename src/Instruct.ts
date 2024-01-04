//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiential Retrieval Service        *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    *   Licensed under the Apache License, Version 2.0 (the "License");        *
//    ****************************************************************************

export class Instruct {
  constructor(
    public name: string,
    public documentation: string,
    public queryInstruction: string,
    public storageInstruction: string,
    public parameters: Record<string, string | number>
  ) {}
}

export type InstructList = Instruct[];

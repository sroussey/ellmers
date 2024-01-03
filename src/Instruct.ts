//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
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

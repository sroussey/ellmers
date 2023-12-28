//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

export interface IInstruct {
  name: string;
  documentation: string;
  queryInstruction: string;
  storageInstruction: string;
  parameters: Record<string, string | number>;
}

export type IInstructList = IInstruct[];

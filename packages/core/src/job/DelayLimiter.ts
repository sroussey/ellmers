//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ILimiter } from "./ILimiter";

export class DelayLimiter implements ILimiter {
  constructor(private delayInMilliseconds: number = 50) {}
  async canProceed(): Promise<boolean> {
    return true;
  }

  recordJobStart(): void {}

  recordJobCompletion(): void {}

  async getNextAvailableTime(): Promise<Date> {
    return new Date(Date.now() + this.delayInMilliseconds);
  }
}

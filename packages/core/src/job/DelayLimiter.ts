//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ILimiter } from "./ILimiter";

export class DelayLimiter implements ILimiter {
  private nextAvailableTime: Date = new Date();
  constructor(private delayInMilliseconds: number = 50) {}

  async canProceed(): Promise<boolean> {
    return Date.now() >= this.nextAvailableTime.getTime();
  }

  async recordJobStart(): Promise<void> {
    this.nextAvailableTime = new Date(Date.now() + this.delayInMilliseconds);
  }

  async recordJobCompletion(): Promise<void> {
    // No action needed.
  }

  async getNextAvailableTime(): Promise<Date> {
    return this.nextAvailableTime;
  }

  async setNextAvailableTime(date: Date): Promise<void> {
    if (date > this.nextAvailableTime) {
      this.nextAvailableTime = date;
    }
  }
  async clear(): Promise<void> {
    this.nextAvailableTime = new Date();
  }
}

//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { ILimiter } from "./ILimiter";

export class CompositeLimiter implements ILimiter {
  private limiters: ILimiter[] = [];

  constructor(limiters: ILimiter[] = []) {
    this.limiters = limiters;
  }

  addLimiter(limiter: ILimiter): void {
    this.limiters.push(limiter);
  }

  async canProceed(): Promise<boolean> {
    for (const limiter of this.limiters) {
      if (!(await limiter.canProceed())) {
        return false; // If any limiter says "no", proceed no further
      }
    }
    return true; // All limiters agree
  }

  async recordJobStart(): Promise<void> {
    this.limiters.forEach((limiter) => limiter.recordJobStart());
  }

  async recordJobCompletion(): Promise<void> {
    this.limiters.forEach((limiter) => limiter.recordJobCompletion());
  }

  async getNextAvailableTime(): Promise<Date> {
    let maxDate = new Date(); // Assume now as the default
    for (const limiter of this.limiters) {
      const limiterNextTime = await limiter.getNextAvailableTime();
      if (limiterNextTime > maxDate) {
        maxDate = limiterNextTime; // Find the latest time among limiters
      }
    }
    return maxDate;
  }

  async setNextAvailableTime(date: Date): Promise<void> {
    for (const limiter of this.limiters) {
      await limiter.setNextAvailableTime(date);
    }
  }

  async clear(): Promise<void> {
    this.limiters.forEach((limiter) => limiter.clear());
  }
}

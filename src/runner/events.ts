import type { Click, Interval, Move, StepEvent } from '../timeline/types';

/** Collects what happened during a run, timed relative to capture start. */
export class EventLog {
  readonly steps: StepEvent[] = [];
  readonly moves: Move[] = [];
  readonly clicks: Click[] = [];
  readonly idle: Interval[] = [];

  constructor(private readonly t0: number = Date.now()) {}

  now(): number {
    return Date.now() - this.t0;
  }
}

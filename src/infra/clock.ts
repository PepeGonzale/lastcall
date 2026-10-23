import type { Clock } from '../app/ports.js';

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** Tests drive time explicitly so anti-snipe behaviour is not a race. */
export class ManualClock implements Clock {
  constructor(private value: number) {}

  now(): number {
    return this.value;
  }

  set(value: number): void {
    this.value = value;
  }

  advance(ms: number): void {
    this.value += ms;
  }
}

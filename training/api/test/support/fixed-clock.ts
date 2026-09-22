/** A controllable UTC clock for deterministic domain and integration tests. */
export class FixedClock {
  private current: Date;

  public constructor(instant: string | Date) {
    this.current = new Date(instant);
    if (Number.isNaN(this.current.getTime())) {
      throw new TypeError('FixedClock requires a valid ISO instant.');
    }
  }

  public now(): Date {
    return new Date(this.current);
  }

  public advanceBy(milliseconds: number): void {
    if (!Number.isFinite(milliseconds)) {
      throw new TypeError('FixedClock advance duration must be finite.');
    }
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

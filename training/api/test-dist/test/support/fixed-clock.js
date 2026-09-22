/** A controllable UTC clock for deterministic domain and integration tests. */
export class FixedClock {
    current;
    constructor(instant) {
        this.current = new Date(instant);
        if (Number.isNaN(this.current.getTime())) {
            throw new TypeError('FixedClock requires a valid ISO instant.');
        }
    }
    now() {
        return new Date(this.current);
    }
    advanceBy(milliseconds) {
        if (!Number.isFinite(milliseconds)) {
            throw new TypeError('FixedClock advance duration must be finite.');
        }
        this.current = new Date(this.current.getTime() + milliseconds);
    }
}

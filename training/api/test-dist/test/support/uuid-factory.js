/** Deterministic UUID v4-shaped generator; seed a new instance per test. */
export class DeterministicUuidFactory {
    sequence = 0;
    seed;
    constructor(seed) {
        this.seed = hashSeed(seed);
    }
    next() {
        this.sequence += 1;
        const tail = BigInt(this.seed) * 1000003n + BigInt(this.sequence);
        const hex = tail.toString(16).padStart(32, '0').slice(-32);
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    }
}
function hashSeed(value) {
    let hash = 2_166_136_261;
    for (const character of value) {
        hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
    }
    return hash >>> 0;
}

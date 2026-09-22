/** Deterministic UUID v4-shaped generator; seed a new instance per test. */
export class DeterministicUuidFactory {
  private sequence = 0;
  private readonly seed: number;

  public constructor(seed: string) {
    this.seed = hashSeed(seed);
  }

  public next(): string {
    this.sequence += 1;
    const tail = BigInt(this.seed) * 1_000_003n + BigInt(this.sequence);
    const hex = tail.toString(16).padStart(32, '0').slice(-32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
}

function hashSeed(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  }
  return hash >>> 0;
}

import { describe, expect, it } from 'vitest';
import { MAX_DT, MAX_F, packHash, unpackHash } from '../src/core/hash';
import { rng } from './helpers/synth';

describe('packHash / unpackHash', () => {
  it('round-trips every field across its full range', () => {
    const rand = rng(1);
    for (let i = 0; i < 10_000; i++) {
      const f1 = Math.floor(rand() * (MAX_F + 1));
      const f2 = Math.floor(rand() * (MAX_F + 1));
      const dt = Math.floor(rand() * (MAX_DT + 1));
      expect(unpackHash(packHash(f1, f2, dt))).toEqual({ f1, f2, dt });
    }
  });

  it('round-trips the extremes', () => {
    for (const [f1, f2, dt] of [
      [0, 0, 0],
      [MAX_F, MAX_F, MAX_DT],
      [MAX_F, 0, 1],
      [0, MAX_F, MAX_DT],
    ]) {
      expect(unpackHash(packHash(f1, f2, dt))).toEqual({ f1, f2, dt });
    }
  });

  it('produces non-negative 24-bit integers', () => {
    const h = packHash(MAX_F, MAX_F, MAX_DT);
    expect(h).toBe(0xffffff);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
  });

  it('masks out-of-range inputs instead of bleeding into neighbouring fields', () => {
    expect(unpackHash(packHash(MAX_F + 1, 5, 7))).toEqual({ f1: 0, f2: 5, dt: 7 });
    expect(unpackHash(packHash(3, 5, MAX_DT + 2))).toEqual({ f1: 3, f2: 5, dt: 1 });
  });

  it('is injective: each field change yields a distinct hash', () => {
    const base = packHash(100, 200, 10);
    expect(packHash(101, 200, 10)).not.toBe(base);
    expect(packHash(100, 201, 10)).not.toBe(base);
    expect(packHash(100, 200, 11)).not.toBe(base);
    // swapping f1 and f2 matters (direction of the pair is part of the hash)
    expect(packHash(200, 100, 10)).not.toBe(base);
  });
});

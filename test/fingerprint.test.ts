import { describe, expect, it } from 'vitest';
import { FAN_OUT, HOP_SIZE, NUM_BINS, SAMPLE_RATE, TARGET_DT_MAX, WINDOW_SIZE } from '../src/core/config';
import { FFT } from '../src/core/fft';
import { fingerprint } from '../src/core/fingerprint';
import { unpackHash } from '../src/core/hash';
import { stft } from '../src/core/stft';
import { scale, synthSong } from './helpers/synth';

describe('FFT', () => {
  it('matches a naive DFT', () => {
    const n = 64;
    const re = new Float64Array(n).map((_, i) => Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.7));
    const im = new Float64Array(n);
    const xr = re.slice();
    new FFT(n).transform(re, im);
    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      for (let t = 0; t < n; t++) {
        sr += xr[t] * Math.cos((-2 * Math.PI * k * t) / n);
        si += xr[t] * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(sr, 9);
      expect(im[k]).toBeCloseTo(si, 9);
    }
  });
});

describe('stft', () => {
  it('puts a pure tone in the expected bin', () => {
    const hz = 1000;
    const pcm = new Float32Array(SAMPLE_RATE).map((_, i) => Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE));
    const spec = stft(pcm);
    expect(spec.numBins).toBe(NUM_BINS);
    expect(spec.numFrames).toBe(Math.floor((pcm.length - WINDOW_SIZE) / HOP_SIZE) + 1);
    const row = spec.data.subarray(5 * NUM_BINS, 6 * NUM_BINS);
    const peakBin = row.indexOf(Math.max(...row));
    expect(peakBin).toBe(Math.round((hz * WINDOW_SIZE) / SAMPLE_RATE));
  });
});

describe('fingerprint', () => {
  const song = synthSong(11, 20);

  it('is deterministic', () => {
    const a = fingerprint(song);
    const b = fingerprint(song);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.times).toEqual(b.times);
  });

  it('produces a sensible density of hashes within the target zone', () => {
    const fp = fingerprint(song);
    const perSec = fp.hashes.length / 20;
    expect(perSec).toBeGreaterThan(30);
    expect(perSec).toBeLessThan(1000);
    // fan-out cap holds per anchor
    const perAnchor = new Map<string, number>();
    for (let i = 0; i < fp.hashes.length; i++) {
      const { f1, dt } = unpackHash(fp.hashes[i]);
      expect(dt).toBeGreaterThanOrEqual(1);
      expect(dt).toBeLessThanOrEqual(TARGET_DT_MAX);
      const key = `${fp.times[i]}:${f1}`;
      perAnchor.set(key, (perAnchor.get(key) ?? 0) + 1);
    }
    for (const c of perAnchor.values()) expect(c).toBeLessThanOrEqual(FAN_OUT);
  });

  it('yields no hashes for silence', () => {
    expect(fingerprint(new Float32Array(5 * SAMPLE_RATE)).hashes.length).toBe(0);
  });

  it('is invariant to overall gain', () => {
    const a = fingerprint(song);
    const b = fingerprint(scale(song, 0.05));
    expect(b.hashes).toEqual(a.hashes);
  });

  it('shifts anchor times exactly when the signal is shifted by whole hops', () => {
    const shiftFrames = 37;
    const shifted = song.slice(shiftFrames * HOP_SIZE);
    const a = fingerprint(song);
    const b = fingerprint(shifted);
    const setA = new Set<string>();
    for (let i = 0; i < a.hashes.length; i++) setA.add(`${a.hashes[i]}@${a.times[i]}`);
    let shared = 0;
    for (let i = 0; i < b.hashes.length; i++) {
      if (setA.has(`${b.hashes[i]}@${b.times[i] + shiftFrames}`)) shared++;
    }
    // Edge effects of peak picking at the new start only touch a few frames.
    expect(shared / b.hashes.length).toBeGreaterThan(0.9);
  });
});

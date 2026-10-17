import { readFileSync } from 'node:fs';
import { SAMPLE_RATE } from '../../src/core/config';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

function addTone(
  out: Float32Array,
  start: number,
  len: number,
  hz: number,
  amp: number,
  harmonics: number,
  decay: number,
): void {
  const end = Math.min(out.length, start + len);
  for (let h = 1; h <= harmonics; h++) {
    const f = hz * h;
    if (f >= SAMPLE_RATE / 2) break;
    const w = (2 * Math.PI * f) / SAMPLE_RATE;
    const a = amp / h;
    for (let i = start; i < end; i++) {
      const n = i - start;
      const env = Math.min(1, n / 80) * Math.exp(-n / (decay * SAMPLE_RATE));
      out[i] += a * env * Math.sin(w * n);
    }
  }
}

/**
 * A synthetic "song": random melody over a chord progression, a bass line,
 * kick and hi-hat. Every seed gives a different, non-repeating piece in the
 * same style — so unseen seeds make realistic hard negatives.
 */
export function synthSong(seed: number, durationSec: number): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.floor(durationSec * SAMPLE_RATE));
  const bpm = 90 + rand() * 50;
  const beat = Math.floor((60 / bpm) * SAMPLE_RATE);
  const eighth = beat >> 1;
  const root = 45 + Math.floor(rand() * 12);
  const scale = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];

  let chord = [0, 4, 7];
  for (let s = 0, step = 0; s < out.length; s += eighth, step++) {
    if (step % 8 === 0) {
      const deg = scale[Math.floor(rand() * 6)];
      chord = [deg, deg + 4 - (rand() < 0.5 ? 1 : 0), deg + 7];
      for (const c of chord) addTone(out, s, beat * 4, midiToHz(root + 12 + c), 0.12, 4, 1.5);
      addTone(out, s, beat * 2, midiToHz(root + chord[0] - 12), 0.25, 3, 0.6);
    }
    // Melody: mostly eighths, occasional rests and long notes.
    if (rand() < 0.8) {
      const note = root + 24 + scale[Math.floor(rand() * scale.length)];
      const len = rand() < 0.2 ? beat * 2 : eighth;
      addTone(out, s, len, midiToHz(note), 0.2, 6, 0.4);
    }
    // Kick on beats 1 and 3.
    if (step % 4 === 0) {
      const len = Math.floor(0.15 * SAMPLE_RATE);
      for (let i = 0; i < len && s + i < out.length; i++) {
        const f = 50 + 70 * Math.exp(-i / 300);
        out[s + i] += 0.5 * Math.exp(-i / 900) * Math.sin((2 * Math.PI * f * i) / SAMPLE_RATE);
      }
    }
    // Hi-hat on off-beats: decaying high-passed noise.
    if (step % 2 === 1) {
      const len = Math.floor(0.05 * SAMPLE_RATE);
      let prev = 0;
      for (let i = 0; i < len && s + i < out.length; i++) {
        const x = rand() * 2 - 1;
        out[s + i] += 0.08 * Math.exp(-i / 120) * (x - prev);
        prev = x;
      }
    }
  }
  return out;
}

export function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

/** Returns a copy of `x` with white Gaussian noise added at the given SNR (dB). */
export function addNoise(x: Float32Array, snrDb: number, seed: number): Float32Array {
  const rand = rng(seed);
  const sigma = rms(x) / 10 ** (snrDb / 20);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] + sigma * gaussian(rand);
  return out;
}

export function whiteNoise(samples: number, seed: number, amp = 0.3): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) out[i] = amp * gaussian(rand);
  return out;
}

export function scale(x: Float32Array, gain: number): Float32Array {
  return x.map((v) => v * gain);
}

export function cut(x: Float32Array, startSec: number, durSec: number, rate = SAMPLE_RATE): Float32Array {
  const a = Math.floor(startSec * rate);
  return x.slice(a, a + Math.floor(durSec * rate));
}

/** Minimal RIFF/WAVE reader: PCM 8/16/24/32-bit int and 32/64-bit float. */
export function readWav(path: string): { sampleRate: number; channels: Float32Array[] } {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error(`${path}: not a WAVE file`);

  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      let format = dv.getUint16(body, true);
      if (format === 0xfffe) format = dv.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
      fmt = {
        format,
        channels: dv.getUint16(body + 2, true),
        rate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error(`${path}: data before fmt`);
      const bytes = fmt.bits / 8;
      const frames = Math.floor(Math.min(size, buf.length - body) / (bytes * fmt.channels));
      const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < fmt.channels; c++) {
          const p = body + (i * fmt.channels + c) * bytes;
          let v: number;
          if (fmt.format === 3) v = fmt.bits === 64 ? dv.getFloat64(p, true) : dv.getFloat32(p, true);
          else if (fmt.bits === 8) v = (dv.getUint8(p) - 128) / 128;
          else if (fmt.bits === 16) v = dv.getInt16(p, true) / 32768;
          else if (fmt.bits === 24) v = ((dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getInt8(p + 2) << 16)) / 8388608);
          else v = dv.getInt32(p, true) / 2147483648;
          channels[c][i] = v;
        }
      }
      return { sampleRate: fmt.rate, channels };
    }
    off = body + size + (size & 1);
  }
  throw new Error(`${path}: no data chunk`);
}

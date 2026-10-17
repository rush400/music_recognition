import {
  FAN_OUT,
  TARGET_DF_MAX,
  TARGET_DT_MAX,
  TARGET_DT_MIN,
} from './config';
import { packHash } from './hash';
import { findPeaks, type Peak } from './peaks';
import { stft } from './stft';

export interface Fingerprint {
  /** Packed (f1, f2, dt) hashes. */
  hashes: Uint32Array;
  /** Anchor time (STFT frame) for each hash, parallel to `hashes`. */
  times: Uint32Array;
}

/** Scales a copy of the signal to peak amplitude 1 (no-op for silence). */
export function normalize(pcm: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > peak) peak = a;
  }
  const out = new Float32Array(pcm.length);
  if (peak === 0) return out;
  const g = 1 / peak;
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * g;
  return out;
}

/** Pairs each anchor with up to FAN_OUT later peaks inside the target zone. */
export function pairPeaks(peaks: Peak[]): Fingerprint {
  const hashes: number[] = [];
  const times: number[] = [];
  for (let i = 0; i < peaks.length; i++) {
    const a = peaks[i];
    let paired = 0;
    for (let j = i + 1; j < peaks.length && paired < FAN_OUT; j++) {
      const b = peaks[j];
      const dt = b.t - a.t;
      if (dt > TARGET_DT_MAX) break;
      if (dt < TARGET_DT_MIN) continue;
      if (Math.abs(b.f - a.f) > TARGET_DF_MAX) continue;
      hashes.push(packHash(a.f, b.f, dt));
      times.push(a.t);
      paired++;
    }
  }
  return { hashes: Uint32Array.from(hashes), times: Uint32Array.from(times) };
}

/** Full pipeline: mono PCM at SAMPLE_RATE → constellation hashes. */
export function fingerprint(pcm: Float32Array): Fingerprint {
  return pairPeaks(findPeaks(stft(normalize(pcm))));
}

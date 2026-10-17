import {
  PEAK_ABS_FLOOR,
  PEAK_BANDS,
  PEAK_MEAN_COEFF,
  PEAK_TIME_NEIGHBORHOOD,
} from './config';
import type { Spectrogram } from './stft';

export interface Peak {
  /** Frame index. */
  t: number;
  /** Frequency bin. */
  f: number;
}

/**
 * Constellation map: for each frame take the strongest bin in each band, keep it
 * if it stands out from the frame's other band maxima, clears an absolute floor,
 * and is not dominated by the same bin in nearby frames.
 * Returned peaks are sorted by (t, f).
 */
export function findPeaks(spec: Spectrogram): Peak[] {
  const { data, numFrames, numBins } = spec;
  const peaks: Peak[] = [];
  const bandBin = new Int32Array(PEAK_BANDS.length);
  const bandVal = new Float64Array(PEAK_BANDS.length);

  for (let t = 0; t < numFrames; t++) {
    const row = t * numBins;
    let sum = 0;
    for (let b = 0; b < PEAK_BANDS.length; b++) {
      const [lo, hi] = PEAK_BANDS[b];
      let best = lo;
      let bestVal = -Infinity;
      for (let k = lo; k < hi; k++) {
        const v = data[row + k];
        if (v > bestVal) {
          bestVal = v;
          best = k;
        }
      }
      bandBin[b] = best;
      bandVal[b] = bestVal;
      sum += bestVal;
    }
    const threshold = Math.max(PEAK_ABS_FLOOR, (sum / PEAK_BANDS.length) * PEAK_MEAN_COEFF);

    for (let b = 0; b < PEAK_BANDS.length; b++) {
      const v = bandVal[b];
      if (v < threshold) continue;
      const k = bandBin[b];
      let isLocalMax = true;
      const t0 = Math.max(0, t - PEAK_TIME_NEIGHBORHOOD);
      const t1 = Math.min(numFrames - 1, t + PEAK_TIME_NEIGHBORHOOD);
      for (let u = t0; u <= t1 && isLocalMax; u++) {
        if (u !== t && data[u * numBins + k] > v) isLocalMax = false;
      }
      if (isLocalMax) peaks.push({ t, f: k });
    }
  }
  return peaks;
}

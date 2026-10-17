/**
 * All fingerprinting / matching tunables live here so the library and the
 * mic clip are always processed identically.
 */
export const SAMPLE_RATE = 11025;

/** STFT */
export const WINDOW_SIZE = 1024;
export const HOP_SIZE = 512; // 50% overlap
export const NUM_BINS = WINDOW_SIZE / 2 + 1; // 513

/** Seconds per STFT frame (anchor times are stored in frames). */
export const FRAME_SEC = HOP_SIZE / SAMPLE_RATE;

/**
 * Frequency bands (bin ranges, [lo, hi)) — one candidate peak per band per frame.
 * Roughly log-spaced so the bass doesn't dominate. At 11025 Hz each bin ≈ 10.8 Hz.
 */
export const PEAK_BANDS: ReadonlyArray<readonly [number, number]> = [
  [1, 10], // ~10–108 Hz (skip DC)
  [10, 20], // ~108–215 Hz
  [20, 40], // ~215–430 Hz
  [40, 80], // ~430–860 Hz
  [80, 160], // ~860–1720 Hz
  [160, 512], // ~1.7–5.5 kHz
];

/** A band peak must exceed mean(band maxima in frame) * this to be kept. */
export const PEAK_MEAN_COEFF = 1.0;
/** Absolute floor on log1p magnitude — kills peaks in silence. */
export const PEAK_ABS_FLOOR = 0.5;
/** A kept peak must also be a local max over ±this many frames (same bin). */
export const PEAK_TIME_NEIGHBORHOOD = 2;

/** Target zone for pairing anchor → target peaks. */
export const TARGET_DT_MIN = 1; // frames
export const TARGET_DT_MAX = 63; // frames (fits 6 bits)
export const TARGET_DF_MAX = 128; // bins
export const FAN_OUT = 10;

/** Matching thresholds (tuned from test score distributions). */
export const MIN_ALIGNED = 20; // aligned hash hits needed for a match
export const MIN_MARGIN_RATIO = 1.5; // top song score / runner-up score
/** Number of neighbouring offset bins summed into the peak (±). */
export const OFFSET_SMEAR = 1;

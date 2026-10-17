import { FFT } from './fft';
import { HOP_SIZE, NUM_BINS, WINDOW_SIZE } from './config';

export interface Spectrogram {
  /** Row-major [frame * numBins + bin], log1p magnitude. */
  data: Float32Array;
  numFrames: number;
  numBins: number;
}

let cachedFFT: FFT | null = null;
let cachedWindow: Float64Array | null = null;

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * Short-time Fourier transform: Hann window, 50% overlap, log-magnitude.
 * Input should be mono PCM at SAMPLE_RATE. Frames that would run past the end
 * are dropped.
 */
export function stft(pcm: Float32Array): Spectrogram {
  const fft = (cachedFFT ??= new FFT(WINDOW_SIZE));
  const win = (cachedWindow ??= hann(WINDOW_SIZE));
  const numFrames = pcm.length >= WINDOW_SIZE ? Math.floor((pcm.length - WINDOW_SIZE) / HOP_SIZE) + 1 : 0;
  const data = new Float32Array(numFrames * NUM_BINS);
  const re = new Float64Array(WINDOW_SIZE);
  const im = new Float64Array(WINDOW_SIZE);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * HOP_SIZE;
    for (let i = 0; i < WINDOW_SIZE; i++) {
      re[i] = pcm[offset + i] * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    const row = f * NUM_BINS;
    for (let k = 0; k < NUM_BINS; k++) {
      data[row + k] = Math.log1p(Math.hypot(re[k], im[k]));
    }
  }
  return { data, numFrames, numBins: NUM_BINS };
}

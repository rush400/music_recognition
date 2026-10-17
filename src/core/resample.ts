/**
 * Windowed-sinc resampler (Hann-windowed, with anti-alias cutoff when
 * downsampling). The browser path uses OfflineAudioContext; this one exists for
 * environments without Web Audio (tests, workers).
 */
export function resample(input: Float32Array, fromRate: number, toRate: number, halfTaps = 16): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = toRate / fromRate;
  const outLen = Math.floor(input.length * ratio);
  const out = new Float32Array(outLen);
  const cutoff = Math.min(1, ratio); // normalized to input Nyquist
  const support = halfTaps / cutoff;

  for (let i = 0; i < outLen; i++) {
    const center = i / ratio;
    const lo = Math.max(0, Math.ceil(center - support));
    const hi = Math.min(input.length - 1, Math.floor(center + support));
    let acc = 0;
    let wsum = 0;
    for (let j = lo; j <= hi; j++) {
      const x = (j - center) * cutoff;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const win = 0.5 + 0.5 * Math.cos((Math.PI * (j - center)) / support);
      const w = sinc * win;
      acc += input[j] * w;
      wsum += w;
    }
    out[i] = wsum !== 0 ? acc / wsum : 0;
  }
  return out;
}

/** Averages planar channels (e.g. AudioBuffer.getChannelData) to mono. */
export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0].slice();
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  for (let i = 0; i < n; i++) out[i] /= channels.length;
  return out;
}

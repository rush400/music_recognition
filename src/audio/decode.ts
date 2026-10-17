import { SAMPLE_RATE } from '../core/config';
import { downmix } from '../core/resample';

export interface DecodedAudio {
  /** Mono PCM at SAMPLE_RATE. */
  pcm: Float32Array;
  durationSec: number;
}

/**
 * Decodes any browser-supported audio file to mono PCM at SAMPLE_RATE.
 * decodeAudioData resamples to its context's rate, so an OfflineAudioContext at
 * SAMPLE_RATE does the rate conversion (and keeps memory small for long songs).
 */
export async function decodeFile(file: Blob): Promise<DecodedAudio> {
  const bytes = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buf = await ctx.decodeAudioData(bytes);
  const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  return { pcm: downmix(channels), durationSec: buf.duration };
}

/** Copies [startSec, startSec + durSec) out of mono PCM at SAMPLE_RATE, clamped to the signal. */
export function excerpt(pcm: Float32Array, startSec: number, durSec: number): Float32Array {
  const start = Math.max(0, Math.min(pcm.length, Math.round(startSec * SAMPLE_RATE)));
  const end = Math.max(start, Math.min(pcm.length, start + Math.round(durSec * SAMPLE_RATE)));
  return pcm.slice(start, end);
}

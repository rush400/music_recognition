/** Messages between FingerprintWorker and fingerprint.worker.ts. */
export interface FingerprintRequest {
  id: number;
  /** Mono PCM (transferred, so the sender's copy is detached). */
  pcm: Float32Array;
  /** Rate of `pcm`; resampled to SAMPLE_RATE in the worker if different. */
  sampleRate: number;
}

export type FingerprintResponse =
  | { id: number; ok: true; hashes: Uint32Array; times: Uint32Array }
  | { id: number; ok: false; error: string };

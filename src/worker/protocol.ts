/** Messages between FingerprintWorker and fingerprint.worker.ts. */
export interface FingerprintRequest {
  id: number;
  /** Mono PCM at SAMPLE_RATE (transferred, so the sender's copy is detached). */
  pcm: Float32Array;
}

export type FingerprintResponse =
  | { id: number; ok: true; hashes: Uint32Array; times: Uint32Array }
  | { id: number; ok: false; error: string };

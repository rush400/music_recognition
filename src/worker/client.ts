import type { Fingerprint } from '../core/fingerprint';
import type { FingerprintRequest, FingerprintResponse } from './protocol';

interface Pending {
  resolve: (fp: Fingerprint) => void;
  reject: (err: Error) => void;
}

/** Runs fingerprint() off the main thread. Requests are answered in order. */
export class FingerprintWorker {
  private readonly worker = new Worker(new URL('./fingerprint.worker.ts', import.meta.url), { type: 'module' });
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<FingerprintResponse>) => {
      const res = e.data;
      const p = this.pending.get(res.id);
      if (!p) return;
      this.pending.delete(res.id);
      if (res.ok) p.resolve({ hashes: res.hashes, times: res.times });
      else p.reject(new Error(res.error));
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'Fingerprint worker failed');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  /** Fingerprints mono PCM at SAMPLE_RATE. `pcm`'s buffer is transferred and becomes unusable. */
  fingerprint(pcm: Float32Array): Promise<Fingerprint> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const req: FingerprintRequest = { id, pcm };
      this.worker.postMessage(req, [pcm.buffer]);
    });
  }
}

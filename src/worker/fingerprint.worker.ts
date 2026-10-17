import { fingerprint } from '../core/fingerprint';
import type { FingerprintRequest, FingerprintResponse } from './protocol';

self.onmessage = (e: MessageEvent<FingerprintRequest>) => {
  const { id, pcm } = e.data;
  let res: FingerprintResponse;
  try {
    const fp = fingerprint(pcm);
    res = { id, ok: true, hashes: fp.hashes, times: fp.times };
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) } satisfies FingerprintResponse);
    return;
  }
  self.postMessage(res, { transfer: [res.hashes.buffer, res.times.buffer] });
};

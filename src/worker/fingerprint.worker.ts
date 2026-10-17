import { SAMPLE_RATE } from '../core/config';
import { fingerprint } from '../core/fingerprint';
import { resample } from '../core/resample';
import type { FingerprintRequest, FingerprintResponse } from './protocol';

self.onmessage = (e: MessageEvent<FingerprintRequest>) => {
  const { id, pcm, sampleRate } = e.data;
  let res: FingerprintResponse;
  try {
    const mono = sampleRate === SAMPLE_RATE ? pcm : resample(pcm, sampleRate, SAMPLE_RATE);
    const fp = fingerprint(mono);
    res = { id, ok: true, hashes: fp.hashes, times: fp.times };
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) } satisfies FingerprintResponse);
    return;
  }
  self.postMessage(res, { transfer: [res.hashes.buffer, res.times.buffer] });
};

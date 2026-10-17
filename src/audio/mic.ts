/**
 * AudioWorklet that downmixes its input to mono and posts it in 4096-sample
 * chunks. Inlined as a Blob URL so it needs no separate build entry.
 */
const TAP_SOURCE = `
class Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.n = 0;
  }
  process(inputs) {
    const chans = inputs[0];
    if (chans && chans.length) {
      for (let i = 0; i < chans[0].length; i++) {
        let s = 0;
        for (let c = 0; c < chans.length; c++) s += chans[c][i];
        this.buf[this.n++] = s / chans.length;
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(4096);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('recognize-tap', Tap);
`;

/**
 * Records raw mono PCM from the microphone at the device's native rate.
 * Browser voice processing is turned off: echo cancellation, noise suppression
 * and auto-gain are tuned for speech and smear the spectral peaks music relies on.
 */
export class MicRecorder {
  private readonly chunks: Float32Array[] = [];
  private length = 0;
  /** Loudness of the latest chunk, 0 (silent / ≤ −60 dBFS) to 1 (full scale). */
  level = 0;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly stream: MediaStream,
    private readonly node: AudioWorkletNode,
  ) {
    node.port.onmessage = (e: MessageEvent<Float32Array>) => this.push(e.data);
  }

  /** Asks for mic permission and starts recording. Rejects with the getUserMedia DOMException on failure. */
  static async start(): Promise<MicRecorder> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const ctx = new AudioContext();
    try {
      const url = URL.createObjectURL(new Blob([TAP_SOURCE], { type: 'text/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(ctx, 'recognize-tap');
      // Route through a muted gain so the graph is pulled without echoing the mic.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      ctx.createMediaStreamSource(stream).connect(node).connect(mute).connect(ctx.destination);
      if (ctx.state === 'suspended') await ctx.resume();
      return new MicRecorder(ctx, stream, node);
    } catch (err) {
      for (const t of stream.getTracks()) t.stop();
      void ctx.close();
      throw err;
    }
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  get durationSec(): number {
    return this.length / this.ctx.sampleRate;
  }

  /** A copy of everything recorded so far, as one mono buffer at `sampleRate`. */
  samples(): Float32Array {
    const out = new Float32Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }

  stop(): void {
    this.node.port.onmessage = null;
    this.node.disconnect();
    for (const t of this.stream.getTracks()) t.stop();
    void this.ctx.close();
  }

  private push(chunk: Float32Array): void {
    this.chunks.push(chunk);
    this.length += chunk.length;
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    const db = 10 * Math.log10(sum / chunk.length + 1e-12);
    this.level = Math.max(0, Math.min(1, (db + 60) / 60));
  }
}

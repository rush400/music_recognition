import { FRAME_SEC, MIN_ALIGNED, MIN_MARGIN_RATIO, OFFSET_SMEAR } from './config';
import type { Fingerprint } from './fingerprint';

/** Storage-agnostic lookup so an IndexedDB-backed index can drop in later. */
export interface FingerprintIndex {
  add(songId: number, fp: Fingerprint): void;
  remove(songId: number): void;
  /** Flat [songId, anchorTime, songId, anchorTime, ...] postings, or undefined. */
  lookup(hash: number): ArrayLike<number> | undefined;
}

export class InMemoryIndex implements FingerprintIndex {
  private readonly postings = new Map<number, number[]>();

  add(songId: number, fp: Fingerprint): void {
    for (let i = 0; i < fp.hashes.length; i++) {
      const h = fp.hashes[i];
      let list = this.postings.get(h);
      if (!list) this.postings.set(h, (list = []));
      list.push(songId, fp.times[i]);
    }
  }

  remove(songId: number): void {
    for (const [h, list] of this.postings) {
      const kept: number[] = [];
      for (let i = 0; i < list.length; i += 2) {
        if (list[i] !== songId) kept.push(list[i], list[i + 1]);
      }
      if (kept.length === 0) this.postings.delete(h);
      else if (kept.length !== list.length) this.postings.set(h, kept);
    }
  }

  lookup(hash: number): ArrayLike<number> | undefined {
    return this.postings.get(hash);
  }

  get size(): number {
    return this.postings.size;
  }
}

export interface SongScore {
  songId: number;
  /** Aligned hits in the best offset bin ± OFFSET_SMEAR. */
  score: number;
  /** Best offset in frames (songTime − clipTime). */
  offsetFrames: number;
}

export interface MatchResult {
  matched: boolean;
  /** Best candidate (present even when `matched` is false, for diagnostics). */
  best: SongScore | null;
  /** Where in the song the clip starts, in seconds. */
  offsetSec: number;
  /** Strongest competing evidence: runner-up song or off-peak offset in the winner. */
  runnerUpScore: number;
  /** 0–1. */
  confidence: number;
  /** All candidate songs, best first. */
  candidates: SongScore[];
}

/** Bins further than this from the winner's peak count as "background" for it. */
const OFF_PEAK_GUARD = 3;

function bestOffset(hist: Map<number, number>): { offset: number; score: number } {
  let offset = 0;
  let score = 0;
  for (const off of hist.keys()) {
    let s = 0;
    for (let d = -OFFSET_SMEAR; d <= OFFSET_SMEAR; d++) s += hist.get(off + d) ?? 0;
    if (s > score || (s === score && (hist.get(off) ?? 0) > (hist.get(offset) ?? 0))) {
      score = s;
      offset = off;
    }
  }
  return { offset, score };
}

/**
 * Offset-histogram matching: true matches produce many hash hits that agree on
 * a single (songTime − clipTime) offset; chance hits scatter.
 */
export function match(index: FingerprintIndex, clip: Fingerprint): MatchResult {
  const hists = new Map<number, Map<number, number>>();
  for (let i = 0; i < clip.hashes.length; i++) {
    const postings = index.lookup(clip.hashes[i]);
    if (!postings) continue;
    const tc = clip.times[i];
    for (let p = 0; p < postings.length; p += 2) {
      const songId = postings[p];
      const off = postings[p + 1] - tc;
      let hist = hists.get(songId);
      if (!hist) hists.set(songId, (hist = new Map()));
      hist.set(off, (hist.get(off) ?? 0) + 1);
    }
  }

  const candidates: SongScore[] = [];
  for (const [songId, hist] of hists) {
    const { offset, score } = bestOffset(hist);
    candidates.push({ songId, score, offsetFrames: offset });
  }
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0] ?? null;
  if (!best) {
    return { matched: false, best: null, offsetSec: 0, runnerUpScore: 0, confidence: 0, candidates };
  }

  // Competing evidence: the next song, or the winner's own best off-peak offset.
  let runnerUp = candidates[1]?.score ?? 0;
  const winnerHist = hists.get(best.songId)!;
  const offPeak = new Map<number, number>();
  for (const [off, c] of winnerHist) {
    if (Math.abs(off - best.offsetFrames) > OFF_PEAK_GUARD) offPeak.set(off, c);
  }
  runnerUp = Math.max(runnerUp, bestOffset(offPeak).score);

  const margin = best.score / Math.max(1, runnerUp);
  const matched = best.score >= MIN_ALIGNED && margin >= MIN_MARGIN_RATIO;

  // Confidence: saturating in absolute strength × saturating in margin.
  const strength = 1 - Math.exp(-best.score / (2 * MIN_ALIGNED));
  const separation = 1 - Math.min(1, runnerUp / best.score);
  const confidence = Math.max(0, Math.min(1, strength * separation));

  return {
    matched,
    best,
    offsetSec: best.offsetFrames * FRAME_SEC,
    runnerUpScore: runnerUp,
    confidence,
    candidates,
  };
}

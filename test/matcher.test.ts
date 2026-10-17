import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FRAME_SEC, MIN_ALIGNED, SAMPLE_RATE } from '../src/core/config';
import { fingerprint } from '../src/core/fingerprint';
import { InMemoryIndex, match, type MatchResult } from '../src/core/matcher';
import { downmix, resample } from '../src/core/resample';
import { addNoise, cut, readWav, rng, scale, synthSong, whiteNoise } from './helpers/synth';

const SONG_SEC = 40;
const CLIP_SEC = 10;
const NUM_SONGS = 6;

const fmt = (r: MatchResult) =>
  `matched=${r.matched} song=${r.best?.songId} score=${r.best?.score} runnerUp=${r.runnerUpScore} ` +
  `offset=${r.offsetSec.toFixed(2)}s conf=${r.confidence.toFixed(2)}`;

describe('match (synthetic library)', () => {
  const songs: Float32Array[] = [];
  const index = new InMemoryIndex();

  beforeAll(() => {
    for (let i = 0; i < NUM_SONGS; i++) {
      songs.push(synthSong(100 + i, SONG_SEC));
      index.add(i, fingerprint(songs[i]));
    }
  });

  // A clip cut at a non-hop-aligned position, quieter, with noise.
  const OFFSET = 12.37;
  for (const snr of [10, 5, 0]) {
    it(`identifies a noisy clip at ${snr} dB SNR and recovers its offset`, () => {
      const clip = scale(addNoise(cut(songs[3], OFFSET, CLIP_SEC), snr, 42 + snr), 0.3);
      const r = match(index, fingerprint(clip));
      console.log(`[${snr} dB] ${fmt(r)}`);
      expect(r.matched).toBe(true);
      expect(r.best?.songId).toBe(3);
      expect(Math.abs(r.offsetSec - OFFSET)).toBeLessThanOrEqual(FRAME_SEC);
      expect(r.best!.score).toBeGreaterThanOrEqual(MIN_ALIGNED);
      expect(r.confidence).toBeGreaterThan(0.4);
    });
  }

  it('identifies clips from every song at random offsets (5 dB SNR)', () => {
    const rand = rng(7);
    for (let i = 0; i < NUM_SONGS; i++) {
      for (let trial = 0; trial < 3; trial++) {
        const start = rand() * (SONG_SEC - CLIP_SEC);
        const clip = addNoise(cut(songs[i], start, CLIP_SEC), 5, i * 10 + trial);
        const r = match(index, fingerprint(clip));
        expect(r.matched, `song ${i} @ ${start.toFixed(2)}s: ${fmt(r)}`).toBe(true);
        expect(r.best?.songId).toBe(i);
        expect(Math.abs(r.offsetSec - start)).toBeLessThanOrEqual(FRAME_SEC);
      }
    }
  });

  it('rejects pure noise', () => {
    const r = match(index, fingerprint(whiteNoise(CLIP_SEC * SAMPLE_RATE, 5)));
    console.log(`[noise] ${fmt(r)}`);
    expect(r.matched).toBe(false);
  });

  it('rejects clips from songs that are not in the library', () => {
    for (const seed of [900, 901, 902, 903]) {
      const r = match(index, fingerprint(cut(synthSong(seed, SONG_SEC), 15, CLIP_SEC)));
      console.log(`[unseen ${seed}] ${fmt(r)}`);
      expect(r.matched).toBe(false);
    }
  });

  it('rejects silence and an empty index gracefully', () => {
    expect(match(index, fingerprint(new Float32Array(CLIP_SEC * SAMPLE_RATE))).matched).toBe(false);
    const empty = match(new InMemoryIndex(), fingerprint(cut(songs[0], 5, CLIP_SEC)));
    expect(empty.matched).toBe(false);
    expect(empty.best).toBeNull();
  });

  it('stops matching a song once it is removed from the index', () => {
    const local = new InMemoryIndex();
    songs.forEach((s, i) => local.add(i, fingerprint(s)));
    local.remove(2);
    const r = match(local, fingerprint(cut(songs[2], 8, CLIP_SEC)));
    expect(r.best?.songId).not.toBe(2);
    expect(r.matched).toBe(false);
  });
});

// Real audio: drop 16/24-bit or float WAVs into test/fixtures/ to run these.
const FIXTURES = join(__dirname, 'fixtures');
const wavs = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((f) => f.toLowerCase().endsWith('.wav')) : [];

describe.skipIf(wavs.length === 0)('match (real WAV fixtures)', () => {
  const index = new InMemoryIndex();
  const pcms: Float32Array[] = [];

  beforeAll(() => {
    wavs.forEach((file, i) => {
      const { sampleRate, channels } = readWav(join(FIXTURES, file));
      const pcm = resample(downmix(channels), sampleRate, SAMPLE_RATE);
      pcms.push(pcm);
      index.add(i, fingerprint(pcm));
    });
  });

  for (const [i, file] of wavs.entries()) {
    it(`identifies a noisy 10 s clip of ${file}`, () => {
      const pcm = pcms[i];
      const dur = pcm.length / SAMPLE_RATE;
      const start = Math.max(0, Math.min(dur - CLIP_SEC, dur * 0.4 + 0.123));
      const clip = addNoise(cut(pcm, start, Math.min(CLIP_SEC, dur)), 5, i);
      const r = match(index, fingerprint(clip));
      console.log(`[${file}] ${fmt(r)}`);
      expect(r.matched).toBe(true);
      expect(r.best?.songId).toBe(i);
      expect(Math.abs(r.offsetSec - start)).toBeLessThanOrEqual(FRAME_SEC);
    });
  }
});

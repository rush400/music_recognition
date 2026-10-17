import { describe, expect, it } from 'vitest';
import { fingerprint } from '../src/core/fingerprint';
import { Library } from '../src/library';
import { addNoise, cut, synthSong } from './helpers/synth';

const SONG_SEC = 30;

describe('Library', () => {
  const songs = [synthSong(200, SONG_SEC), synthSong(201, SONG_SEC), synthSong(202, SONG_SEC)];
  const clip = (i: number) => fingerprint(addNoise(cut(songs[i], 8.3, 10), 10, i));

  it('identifies a clip by song name', () => {
    const lib = new Library();
    const added = songs.map((pcm, i) => lib.add(`Song ${i}`, SONG_SEC, fingerprint(pcm)));
    expect(lib.size).toBe(3);
    expect(added.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(added.every((s) => s.hashCount > 0)).toBe(true);

    const { result, song } = lib.identify(clip(1));
    expect(result.matched).toBe(true);
    expect(song?.name).toBe('Song 1');
  });

  it('stops matching a song once it is removed', () => {
    const lib = new Library();
    const [a, b] = songs.slice(0, 2).map((pcm, i) => lib.add(`Song ${i}`, SONG_SEC, fingerprint(pcm)));
    lib.remove(a.id);
    expect(lib.list()).toEqual([b]);

    const { result, song } = lib.identify(clip(0));
    expect(result.matched).toBe(false);
    expect(song).toBeNull();
  });

  it('returns no song for an empty library', () => {
    const { result, song } = new Library().identify(clip(2));
    expect(result.matched).toBe(false);
    expect(result.best).toBeNull();
    expect(song).toBeNull();
  });
});

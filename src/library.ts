import type { Fingerprint } from './core/fingerprint';
import { InMemoryIndex, match, type MatchResult } from './core/matcher';

export interface Song {
  id: number;
  name: string;
  durationSec: number;
  hashCount: number;
}

export interface Identification {
  result: MatchResult;
  /** The matched song, or null when `result.matched` is false. */
  song: Song | null;
}

/** The user's songs plus the fingerprint index they are matched against. */
export class Library {
  private readonly index = new InMemoryIndex();
  private readonly songs = new Map<number, Song>();
  private nextId = 1;

  add(name: string, durationSec: number, fp: Fingerprint): Song {
    const song: Song = { id: this.nextId++, name, durationSec, hashCount: fp.hashes.length };
    this.songs.set(song.id, song);
    this.index.add(song.id, fp);
    return song;
  }

  /** Re-adds a previously saved song under its original id. */
  restore(song: Song, fp: Fingerprint): void {
    this.songs.set(song.id, { ...song });
    this.index.add(song.id, fp);
    this.nextId = Math.max(this.nextId, song.id + 1);
  }

  remove(id: number): void {
    if (!this.songs.delete(id)) return;
    this.index.remove(id);
  }

  list(): Song[] {
    return [...this.songs.values()];
  }

  get size(): number {
    return this.songs.size;
  }

  identify(clip: Fingerprint): Identification {
    const result = match(this.index, clip);
    const song = result.matched && result.best ? (this.songs.get(result.best.songId) ?? null) : null;
    return { result, song };
  }
}

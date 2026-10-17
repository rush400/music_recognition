import type { Fingerprint } from './core/fingerprint';
import type { Song } from './library';

/** A library song with its fingerprint, as persisted. */
export interface StoredSong extends Song, Fingerprint {}

const DB_NAME = 'resonote';
const DB_VERSION = 1;
const SONGS = 'songs';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Persists the library in IndexedDB so it survives reloads (per browser, per site). */
export class SongStore {
  private constructor(private readonly db: IDBDatabase) {}

  /** Rejects if IndexedDB is unavailable (e.g. blocked site data). */
  static async open(): Promise<SongStore> {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SONGS)) req.result.createObjectStore(SONGS, { keyPath: 'id' });
    };
    return new SongStore(await request(req));
  }

  getAll(): Promise<StoredSong[]> {
    return request(this.db.transaction(SONGS).objectStore(SONGS).getAll());
  }

  async put(song: Song, fp: Fingerprint): Promise<void> {
    const record: StoredSong = { ...song, hashes: fp.hashes, times: fp.times };
    await request(this.db.transaction(SONGS, 'readwrite').objectStore(SONGS).put(record));
  }

  async delete(id: number): Promise<void> {
    await request(this.db.transaction(SONGS, 'readwrite').objectStore(SONGS).delete(id));
  }
}

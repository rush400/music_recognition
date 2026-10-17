import './style.css';
import { decodeFile, excerpt } from './audio/decode';
import { MicRecorder } from './audio/mic';
import { Library, type Identification, type Song } from './library';
import { SongStore } from './storage';
import { FingerprintWorker } from './worker/client';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const dropZone = $<HTMLLabelElement>('drop-zone');
const songInput = $<HTMLInputElement>('song-input');
const songList = $<HTMLUListElement>('song-list');
const libraryEmpty = $<HTMLParagraphElement>('library-empty');
const storageNote = $<HTMLParagraphElement>('storage-note');
const identifyForm = $<HTMLFormElement>('identify-form');
const clipInput = $<HTMLInputElement>('clip-input');
const clipStart = $<HTMLInputElement>('clip-start');
const clipLength = $<HTMLInputElement>('clip-length');
const identifyButton = $<HTMLButtonElement>('identify-button');
const resultBox = $<HTMLDivElement>('result');
const logoButton = $<HTMLButtonElement>('logo-button');
const logoStatus = $<HTMLParagraphElement>('logo-status');

/** Listening: first match attempt, then every CHECK_EVERY_SEC until MAX_SEC. */
const LISTEN_FIRST_CHECK_SEC = 4;
const LISTEN_CHECK_EVERY_SEC = 2;
const LISTEN_MAX_SEC = 15;

const library = new Library();
const worker = new FingerprintWorker();
/** Songs still being decoded/fingerprinted, so Identify waits for them. */
let busy = 0;
/** The active mic session, or null when not listening. */
let recorder: MicRecorder | null = null;
/** Where the library is saved, or null if this browser won't let us (it then lasts until reload). */
let store: SongStore | null = null;
/** True while the saved library is being read at startup. */
let loadingLibrary = false;
/** True while a file is being identified. */
let identifying = false;

/** What the logo button shows; the logo spins in every state but idle and disabled. */
type LogoState = 'listening' | 'identifying' | 'loading' | 'disabled' | 'idle';

function formatTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function listeningText(rec: MicRecorder): string {
  return `Listening… ${Math.floor(rec.durationSec)} s · tap to stop`;
}

function updateControls(): void {
  libraryEmpty.hidden = songList.children.length > 0;
  const notReady = library.size === 0 || busy > 0;
  identifyButton.disabled = notReady || recorder !== null || identifying;

  const state: LogoState = recorder
    ? 'listening'
    : identifying
      ? 'identifying'
      : busy > 0
        ? 'loading'
        : library.size === 0
          ? 'disabled'
          : 'idle';
  logoButton.dataset.state = state;
  logoButton.disabled = state !== 'idle' && state !== 'listening';
  logoButton.setAttribute('aria-label', recorder ? 'Stop listening' : 'Identify song');
  logoButton.setAttribute('aria-busy', String(state !== 'idle' && state !== 'disabled'));
  if (recorder) logoStatus.textContent = listeningText(recorder);
  else if (identifying) logoStatus.textContent = 'Identifying…';
  else if (busy > 0) logoStatus.textContent = loadingLibrary ? 'Loading your library…' : 'Adding songs…';
  else if (library.size === 0) logoStatus.textContent = 'Add songs to your library to start';
  else logoStatus.textContent = 'Tap to identify';
}

function renderSong(item: HTMLLIElement, song: Song): void {
  item.className = 'song';
  item.replaceChildren();
  const name = document.createElement('span');
  name.className = 'song-name';
  name.textContent = song.name;
  const meta = document.createElement('span');
  meta.className = 'song-meta';
  meta.textContent = `${formatTime(song.durationSec)} · ${song.hashCount.toLocaleString()} hashes`;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-button';
  remove.textContent = '×';
  remove.title = `Remove ${song.name}`;
  remove.setAttribute('aria-label', `Remove ${song.name}`);
  remove.onclick = () => {
    library.remove(song.id);
    store?.delete(song.id).catch((err) => console.error('Could not delete saved song', err));
    item.remove();
    updateControls();
  };
  item.append(name, meta, remove);
}

function renderSongStatus(item: HTMLLIElement, name: string, status: string, isError = false): void {
  item.className = isError ? 'song song-error' : 'song song-pending';
  item.replaceChildren();
  const nameEl = document.createElement('span');
  nameEl.className = 'song-name';
  nameEl.textContent = name;
  const meta = document.createElement('span');
  meta.className = 'song-meta';
  meta.textContent = status;
  item.append(nameEl, meta);
  if (isError) {
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'icon-button';
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', `Dismiss ${name}`);
    dismiss.onclick = () => {
      item.remove();
      updateControls();
    };
    item.append(dismiss);
  }
}

async function addSongs(files: File[]): Promise<void> {
  const audio = files.filter((f) => f.type.startsWith('audio/') || f.type === '');
  const items = audio.map((file) => {
    const item = document.createElement('li');
    renderSongStatus(item, stripExtension(file.name), 'Waiting…');
    songList.append(item);
    return item;
  });
  busy += audio.length;
  updateControls();

  // One at a time: decoding is memory-hungry and the worker is single-threaded anyway.
  for (const [i, file] of audio.entries()) {
    const item = items[i];
    const name = stripExtension(file.name);
    try {
      renderSongStatus(item, name, 'Decoding…');
      const { pcm, durationSec } = await decodeFile(file);
      renderSongStatus(item, name, 'Fingerprinting…');
      const fp = await worker.fingerprint(pcm);
      const song = library.add(name, durationSec, fp);
      renderSong(item, song);
      store?.put(song, fp).catch((err) => {
        console.error('Could not save song', err);
        item.querySelector('.song-meta')!.textContent += ' · not saved';
      });
    } catch (err) {
      console.error(err);
      renderSongStatus(item, name, 'Could not read this file', true);
    } finally {
      busy--;
      updateControls();
    }
  }
}

function showResult({ result, song }: Identification, offsetLabel = 'Clip starts at'): void {
  resultBox.hidden = false;
  resultBox.replaceChildren();
  const title = document.createElement('p');
  title.className = 'result-title';
  const detail = document.createElement('p');
  detail.className = 'result-detail';
  if (song) {
    resultBox.className = 'result result-match';
    title.textContent = song.name;
    detail.textContent = `${offsetLabel} ${formatTime(result.offsetSec)} · ${Math.round(result.confidence * 100)}% confidence`;
  } else {
    resultBox.className = 'result result-none';
    title.textContent = 'No match';
    detail.textContent = 'What it heard doesn’t match any song in your library.';
  }
  const stats = document.createElement('p');
  stats.className = 'result-stats';
  stats.textContent = result.best
    ? `Aligned hits: ${result.best.score} · strongest competitor: ${result.runnerUpScore}`
    : 'No shared hashes with the library.';
  resultBox.append(title, detail, stats);
}

function showMessage(text: string, isError = false): void {
  resultBox.hidden = false;
  resultBox.className = isError ? 'result result-error' : 'result';
  resultBox.replaceChildren(Object.assign(document.createElement('p'), { textContent: text }));
}

async function identify(): Promise<void> {
  const file = clipInput.files?.[0];
  if (!file) return;
  const start = Number(clipStart.value) || 0;
  const length = Number(clipLength.value) || 10;
  identifying = true;
  resultBox.hidden = true;
  updateControls();
  try {
    const { pcm, durationSec } = await decodeFile(file);
    if (start >= durationSec) {
      showMessage(`Start is past the end of the file (${formatTime(durationSec)}).`, true);
      return;
    }
    const fp = await worker.fingerprint(excerpt(pcm, start, length));
    showResult(library.identify(fp));
  } catch (err) {
    console.error(err);
    showMessage('Could not read this file.', true);
  } finally {
    identifying = false;
    updateControls();
  }
}

function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'Microphone access was blocked. Allow it in your browser’s site settings and try again.';
  if (name === 'NotFoundError') return 'No microphone was found.';
  if (name === 'NotReadableError') return 'The microphone is in use by another app.';
  return 'Could not start the microphone.';
}

/** Resolves true once `rec` has `sec` seconds of audio, or false if listening was stopped first. */
function recorded(rec: MicRecorder, sec: number): Promise<boolean> {
  return new Promise((resolve) => {
    const poll = () => {
      if (recorder !== rec) resolve(false);
      else if (rec.durationSec >= sec) resolve(true);
      else setTimeout(poll, 100);
    };
    poll();
  });
}

function drawLevel(rec: MicRecorder): void {
  if (recorder !== rec) return;
  logoButton.style.setProperty('--level', rec.level.toFixed(3));
  logoStatus.textContent = listeningText(rec);
  requestAnimationFrame(() => drawLevel(rec));
}

function stopListening(): void {
  recorder?.stop();
  recorder = null;
  logoButton.style.setProperty('--level', '0');
  updateControls();
}

/**
 * Records from the mic and re-matches everything heard so far every few seconds.
 * Stops early once two checks in a row agree on the same song (one lucky match
 * on a short clip isn't trusted); otherwise gives the final verdict at LISTEN_MAX_SEC.
 */
async function listen(): Promise<void> {
  resultBox.hidden = true;
  let rec: MicRecorder;
  try {
    rec = await MicRecorder.start();
  } catch (err) {
    console.error(err);
    showMessage(micErrorMessage(err), true);
    return;
  }
  recorder = rec;
  updateControls();
  drawLevel(rec);

  let checkAt = LISTEN_FIRST_CHECK_SEC;
  let previousSongId: number | null = null;
  try {
    while (await recorded(rec, checkAt)) {
      const fp = await worker.fingerprint(rec.samples(), rec.sampleRate);
      if (recorder !== rec) return;
      const id = library.identify(fp);
      const last = checkAt >= LISTEN_MAX_SEC;
      if (last || (id.song && id.song.id === previousSongId)) {
        showResult(id, 'You started listening at');
        return;
      }
      previousSongId = id.song?.id ?? null;
      checkAt = Math.min(LISTEN_MAX_SEC, checkAt + LISTEN_CHECK_EVERY_SEC);
    }
  } catch (err) {
    console.error(err);
    showMessage('Something went wrong while listening.', true);
  } finally {
    if (recorder === rec) stopListening();
  }
}

logoButton.addEventListener('click', () => {
  if (recorder) stopListening();
  else void listen();
});

songInput.addEventListener('change', () => {
  void addSongs([...(songInput.files ?? [])]);
  songInput.value = '';
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drop-active');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drop-active'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drop-active');
  void addSongs([...(e.dataTransfer?.files ?? [])]);
});

identifyForm.addEventListener('submit', (e) => {
  e.preventDefault();
  void identify();
});

/** Loads the saved library. Identify stays disabled until it's in. */
async function loadLibrary(): Promise<void> {
  busy++;
  loadingLibrary = true;
  libraryEmpty.textContent = 'Loading your library…';
  updateControls();
  try {
    store = await SongStore.open();
    for (const { hashes, times, ...song } of await store.getAll()) {
      library.restore(song, { hashes, times });
      const item = document.createElement('li');
      renderSong(item, song);
      songList.append(item);
    }
  } catch (err) {
    console.error('Library storage unavailable', err);
    storageNote.hidden = false;
  } finally {
    libraryEmpty.textContent = 'No songs yet.';
    loadingLibrary = false;
    busy--;
    updateControls();
  }
}

void loadLibrary();

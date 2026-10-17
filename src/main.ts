import './style.css';
import { decodeFile, excerpt } from './audio/decode';
import { Library, type Identification, type Song } from './library';
import { FingerprintWorker } from './worker/client';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const dropZone = $<HTMLLabelElement>('drop-zone');
const songInput = $<HTMLInputElement>('song-input');
const songList = $<HTMLUListElement>('song-list');
const libraryEmpty = $<HTMLParagraphElement>('library-empty');
const identifyForm = $<HTMLFormElement>('identify-form');
const clipInput = $<HTMLInputElement>('clip-input');
const clipStart = $<HTMLInputElement>('clip-start');
const clipLength = $<HTMLInputElement>('clip-length');
const identifyButton = $<HTMLButtonElement>('identify-button');
const resultBox = $<HTMLDivElement>('result');

const library = new Library();
const worker = new FingerprintWorker();
/** Songs still being decoded/fingerprinted, so Identify waits for them. */
let busy = 0;

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function updateControls(): void {
  libraryEmpty.hidden = songList.children.length > 0;
  identifyButton.disabled = library.size === 0 || busy > 0;
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
      renderSong(item, library.add(name, durationSec, fp));
    } catch (err) {
      console.error(err);
      renderSongStatus(item, name, 'Could not read this file', true);
    } finally {
      busy--;
      updateControls();
    }
  }
}

function showResult({ result, song }: Identification): void {
  resultBox.hidden = false;
  resultBox.replaceChildren();
  const title = document.createElement('p');
  title.className = 'result-title';
  const detail = document.createElement('p');
  detail.className = 'result-detail';
  if (song) {
    resultBox.className = 'result result-match';
    title.textContent = song.name;
    detail.textContent = `Clip starts at ${formatTime(result.offsetSec)} · ${Math.round(result.confidence * 100)}% confidence`;
  } else {
    resultBox.className = 'result result-none';
    title.textContent = 'No match';
    detail.textContent = 'This clip doesn’t match any song in your library.';
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
  identifyButton.disabled = true;
  showMessage('Listening…');
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
    updateControls();
  }
}

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

updateControls();

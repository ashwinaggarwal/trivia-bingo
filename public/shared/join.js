// A single universal join flow for every digital engine — enter a name and
// a game code, land straight in that game's player view, already
// registered. Reuses the exact "join once" localStorage trick each
// engine's own player app.js already honors (see each engine's
// storageKey()): writing `<prefix>_<gameId>_playerId` before navigating
// resumes straight into the game instead of showing its own join form.
const STORAGE_PREFIX = {
  tambola: 'tambola',
  'trivia-bingo': 'bingo',
  'fastest-finger': 'fastestfinger',
  'emoji-quiz': 'emojiquiz',
  'guess-the-number': 'guessnum',
  'party-night': 'partynight',
};

const form = document.getElementById('join-form');
const nameInput = document.getElementById('name-input');
const codeInput = document.getElementById('code-input');
const submitBtn = document.getElementById('join-submit');
const errorEl = document.getElementById('join-error');

form.addEventListener('submit', handleSubmit);

async function handleSubmit(event) {
  event.preventDefault();
  errorEl.textContent = '';

  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  if (!name || !code) return;

  submitBtn.disabled = true;
  try {
    const game = await lookupGame(code);
    const prefix = STORAGE_PREFIX[game.engine];
    if (!prefix) throw new Error("That game can't be joined from here.");
    if (game.engine === 'tambola' && game.config && game.config.mode === 'physical') {
      throw new Error(
        'This Tambola game uses physical tickets — grab a paper ticket instead of joining here.'
      );
    }

    const player = await registerPlayer(code, name);
    try {
      localStorage.setItem(`${prefix}_${code}_playerId`, player.id);
    } catch (err) {
      // if storage is blocked, the game's own player view falls back to
      // its own registration form — a harmless re-entry of the same name.
    }
    window.location.href = `/play/${game.engine}/player/${code}`;
  } catch (err) {
    errorEl.textContent = err.message;
    submitBtn.disabled = false;
  }
}

async function lookupGame(code) {
  const res = await fetch(`/api/games/${code}`);
  if (!res.ok) throw new Error('Game not found — check the code and try again.');
  return res.json();
}

async function registerPlayer(code, name) {
  const res = await fetch(`/api/games/${code}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not join that game.');
  return data;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function engineCard(engine) {
  const a = document.createElement('a');
  a.className = 'shelf-card';
  a.href = `/play/${engine.slug}`;
  a.innerHTML = `
    <span class="shelf-card-emoji">${engine.emoji}</span>
    <span class="shelf-card-title h-display">${escapeHtml(engine.title)}</span>
    <span class="shelf-card-tagline">${escapeHtml(engine.tagline || '')}</span>
  `;
  return a;
}

async function loadShelf() {
  const res = await fetch('/api/engines');
  const engineList = await res.json();
  const grid = document.getElementById('shelf-grid');
  grid.innerHTML = '';
  engineList.forEach((engine) => grid.appendChild(engineCard(engine)));
}

loadShelf();

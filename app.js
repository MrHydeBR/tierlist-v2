const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const DEFAULT_TIERS = [
  { id: 'tier-s', label: 'S', color: '#ff4d6d' },
  { id: 'tier-a', label: 'A', color: '#ff8c42' },
  { id: 'tier-b', label: 'B', color: '#ffd93d' },
  { id: 'tier-c', label: 'C', color: '#8bd17c' },
  { id: 'tier-d', label: 'D', color: '#4ea3ff' },
];

const state = { songs: {} };

document.addEventListener('DOMContentLoaded', () => {
  initTiers();
  initEventListeners();
  initDragAndDrop();
});

function initTiers() {
  const board = $('#tierBoard');
  if (!board) return;
  board.innerHTML = '';
  DEFAULT_TIERS.forEach(tier => {
    const row = document.createElement('div');
    row.className = 'tier-row';
    row.innerHTML = `
      <div class="tier-label" style="background-color: ${tier.color}">${tier.label}</div>
      <div class="tier-drop" id="${tier.id}"></div>
    `;
    board.appendChild(row);
  });
}

function initEventListeners() {
  $('#btnLoadPlaylist').onclick = () => {
    const url = $('#playlistUrl').value.trim();
    if (url) loadPlaylist(url);
    else showToast('Por favor, cole um link do Spotify');
  };

  $('#playlistUrl').onkeypress = (e) => {
    if (e.key === 'Enter') $('#btnLoadPlaylist').click();
  };

  $('#btnReset').onclick = () => {
    if (confirm('Deseja realmente limpar toda a sua Tier List?')) {
      location.reload();
    }
  };
}

function initDragAndDrop() {
  const containers = [...$$('.tier-drop'), $('#pool')];
  containers.forEach(el => {
    if (!el) return;
    new Sortable(el, {
      group: 'shared',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: updatePoolCount,
    });
  });
}

function updatePoolCount() {
  $('#poolCount').textContent = $('#pool').querySelectorAll('.song').length;
}

async function loadPlaylist(playlistUrl) {
  const container = $('#loadingContainer');
  const bar = $('#loadingProgress');
  const status = $('#loadingStatus');
  const btn = $('#btnLoadPlaylist');

  try {
    btn.disabled = true;
    container.hidden = false;
    status.textContent = 'Conectando ao Spotify...';
    bar.style.width = '10%';
    $('#emptyState').hidden = true;

    const response = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: playlistUrl }),
    });

    if (!response.ok) throw new Error('Erro ao conectar com o servidor');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let count = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);

          if (data.status) {
            if (data.status === 'connected') status.textContent = 'Conexão estabelecida!';
            if (data.status === 'searching') status.textContent = 'Importando músicas...';
            continue;
          }

          if (data.error) throw new Error(data.error);

          if (data.id && !state.songs[data.id]) {
            state.songs[data.id] = data;
            addSongToPool(data);
            count++;
            bar.style.width = Math.min(count * 0.5 + 10, 95) + '%';
            status.textContent = `Carregadas ${count} músicas...`;
            $('#poolCount').textContent = count;
          }
        } catch (e) {
          if (e.message && !e.message.startsWith('Unexpected')) {
            throw e;
          }
        }
      }
    }

    bar.style.width = '100%';
    status.textContent = `Pronto! ${count} músicas importadas.`;
    setTimeout(() => { container.hidden = true; }, 2500);

  } catch (err) {
    showToast('Erro: ' + err.message);
    status.textContent = 'Falha ao carregar.';
  } finally {
    btn.disabled = false;
  }
}

function addSongToPool(track) {
  const pool = $('#pool');
  if (!pool) return;

  const card = document.createElement('div');
  card.className = 'song';
  card.dataset.id = track.id;
  card.innerHTML = `
    <img src="${track.cover || ''}" alt="${escapeHtml(track.title)}" loading="lazy">
    <div class="tooltip">
      <div class="title">${escapeHtml(track.title)}</div>
      <div class="artist">${escapeHtml(track.artist)}</div>
    </div>
  `;
  pool.appendChild(card);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  const toast = $('#toast');
  if (!toast) { alert(msg); return; }
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 3500);
}

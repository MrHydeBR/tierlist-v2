/* =========================================================
   Music Tier List · Spotify
   Client-only app: OAuth PKCE + SortableJS + html2canvas
   No localStorage used — sessionStorage for ephemeral PKCE,
   URL hash carries sharable state.
   ========================================================= */

const TIERS = [
  { id: 'S', color: 'var(--tier-s)' },
  { id: 'A', color: 'var(--tier-a)' },
  { id: 'B', color: 'var(--tier-b)' },
  { id: 'C', color: 'var(--tier-c)' },
  { id: 'D', color: 'var(--tier-d)' },
  { id: 'F', color: 'var(--tier-f)' },
];

const DEFAULT_STYLES = [
  { id: 's-rock',    name: 'Rock',    color: '#ef4444' },
  { id: 's-grunge',  name: 'Grunge',  color: '#78716c' },
  { id: 's-pop',     name: 'Pop',     color: '#ec4899' },
  { id: 's-festa',   name: 'Festa',   color: '#f59e0b' },
  { id: 's-relax',   name: 'Relax',   color: '#10b981' },
  { id: 's-classic', name: 'Classic', color: '#8b5cf6' },
];

/* --- State (in-memory only; serialized into URL for sharing) --- */
const state = {
  songs: {},            // id -> { id, title, artist, cover, style }
  tiers: Object.fromEntries(TIERS.map(t => [t.id, []])),  // tier -> [songId]
  pool: [],             // [songId]
  styles: DEFAULT_STYLES.slice(),
  filter: null,         // styleId | null
  playlist: null,       // { id, name, owner, tracks }
};



/* ---------------- Utilities ---------------- */
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function uid(prefix = 'id') { return prefix + '-' + Math.random().toString(36).slice(2, 10); }
function toast(msg, ms) {
  if (ms == null) ms = 2200;
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function extractPlaylistId(input) {
  if (!input) return null;
  input = input.trim();
  // URL
  const m = input.match(/playlist[/:]([a-zA-Z0-9]+)/);
  if (m) return m[1];
  // Plain ID
  if (/^[a-zA-Z0-9]{10,}$/.test(input)) return input;
  return null;
}

async function loadPlaylist(playlistUrl) {
  const container = $('#loadingContainer');
  const bar = $('#loadingProgress');
  const status = $('#loadingStatus');
  const playlistMeta = $('#playlistMeta');

  try {
    container.hidden = false;
    playlistMeta.hidden = true;
    bar.style.width = '0%';
    status.textContent = 'Conectando ao robô de busca...';
    
    // Reset state for new playlist
    state.playlist = { id: 'scraped', name: 'Importando Playlist...', owner: 'Spotify', cover: '', count: 0 };
    state.songs = {};
    state.tiers = Object.fromEntries(TIERS.map(t => [t.id, []]));
    state.pool = [];
    state.filter = null;
    renderAll();

    const response = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: playlistUrl })
    });

    if (!response.ok) throw new Error('Falha na conexão com o servidor.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let count = 0;
    let buffer = ''; // Buffer para lidar com linhas cortadas

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Guarda a última linha (que pode estar incompleta) no buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const track = JSON.parse(line);
          if (track.error) throw new Error(track.error);
          if (track.status) {
            console.log("Server status:", track.status);
            if (track.status === 'loading_page') status.textContent = 'Spotify aberto! Carregando página...';
            if (track.status === 'searching') status.textContent = 'Pronto! Começando a buscar as músicas...';
            continue;
          }

          if (!state.songs[track.id]) {
            state.songs[track.id] = { ...track, style: null };
            state.pool.push(track.id);
            count++;
            
            state.playlist.count = count;
            bar.style.width = Math.min(count, 100) + '%';
            status.textContent = `Carregando: ${count} músicas encontradas...`;
            
            updatePlaylistMeta();
            renderPool(); 
          }
        } catch (e) { console.error("Erro no chunk:", e); }
      }
    }
    
    bar.style.width = '100%';
    status.textContent = 'Carregamento concluído!';
    renderAll();
    toast(`${count} músicas carregadas com sucesso! 🎵`);
    
    setTimeout(() => { container.hidden = true; }, 1500);
  } catch (e) {
    console.error(e);
    container.hidden = true;
    toast(e.message || 'Erro ao carregar playlist');
  }
}

/* ---------------- Demo data ---------------- */
function loadDemo() {
  const demo = [
    ['demo-1', 'Smells Like Teen Spirit', 'Nirvana', 's-grunge'],
    ['demo-2', 'Black Hole Sun', 'Soundgarden', 's-grunge'],
    ['demo-3', 'Bohemian Rhapsody', 'Queen', 's-classic'],
    ['demo-4', 'Billie Jean', 'Michael Jackson', 's-pop'],
    ['demo-5', 'Sweet Child O\' Mine', 'Guns N\' Roses', 's-rock'],
    ['demo-6', 'Blinding Lights', 'The Weeknd', 's-pop'],
    ['demo-7', 'Clair de Lune', 'Debussy', 's-classic'],
    ['demo-8', 'One Dance', 'Drake', 's-festa'],
    ['demo-9', 'Weightless', 'Marconi Union', 's-relax'],
    ['demo-10', 'Wonderwall', 'Oasis', 's-rock'],
    ['demo-11', 'Levitating', 'Dua Lipa', 's-festa'],
    ['demo-12', 'Hotel California', 'Eagles', 's-rock'],
  ];
  state.songs = {};
  state.tiers = Object.fromEntries(TIERS.map(t => [t.id, []]));
  state.pool = [];
  for (const [id, title, artist, style] of demo) {
    state.songs[id] = { id, title, artist, cover: null, style };
    state.pool.push(id);
  }
  state.filter = null;
  state.playlist = { id: 'demo', name: 'Playlist de Exemplo', owner: 'Demo', cover: null, count: demo.length };
  updatePlaylistMeta();
  renderAll();
  toast('Modo demo carregado');
}

/* ---------------- Bruno Ballada JSON ---------------- */

/* ---------------- Rendering ---------------- */
function renderAll() {
  renderStyleChips();
  renderTierBoard();
  renderPool();
}

function renderStyleChips() {
  const root = $('#filterStyles');
  root.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'style-chip' + (state.filter === null ? ' active' : '');
  all.innerHTML = `<span class="dot"></span>Todos`;
  all.onclick = () => { state.filter = null; renderAll(); };
  root.appendChild(all);
  for (const s of state.styles) {
    const chip = document.createElement('button');
    chip.className = 'style-chip' + (state.filter === s.id ? ' active' : '');
    chip.style.setProperty('--chip-color', s.color);
    chip.innerHTML = `<span class="dot"></span>${s.name}`;
    chip.onclick = () => { state.filter = state.filter === s.id ? null : s.id; renderAll(); };
    root.appendChild(chip);
  }
}

function renderTierBoard() {
  const board = $('#tierBoard');
  board.innerHTML = '';
  for (const t of TIERS) {
    const row = document.createElement('div');
    row.className = 'tier-row';
    row.style.setProperty('--tier-color', t.color);

    const label = document.createElement('div');
    label.className = 'tier-label';
    label.textContent = t.id;
    row.appendChild(label);

    const drop = document.createElement('div');
    drop.className = 'tier-drop';
    drop.dataset.tier = t.id;
    drop.dataset.testid = 'tier-' + t.id;

    for (const songId of state.tiers[t.id]) {
      const song = state.songs[songId];
      if (!song) continue;
      if (state.filter && song.style !== state.filter) continue;
      drop.appendChild(renderSongCard(song));
    }
    row.appendChild(drop);
    board.appendChild(row);

    makeSortable(drop, t.id);
  }
}

function renderPool() {
  const pool = $('#pool');
  pool.innerHTML = '';
  const visible = state.pool.filter(id => {
    const s = state.songs[id];
    return s && (!state.filter || s.style === state.filter);
  });

  const total = Object.keys(state.songs).length;
  $('#poolCount').textContent = state.filter
    ? `${visible.length} visíveis · ${state.pool.length} / ${total} no pool`
    : `${state.pool.length} / ${total}`;

  if (state.pool.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <p>Cole o link de qualquer playlist do Spotify aberta ao público para raspar instantaneamente ou experimente dados de exemplo abaixo.</p>
      <button class="btn-ghost" id="btnLoadDemo">Carregar Tierlist de Exemplo</button>
    `;
    pool.appendChild(empty);
    $('#btnLoadDemo').onclick = loadDemo;
  } else {
    for (const id of visible) {
      pool.appendChild(renderSongCard(state.songs[id]));
    }
  }
  makeSortable(pool, '__pool__');
}

function renderSongCard(song) {
  const el = document.createElement('div');
  el.className = 'song';
  el.dataset.songId = song.id;
  el.dataset.testid = 'song-' + song.id;

  // Cover
  if (song.cover) {
    const img = document.createElement('img');
    img.src = song.cover;
    img.alt = song.title;
    img.loading = 'lazy';
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    el.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'placeholder';
    ph.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
    el.appendChild(ph);
  }

  // Style indicator
  if (song.style) {
    const styleObj = state.styles.find(s => s.id === song.style);
    if (styleObj) {
      const dot = document.createElement('span');
      dot.className = 'style-indicator';
      dot.style.setProperty('--chip-color', styleObj.color);
      el.appendChild(dot);
    }
  }

  // Details overlay
  const info = document.createElement('div');
  info.className = 'song-info';
  info.innerHTML = `
    <div class="song-title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
    <div class="song-artist" title="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</div>
  `;
  el.appendChild(info);

  // Tooltip (keeping as backup for full text)
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.innerHTML = `<div class="title">${escapeHtml(song.title)}</div><div class="artist">${escapeHtml(song.artist)}</div>`;
  el.appendChild(tip);

  // Menu button
  const menuBtn = document.createElement('button');
  menuBtn.className = 'song-menu-btn';
  menuBtn.textContent = '⋯';
  menuBtn.setAttribute('aria-label', 'Opções');
  menuBtn.onclick = (ev) => {
    ev.stopPropagation();
    openSongPopover(song, el);
  };
  el.appendChild(menuBtn);

  return el;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- Song popover ---------------- */
let activePopover = null;
function openSongPopover(song, anchor) {
  if (activePopover) { activePopover.remove(); activePopover = null; }
  const pop = document.createElement('div');
  pop.className = 'song-popover';
  pop.innerHTML = `
    <div class="sec-label">Estilo</div>
    <select id="popStyle">
      <option value="">— sem estilo —</option>
      ${state.styles.map(s => `<option value="${s.id}" ${song.style === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
    </select>
    <div style="height:6px"></div>
    <button class="danger" id="popRemove">Remover música</button>
  `;
  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  const top = rect.bottom + window.scrollY + 4;
  let left = rect.left + window.scrollX;
  const popWidth = 200;
  if (left + popWidth > window.innerWidth - 8) left = window.innerWidth - popWidth - 8;
  pop.style.top = top + 'px';
  pop.style.left = left + 'px';
  activePopover = pop;

  $('#popStyle', pop).onchange = (e) => {
    song.style = e.target.value || null;
    renderAll();
    pop.remove(); activePopover = null;
  };
  $('#popRemove', pop).onclick = () => {
    delete state.songs[song.id];
    for (const tier of Object.values(state.tiers)) {
      const i = tier.indexOf(song.id);
      if (i >= 0) tier.splice(i, 1);
    }
    const i = state.pool.indexOf(song.id);
    if (i >= 0) state.pool.splice(i, 1);
    renderAll();
    pop.remove(); activePopover = null;
  };

  setTimeout(() => {
    document.addEventListener('click', closePop, { once: true });
  }, 0);
  function closePop(ev) {
    if (!pop.contains(ev.target)) { pop.remove(); activePopover = null; }
    else { document.addEventListener('click', closePop, { once: true }); }
  }
}

/* ---------------- Drag & drop ---------------- */
function makeSortable(el, tierId) {
  if (el._sortable) el._sortable.destroy();
  el._sortable = Sortable.create(el, {
    group: 'songs',
    animation: 180,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    filter: '.song-menu-btn',
    preventOnFilter: false,
    onEnd: () => syncFromDom(),
  });
}

function syncFromDom() {
  // Rebuild tiers and pool from current DOM order
  const newTiers = Object.fromEntries(TIERS.map(t => [t.id, []]));
  for (const t of TIERS) {
    const el = document.querySelector(`.tier-drop[data-tier="${t.id}"]`);
    if (!el) continue;
    for (const card of $$('.song', el)) {
      newTiers[t.id].push(card.dataset.songId);
    }
  }
  const poolEl = $('#pool');
  const poolCurrent = $$('.song', poolEl).map(c => c.dataset.songId);

  // Preserve songs currently filtered out (not visible in DOM)
  // by keeping them in their previous containers
  const visibleIds = new Set([
    ...poolCurrent,
    ...Object.values(newTiers).flat(),
  ]);
  const hiddenFromTiers = {};
  const hiddenPool = [];
  for (const t of TIERS) {
    hiddenFromTiers[t.id] = state.tiers[t.id].filter(id => !visibleIds.has(id));
  }
  for (const id of state.pool) if (!visibleIds.has(id)) hiddenPool.push(id);

  state.tiers = Object.fromEntries(TIERS.map(t => [t.id, [...hiddenFromTiers[t.id], ...newTiers[t.id]]]));
  state.pool = [...hiddenPool, ...poolCurrent];
  updateCounts();
}

function updateCounts() {
  const total = Object.keys(state.songs).length;
  const unranked = state.pool.length;
  $('#poolCount').textContent = `${unranked} / ${total}`;
}

/* ---------------- Playlist meta ---------------- */
function updatePlaylistMeta() {
  const meta = $('#playlistMeta');
  if (!state.playlist) { meta.hidden = true; return; }
  meta.hidden = false;
  const img = $('#playlistCover');
  if (state.playlist.cover) { img.src = state.playlist.cover; img.style.display = 'block'; }
  else img.style.display = 'none';
  $('#playlistName').textContent = state.playlist.name;
  $('#playlistSub').textContent = `${state.playlist.count} músicas · ${state.playlist.owner || ''}`;
}

/* ---------------- Styles modal ---------------- */
function openStylesModal() {
  const list = $('#stylesList');
  list.innerHTML = '';
  for (const s of state.styles) {
    const row = document.createElement('div');
    row.className = 'style-row';
    row.innerHTML = `
      <input type="color" value="${s.color}" />
      <input type="text" value="${escapeHtml(s.name)}" maxlength="24" />
      <button class="btn-icon" aria-label="Remover">✕</button>
    `;
    const [color, name, del] = row.children;
    color.oninput = (e) => { s.color = e.target.value; };
    name.oninput = (e) => { s.name = e.target.value; };
    del.onclick = () => {
      state.styles = state.styles.filter(x => x.id !== s.id);
      // Clear style from songs that used it
      for (const sg of Object.values(state.songs)) if (sg.style === s.id) sg.style = null;
      if (state.filter === s.id) state.filter = null;
      openStylesModal();
    };
    list.appendChild(row);
  }
  $('#stylesModal').hidden = false;
}
function closeStylesModal() {
  $('#stylesModal').hidden = true;
  renderAll();
}

/* ---------------- Share & export ---------------- */
function serializeState() {
  const compact = {
    s: state.styles.map(x => [x.id, x.name, x.color]),
    t: Object.fromEntries(TIERS.map(t => [t.id, state.tiers[t.id]])),
    p: state.pool,
    m: Object.values(state.songs).map(s => [s.id, s.title, s.artist, s.cover || '', s.style || '']),
    pl: state.playlist ? [state.playlist.id, state.playlist.name, state.playlist.owner || '', state.playlist.cover || ''] : null,
  };
  const json = JSON.stringify(compact);
  return btoa(unescape(encodeURIComponent(json))); // base64
}

function deserializeState(b64) {
  try {
    const json = decodeURIComponent(escape(atob(b64)));
    const c = JSON.parse(json);
    state.styles = c.s.map(([id, name, color]) => ({ id, name, color }));
    state.tiers = Object.fromEntries(TIERS.map(t => [t.id, c.t[t.id] || []]));
    state.pool = c.p || [];
    state.songs = {};
    for (const [id, title, artist, cover, style] of c.m || []) {
      state.songs[id] = { id, title, artist, cover: cover || null, style: style || null };
    }
    if (c.pl) {
      state.playlist = { id: c.pl[0], name: c.pl[1], owner: c.pl[2], cover: c.pl[3], count: (c.m || []).length };
    }
    updatePlaylistMeta();
    renderAll();
    return true;
  } catch (e) {
    console.error('Bad share URL', e);
    return false;
  }
}

async function shareTierList() {
  const b64 = serializeState();
  const url = new URL(window.location.href);
  url.hash = 'share=' + b64;
  try {
    await navigator.clipboard.writeText(url.toString());
    toast('Link copiado — compartilhe com quem quiser');
  } catch {
    window.prompt('Copie o link:', url.toString());
  }
}

async function exportPng() {
  toast('Gerando imagem…');
  // Hide empty state and tooltips during capture
  const board = $('#tierBoard');
  const clone = board.cloneNode(true);
  // Build a capture container with title + board
  const cap = document.createElement('div');
  cap.style.position = 'fixed';
  cap.style.left = '-99999px';
  cap.style.top = '0';
  cap.style.padding = '32px';
  cap.style.background = getComputedStyle(document.body).backgroundColor;
  cap.style.width = board.offsetWidth + 'px';

  const title = document.createElement('div');
  title.style.fontFamily = getComputedStyle(document.body).fontFamily;
  title.style.fontSize = '24px';
  title.style.fontWeight = '700';
  title.style.color = getComputedStyle(document.body).color;
  title.style.marginBottom = '16px';
  title.textContent = state.playlist ? `Tier List · ${state.playlist.name}` : 'Music Tier List';
  cap.appendChild(title);
  cap.appendChild(clone);
  document.body.appendChild(cap);

  try {
    const canvas = await html2canvas(cap, {
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
    });
    const link = document.createElement('a');
    const safe = (state.playlist?.name || 'tier-list').replace(/[^\w]+/g, '-').toLowerCase();
    link.download = `${safe}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('Imagem exportada');
  } catch (e) {
    console.error(e);
    toast('Erro ao exportar imagem');
  } finally {
    cap.remove();
  }
}

/* ---------------- Theme ---------------- */
(function initTheme() {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  let theme = prefersDark ? 'dark' : 'dark'; // default to dark regardless; Spotify-feel
  root.setAttribute('data-theme', theme);
  const btn = $('#btnTheme');
  function updateIcon() {
    btn.innerHTML = theme === 'dark'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }
  updateIcon();
  btn.onclick = () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    updateIcon();
  };
})();

/* ---------------- Event wiring ---------------- */
async function init() {
  $('#btnLoadPlaylist').onclick = () => {
    const val = $('#playlistUrl').value.trim();
    if (!val) return toast('Cole a URL da playlist');
    loadPlaylist(val);
  };
  $('#playlistUrl').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btnLoadPlaylist').click();
  });

  $('#btnShare').onclick = shareTierList;
  $('#btnExport').onclick = exportPng;
  $('#btnReset').onclick = () => {
    if (!confirm('Mover todas as músicas de volta para o pool?')) return;
    const all = [...Object.values(state.tiers).flat(), ...state.pool];
    state.tiers = Object.fromEntries(TIERS.map(t => [t.id, []]));
    state.pool = all;
    renderAll();
  };

  // Styles modal
  $('#btnEditStyles').onclick = openStylesModal;
  $('#btnAddStyle').onclick = () => {
    const palette = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
    const c = palette[state.styles.length % palette.length];
    state.styles.push({ id: uid('s'), name: 'Novo estilo', color: c });
    openStylesModal();
  };
  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-close-modal]')) closeStylesModal();
  });

  // Demo button (delegated because re-rendered)
  document.addEventListener('click', (e) => {
    if (e.target.id === 'btnLoadDemo') loadDemo();
      });

  // Shared state via URL hash
  if (window.location.hash.startsWith('#share=')) {
    const b64 = window.location.hash.slice('#share='.length);
    if (deserializeState(b64)) toast('Tier list compartilhada carregada');
  } else {
    renderAll();
  }
}


init();

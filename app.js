const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const DEFAULT_TIERS = [
  { id: 'tier-s', label: 'S', color: '#ff4d6d' },
  { id: 'tier-a', label: 'A', color: '#ff8c42' },
  { id: 'tier-b', label: 'B', color: '#ffd93d' },
  { id: 'tier-c', label: 'C', color: '#8bd17c' },
  { id: 'tier-d', label: 'D', color: '#4ea3ff' },
];

const state = {
  songs: {},
  theme: localStorage.getItem('theme') || 'dark'
};

// Aplicar tema inicial
document.documentElement.setAttribute('data-theme', state.theme);

// =========================================================
// Spotify PKCE Auth
// =========================================================
const CLIENT_ID = '1088c40fd007430eb1d224267f41c2c6';
const SCOPES = 'playlist-read-private playlist-read-collaborative user-read-email';

function redirectUri() {
  return window.location.origin;
}

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateVerifier() {
  return b64url(crypto.getRandomValues(new Uint8Array(64)));
}

async function generateChallenge(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(hash);
}

async function redirectToSpotify() {
  const verifier = generateVerifier();
  const challenge = await generateChallenge(verifier);
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));

  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('pkce_state', state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });

  window.location.href = 'https://accounts.spotify.com/authorize?' + params;
}

async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returnedState = params.get('state');

  if (!code) return false;

  const storedState = sessionStorage.getItem('pkce_state');
  const verifier = sessionStorage.getItem('pkce_verifier');
  sessionStorage.removeItem('pkce_state');
  sessionStorage.removeItem('pkce_verifier');

  history.replaceState({}, '', '/');

  if (returnedState !== storedState || !verifier) {
    showToast('Erro de autenticação. Tente novamente.');
    return false;
  }

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        client_id: CLIENT_ID,
        code_verifier: verifier,
      }),
    });

    if (!res.ok) throw new Error('Falha ao trocar código por token');

    const data = await res.json();
    localStorage.setItem('spotify_token', data.access_token);
    localStorage.setItem('spotify_token_expiry', Date.now() + data.expires_in * 1000);
    if (data.refresh_token) {
      localStorage.setItem('spotify_refresh_token', data.refresh_token);
    }
    return true;
  } catch (err) {
    showToast('Erro ao autenticar: ' + err.message);
    return false;
  }
}

async function refreshToken() {
  const refreshTk = localStorage.getItem('spotify_refresh_token');
  if (!refreshTk) return null;

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshTk,
        client_id: CLIENT_ID,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    localStorage.setItem('spotify_token', data.access_token);
    localStorage.setItem('spotify_token_expiry', Date.now() + data.expires_in * 1000);
    if (data.refresh_token) {
      localStorage.setItem('spotify_refresh_token', data.refresh_token);
    }
    return data.access_token;
  } catch {
    return null;
  }
}

async function getToken() {
  const token = localStorage.getItem('spotify_token');
  const expiry = parseInt(localStorage.getItem('spotify_token_expiry') || '0');

  if (token && Date.now() < expiry - 60_000) return token;

  return await refreshToken();
}

function logout() {
  localStorage.removeItem('spotify_token');
  localStorage.removeItem('spotify_token_expiry');
  localStorage.removeItem('spotify_refresh_token');
  updateAuthUI();
}

function updateAuthUI() {
  const btn = $('#btnSpotifyAuth');
  if (!btn) return;
  const token = localStorage.getItem('spotify_token');
  const expiry = parseInt(localStorage.getItem('spotify_token_expiry') || '0');
  const loggedIn = token && Date.now() < expiry;

  if (loggedIn) {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg> Desconectar`;
    btn.className = 'btn-ghost';
    btn.onclick = logout;
  } else {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg> Conectar ao Spotify`;
    btn.className = 'btn-primary';
    btn.onclick = redirectToSpotify;
  }
}

// =========================================================
// App
// =========================================================

document.addEventListener('DOMContentLoaded', async () => {
  const authed = await handleCallback();
  initTiers();
  initEventListeners();
  initDragAndDrop();
  updateAuthUI();
  loadStateFromUrl();
  if (authed) showToast('Conectado ao Spotify!');
});

function initTiers() {
  const board = $('#tierBoard');
  if (!board) return;
  board.innerHTML = '';
  DEFAULT_TIERS.forEach(tier => {
    const row = document.createElement('div');
    row.className = 'tier-row';
    row.innerHTML = `
      <div class="tier-label" style="background-color: ${tier.color}" contenteditable="true" spellcheck="false">${tier.label}</div>
      <div class="tier-drop" id="${tier.id}"></div>
    `;
    board.appendChild(row);
  });
}

function initEventListeners() {
  $('#btnLoadPlaylist').onclick = async () => {
    const url = $('#playlistUrl').value.trim();
    if (!url) { showToast('Por favor, cole um link do Spotify'); return; }
    loadPlaylist(url);
  };

  $('#playlistUrl').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btnLoadPlaylist').click();
  });

  $('#btnReset').onclick = () => {
    if (confirm('Deseja realmente limpar toda a sua Tier List?')) {
      window.location.hash = '';
      window.location.reload();
    }
  };

  $('#btnShare')?.addEventListener('click', saveStateToUrl);
  $('#btnExport')?.addEventListener('click', exportAsImage);
  $('#btnThemeToggle')?.addEventListener('click', toggleTheme);
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('theme', state.theme);
}

function saveStateToUrl() {
  const tiers = [];
  $$('.tier-row').forEach(row => {
    const label = row.querySelector('.tier-label').textContent;
    const color = row.querySelector('.tier-label').style.backgroundColor;
    const songIds = Array.from(row.querySelectorAll('.song')).map(s => s.dataset.id);
    tiers.push({ label, color, songIds });
  });

  const poolIds = Array.from($('#pool').querySelectorAll('.song')).map(s => s.dataset.id);
  const data = { tiers, poolIds, songs: state.songs };

  // Encoding base64 simples para a URL
  const encoded = btoa(encodeURIComponent(JSON.stringify(data)));
  window.location.hash = encoded;

  navigator.clipboard.writeText(window.location.href);
  showToast('Link copiado para a área de transferência!');
}

function loadStateFromUrl() {
  const hash = window.location.hash.substring(1);
  if (!hash) return;
  try {
    const data = JSON.parse(decodeURIComponent(atob(hash)));
    if (Object.keys(data.songs).length > 0) $('#emptyState').hidden = true;

    state.songs = data.songs;

    // Rebuild Tiers
    const board = $('#tierBoard');
    board.innerHTML = '';
    data.tiers.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'tier-row';
      row.innerHTML = `
        <div class="tier-label" style="background-color: ${t.color}" contenteditable="true" spellcheck="false">${t.label}</div>
        <div class="tier-drop" id="tier-custom-${i}"></div>
      `;
      board.appendChild(row);
      t.songIds.forEach(id => {
        if (state.songs[id]) addSongToContainer(state.songs[id], row.querySelector('.tier-drop'));
      });
    });

    // Rebuild Pool
    $('#pool').innerHTML = '';
    data.poolIds.forEach(id => {
      if (state.songs[id]) addSongToPool(state.songs[id]);
    });

    updatePoolCount();
    initDragAndDrop();
  } catch (e) {
    console.error('Erro ao carregar estado da URL', e);
  }
}

async function exportAsImage() {
  const board = $('#tierBoard');
  if (!board) return;
  showToast('Gerando imagem...');
  const canvas = await html2canvas(board, {
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--color-bg'),
    scale: 2,
    logging: false,
    useCORS: true
  });
  const link = document.createElement('a');
  link.download = `my-tierlist-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
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

function extractPlaylistId(url) {
  if (url.includes('playlist/')) return url.split('playlist/')[1].split('?')[0];
  if (url.includes('album/')) throw new Error('Link de álbum detectado. Cole um link de playlist do Spotify.');
  if (url.includes('track/')) throw new Error('Link de música detectado. Cole um link de playlist do Spotify.');
  if (/^[A-Za-z0-9]{22}$/.test(url.trim())) return url.trim();
  throw new Error('Link inválido. Cole o link de uma playlist do Spotify (open.spotify.com/playlist/...)');
}

async function loadPlaylist(playlistUrl) {
  const container = $('#loadingContainer');
  const bar = $('#loadingProgress');
  const status = $('#loadingStatus');
  const btn = $('#btnLoadPlaylist');

  try {
    btn.disabled = true;
    container.hidden = false;
    status.textContent = 'Importando músicas...';
    bar.style.width = '10%';
    $('#emptyState').hidden = true;

    const playlistId = extractPlaylistId(playlistUrl);
    const token = await getToken();

    // Sempre tentamos a API Oficial primeiro (via Backend com Client Secret)
    // Isso resolve o erro 403 e permite pegar 100+ músicas
    console.log('Iniciando importação via API Oficial...');
    let res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: playlistUrl, access_token: token || '' }),
    });

    if (!res.ok) {
      console.warn('API Oficial falhou, tentando Scraper de emergência...');
      res = await fetch(`/api/playlist/${playlistId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Erro ${res.status}`);
      }

      // Processamento de JSON único (Scraper fallback)
      const data = await res.json();
      const tracks = data.tracks || [];
      processTracks(tracks);
    } else {
      // Processamento de Stream (NDJSON - API Oficial)
      await processStream(res);
    }

    bar.style.width = '100%';
    status.textContent = 'Pronto! Músicas importadas.';
    setTimeout(() => { container.hidden = true; }, 2500);
  } catch (err) {
    showToast('Erro: ' + err.message);
    status.textContent = 'Falha ao carregar.';
  } finally {
    btn.disabled = false;
  }
}

async function processStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let count = 0;
  const status = $('#loadingStatus');

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
        if (data.error) throw new Error(data.error);
        if (data.status) {
          if (data.status === 'searching') status.textContent = 'Localizando faixas...';
          if (data.status === 'fallback') {
            console.warn('Backend usando modo Scraper. Motivo:', data.reason);
            if (!data.keys_found) {
              showToast('Aviso: API Oficial não configurada. Limite de 100 músicas ativo.', 5000);
            }
          }
          continue;
        }
        if (state.songs[data.id]) continue;
        state.songs[data.id] = data;
        addSongToPool(data);
        count++;
        status.textContent = `Carregadas ${count} músicas...`;
        $('#poolCount').textContent = count;
      } catch (e) {
        console.error('Erro no processamento da linha:', e);
      }
    }
  }
}

function processTracks(tracks) {
  const status = $('#loadingStatus');
  const bar = $('#loadingProgress');
  let count = 0;
  for (const track of tracks) {
    if (state.songs[track.id]) continue;
    state.songs[track.id] = track;
    addSongToPool(track);
    count++;
    bar.style.width = Math.min((count / Math.max(tracks.length, 1)) * 90 + 10, 99) + '%';
    status.textContent = `Carregadas ${count} músicas...`;
    $('#poolCount').textContent = count;
  }
}

function addSongToPool(track) {
  addSongToContainer(track, $('#pool'));
}

function addSongToContainer(track, container) {
  if (!container) return;

  const card = document.createElement('div');
  card.className = 'song';
  card.dataset.id = track.id;

  const img = document.createElement('img');
  // Placeholder de alta qualidade se a capa for vazia
  const placeholder = 'https://community.spotify.com/t5/image/serverpage/image-id/25294i2836511C333E6E85';
  img.src = track.cover || placeholder;
  img.alt = escapeHtml(track.title);
  img.loading = 'lazy';
  // Configuração crítica para html2canvas (PNG Export)
  img.setAttribute('crossorigin', 'anonymous');

  // Fallback se a imagem do Spotify falhar ou for bloqueada
  img.onerror = () => {
    if (img.src !== placeholder) img.src = placeholder;
  };

  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.innerHTML = `
    <div class="title">${escapeHtml(track.title)}</div>
    <div class="artist">${escapeHtml(track.artist)}</div>
  `;

  card.appendChild(img);
  card.appendChild(tooltip);
  container.appendChild(card);
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

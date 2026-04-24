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
      <div class="tier-label" style="background-color: ${tier.color}">${tier.label}</div>
      <div class="tier-drop" id="${tier.id}"></div>
    `;
    board.appendChild(row);
  });
}

function initEventListeners() {
  $('#btnLoadPlaylist').onclick = async () => {
    const url = $('#playlistUrl').value.trim();
    if (!url) { showToast('Por favor, cole um link do Spotify'); return; }

    const token = await getToken();
    if (!token) {
      showToast('Conecte ao Spotify primeiro');
      return;
    }

    loadPlaylist(url, token);
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

function extractPlaylistId(url) {
  if (url.includes('playlist/')) return url.split('playlist/')[1].split('?')[0];
  if (url.includes('album/')) throw new Error('Link de álbum detectado. Cole um link de playlist do Spotify.');
  if (url.includes('track/')) throw new Error('Link de música detectado. Cole um link de playlist do Spotify.');
  if (/^[A-Za-z0-9]{22}$/.test(url.trim())) return url.trim();
  throw new Error('Link inválido. Cole o link de uma playlist do Spotify (open.spotify.com/playlist/...)');
}

async function loadPlaylist(playlistUrl, token) {
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

    // Verify token and log which account is being used
    const meRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!meRes.ok) throw new Error('Token inválido. Faça logout e login novamente.');
    const me = await meRes.json();
    console.log('Autenticado como:', me.display_name, '|', me.email, '| id:', me.id);

    const playlistId = extractPlaylistId(playlistUrl);
    let count = 0;

    const addItems = (items) => {
      for (const item of (items || [])) {
        const track = item?.track;
        if (!track?.id) continue;
        if (state.songs[track.id]) continue;
        const song = {
          id: track.id,
          title: track.name || 'Sem título',
          artist: (track.artists || []).map(a => a.name).join(', ') || 'Desconhecido',
          cover: track.album?.images?.[0]?.url || '',
        };
        state.songs[song.id] = song;
        addSongToPool(song);
        count++;
        bar.style.width = Math.min(count * 0.5 + 10, 95) + '%';
        status.textContent = `Carregadas ${count} músicas...`;
        $('#poolCount').textContent = count;
      }
    };

    // Fetch playlist name for display
    const plRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name,tracks.total`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!plRes.ok) {
      const body = await plRes.json().catch(() => ({}));
      console.error('Playlist error:', JSON.stringify(body));
      throw new Error(`Spotify ${plRes.status}: ${JSON.stringify(body)}`);
    }
    const playlist = await plRes.json();
    console.log('Playlist:', playlist.name, '| total:', playlist.tracks?.total);

    // Fetch tracks via the dedicated /tracks endpoint (supports pagination, market param)
    let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?market=from_token&limit=100`;
    while (nextUrl) {
      const res = await fetch(nextUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error('Tracks error:', JSON.stringify(body));
        throw new Error(`Spotify ${res.status}: ${JSON.stringify(body)}`);
      }
      const data = await res.json();
      console.log('Tracks page: items=', data.items?.length, 'next=', data.next);
      addItems(data.items);
      nextUrl = data.next || null;
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

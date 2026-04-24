import time
import logging
import json
import spotipy
import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
import os

load_dotenv()

CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID")
CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class ScrapeRequest(BaseModel):
    url: str
    access_token: str

def extract_playlist_id(url: str) -> str:
    if "playlist/" in url:
        return url.split("playlist/")[1].split("?")[0]
    return url

def process_item(item):
    if not item:
        return None
    track = item.get('track')
    if not track:
        return None
    track_id = track.get('id') or f"temp-{time.time()}"
    title = track.get('name') or "Sem título"
    artist = ", ".join([a['name'] for a in track.get('artists', [])]) or "Desconhecido"
    cover = ""
    if track.get('album') and track['album'].get('images'):
        cover = track['album']['images'][0]['url']
    return {"id": track_id, "title": title, "artist": artist, "cover": cover}

def scrape_spotify_generator(url: str, access_token: str):
    try:
        yield json.dumps({"status": "connected"}) + "\n"

        playlist_id = extract_playlist_id(url)
        logger.info(f"Acessando playlist: {playlist_id}")

        sp = None
        # Try user token first if provided
        if access_token and access_token.strip():
            sp = spotipy.Spotify(auth=access_token)
            try:
                # Test connection
                sp.me()
            except Exception:
                logger.warning("Token de usuário inválido ou expirado. Tentando Client Credentials...")
                sp = None

        # Fallback to Client Credentials (stable for public playlists)
        if sp is None:
            if not CLIENT_ID or not CLIENT_SECRET:
                yield json.dumps({"error": "Credenciais do Spotify (Client ID/Secret) não configuradas no servidor."}) + "\n"
                return
            
            from spotipy.oauth2 import SpotifyClientCredentials
            auth_manager = SpotifyClientCredentials(client_id=CLIENT_ID, client_secret=CLIENT_SECRET)
            sp = spotipy.Spotify(auth_manager=auth_manager)

        try:
            pl_info = sp.playlist(playlist_id, fields="name,tracks.total")
        except Exception as e_pl:
            logger.error(f"Playlist não encontrada: {e_pl}")
            yield json.dumps({"error": f"Playlist não encontrada ou privada: {str(e_pl)}"}) + "\n"
            return

        name = pl_info.get('name', '?')
        total = pl_info.get('tracks', {}).get('total', '?')
        logger.info(f"Playlist: {name} ({total} músicas)")

        yield json.dumps({"status": "searching"}) + "\n"

        sent_count = 0
        offset = 0
        limit = 100

        while True:
            try:
                page = sp.playlist_items(playlist_id, limit=limit, offset=offset)
            except Exception as e_page:
                logger.error(f"Erro ao buscar página offset={offset}: {e_page}")
                yield json.dumps({"error": str(e_page)}) + "\n"
                return

            items = page.get('items', [])
            logger.info(f"Página offset={offset}: {len(items)} itens")

            if not items:
                break

            for item in items:
                data = process_item(item)
                if data:
                    yield json.dumps(data) + "\n"
                    sent_count += 1
                    time.sleep(0.01)

            if not page.get('next'):
                break
            offset += limit

        logger.info(f"Total enviado: {sent_count}")

    except Exception as e:
        logger.error(f"Erro geral: {e}")
        yield json.dumps({"error": str(e)}) + "\n"

@app.post("/api/scrape")
def api_scrape(req: ScrapeRequest):
    return StreamingResponse(
        scrape_spotify_generator(req.url, req.access_token),
        media_type="application/x-ndjson",
    )

_EMBED_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
}

def _parse_track(item: dict) -> dict | None:
    # Handle new structure (uri, title, subtitle)
    uri = item.get("uri", "")
    track_id = item.get("id") or (uri.split(":")[-1] if ":" in uri else uri)
    if not track_id:
        return None
    
    title = item.get("title") or item.get("name") or "Sem título"
    subtitle = item.get("subtitle") or ""
    artists = item.get("artists") or []
    artist = subtitle or ", ".join(a.get("name", "") for a in artists) or "Desconhecido"
    
    # Cover art (if available)
    cover = item.get("imageUrl") or ""
    if not cover and item.get("album", {}).get("images"):
        cover = item["album"]["images"][0].get("url", "")
    
    # If still no cover, check for 'image' field in new structure
    if not cover and item.get("image"):
        images = item["image"]
        if isinstance(images, list) and len(images) > 0:
            cover = images[0].get("url", "")
            
    return {"id": track_id, "title": title, "artist": artist, "cover": cover}

@app.get("/api/playlist/{playlist_id}")
async def get_playlist(playlist_id: str):
    url = f"https://open.spotify.com/embed/playlist/{playlist_id}"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
            res = await client.get(url, headers=_EMBED_HEADERS)
    except Exception as e:
        raise HTTPException(502, f"Falha ao buscar embed do Spotify: {e}")

    if res.status_code != 200:
        raise HTTPException(res.status_code, f"Spotify embed retornou {res.status_code}")

    soup = BeautifulSoup(res.text, "html.parser")
    # Spotify now uses __NEXT_DATA__ for the JSON payload
    script = soup.find("script", {"id": "resource"}) or soup.find("script", {"id": "__NEXT_DATA__"})

    if not script or not script.string:
        logger.warning("Script de dados não encontrado. HTML preview: %s", res.text[:3000])
        raise HTTPException(404, "Dados da playlist não encontrados no embed do Spotify.")

    try:
        data = json.loads(script.string)
    except json.JSONDecodeError as e:
        raise HTTPException(500, f"Erro ao parsear JSON do embed: {e}")

    # Try different possible locations for the track list
    track_list = None
    playlist_name = ""

    if isinstance(data, dict):
        # 1. Newest structure (__NEXT_DATA__)
        state = data.get("props", {}).get("pageProps", {}).get("state", {})
        entity = state.get("data", {}).get("entity", {})
        if entity:
            track_list = entity.get("trackList")
            playlist_name = entity.get("name") or entity.get("title") or ""
        
        # 2. Previous structure (direct trackList)
        if track_list is None:
            track_list = data.get("trackList")
            playlist_name = data.get("name") or playlist_name
            
        # 3. Alternative structure (data.entity)
        if track_list is None:
            entity = data.get("data", {}).get("entity", {})
            track_list = entity.get("trackList") or entity.get("tracks", {}).get("items")
            playlist_name = entity.get("name") or playlist_name

    if track_list is None:
        logger.warning("Lista de músicas não encontrada. Estrutura: %s", json.dumps(data)[:2000])
        raise HTTPException(404, "Lista de músicas não encontrada nos dados do embed.")

    tracks = [t for item in track_list if (t := _parse_track(item))]
    logger.info("Playlist '%s': %d músicas extraídas", playlist_name, len(tracks))

    return {"name": playlist_name, "tracks": tracks}

app.mount("/", StaticFiles(directory=".", html=True), name="static")

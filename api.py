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

# Configure logging early
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

logger.info(f"DEBUG: CLIENT_ID carregado: {CLIENT_ID is not None}, valor: {CLIENT_ID[:5] if CLIENT_ID else 'None'}")
logger.info(f"DEBUG: CLIENT_SECRET carregado: {CLIENT_SECRET is not None}, valor: {'*****' if CLIENT_SECRET else 'None'}")

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
    
    # Busca robusta pela capa
    cover = None
    album = track.get('album', {})
    # Às vezes as imagens estão no álbum, às vezes na própria track
    images = album.get('images', []) or track.get('images', [])
    
    if images:
        # Tenta pegar a melhor imagem disponível
        for img in images:
            if img.get('url'):
                cover = img['url']
                break
    
    if not cover:
        cover = "" # Fallback para string vazia
        
    return {"id": track_id, "title": title, "artist": artist, "cover": cover}

def scrape_spotify_generator(url: str, access_token: str):
    playlist_id = extract_playlist_id(url)
    
    # --- TENTATIVA 1: API OFICIAL (Estável e com Capas) ---
    try:
        yield json.dumps({"status": "connected", "method": "official"}) + "\n"
        sp = None
        # 1. Tenta usar o token do usuário (se fornecido)
        if access_token and len(str(access_token)) > 20:
            sp = spotipy.Spotify(auth=access_token)
            try:
                sp.me() # Teste rápido de token
            except Exception as e:
                logger.warning(f"Token de usuário falhou ({e}). Tentando Client Credentials...")
                sp = None
        
        # 2. Força Client Credentials se o anterior falhou
        if sp is None and CLIENT_ID and CLIENT_SECRET:
            try:
                from spotipy.oauth2 import SpotifyClientCredentials
                auth_manager = SpotifyClientCredentials(client_id=CLIENT_ID, client_secret=CLIENT_SECRET)
                sp = spotipy.Spotify(auth_manager=auth_manager)
            except Exception as auth_err:
                logger.error(f"Falha no Client Credentials: {auth_err}")
                sp = None

        if sp:
            # Puxa o total e os itens
            pl_info = sp.playlist(playlist_id, fields="name,tracks.total")
            total = pl_info.get('tracks', {}).get('total', 0)
            yield json.dumps({"status": "searching", "total": total}) + "\n"

            offset = 0
            limit = 100
            while True:
                page = sp.playlist_items(playlist_id, limit=limit, offset=offset)
                items = page.get('items', [])
                if not items: break
                
                for item in items:
                    data = process_item(item)
                    if data:
                        yield json.dumps(data) + "\n"
                        time.sleep(0.01)
                
                # Se não há 'next' ou processamos tudo, para
                if not page.get('next') or len(items) < limit: break
                offset += limit
            return # Sucesso total
        else:
            raise Exception("Chaves do Spotify não carregadas ou inválidas")
            yield json.dumps({"status": "fallback", "reason": "Nenhuma autenticação oficial foi bem-sucedida.", "keys_found": bool(CLIENT_ID)}) + "\n"

    except Exception as e:
        logger.exception(f"API Oficial falhou inesperadamente: {e}") 
        yield json.dumps({"status": "fallback", "reason": str(e), "keys_found": bool(CLIENT_ID)}) + "\n"
    
    # --- TENTATIVA 2: SCRAPER DE EMBED (Fallback de Emergência) - Sempre executado se a API oficial não retornar ---
    try:
        playlist_data = get_playlist_sync(playlist_id)
        for track in playlist_data.get("tracks", []):
            yield json.dumps(track) + "\n"
    except Exception as e:
        logger.error(f"Scraper de Embed falhou: {e}")
        yield json.dumps({"error": f"Não foi possível carregar a playlist via scraper: {str(e)}"}) + "\n"

def get_playlist_sync(playlist_id: str):
    """Extração via scraper (embed) caso a API oficial falhe ou não tenha chaves."""
    url = f"https://open.spotify.com/embed/playlist/{playlist_id}"
    res = httpx.get(url, headers=_EMBED_HEADERS, follow_redirects=True, timeout=20.0)
    
    if res.status_code != 200:
        raise Exception(f"Spotify retornou status {res.status_code}")

    soup = BeautifulSoup(res.text, "html.parser")
    script = soup.find("script", {"id": "resource"}) or soup.find("script", {"id": "__NEXT_DATA__"})
    if not script or not script.string:
        raise Exception("Dados da playlist não encontrados no HTML")

    data = json.loads(script.string)
    if "props" in data: # Estrutura moderna __NEXT_DATA__
        entity = data.get("props", {}).get("pageProps", {}).get("state", {}).get("data", {}).get("entity", {})
        track_list = entity.get("trackList") or entity.get("tracks", {}).get("items") or []
    else:
        track_list = data.get("trackList") or []

    return {"tracks": [t for item in track_list if (t := _parse_track(item))]}

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
    
    # Busca exaustiva pela capa no JSON do Embed
    cover = item.get("imageUrl")
    
    # Spotify 2025: Estrutura aninhada em 'image', 'images' ou 'coverArt'
    img_fields = ["image", "images", "coverArt", "album"]
    for field in img_fields:
        if cover: break
        img_data = item.get(field)
        if not img_data: continue
        
        if field == "album" and isinstance(img_data, dict):
            img_data = img_data.get("images", []) # Tenta buscar imagens dentro do objeto 'album'

        if isinstance(img_data, list) and len(img_data) > 0:
            cover = img_data[0].get("url") or img_data[0].get("sources", [{}])[0].get("url")
        elif isinstance(img_data, dict):
            cover = img_data.get("url") or img_data.get("sources", [{}])[0].get("url")

    if not cover and "album" in item:
        imgs = item["album"].get("images", [])
        if imgs: cover = imgs[0].get("url")
            
    return {"id": track_id, "title": title, "artist": artist, "cover": cover or ""}
app.mount("/", StaticFiles(directory=".", html=True), name="static")

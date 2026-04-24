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
    images = album.get('images', [])
    if images:
        # Tenta pegar a imagem de tamanho médio (índice 1) ou a maior (0)
        cover = images[1]['url'] if len(images) > 1 else images[0]['url']
    
    if not cover:
        cover = "" # Fallback para string vazia
        
    return {"id": track_id, "title": title, "artist": artist, "cover": cover}

def scrape_spotify_generator(url: str, access_token: str):
    playlist_id = extract_playlist_id(url)
    
    # --- TENTATIVA 1: API OFICIAL (Estável e com Capas) ---
    try:
        yield json.dumps({"status": "connected", "method": "official"}) + "\n"
        
        # Diagnóstico de chaves (ajuda a descobrir se o .env foi lido)
        if CLIENT_ID and CLIENT_SECRET:
            logger.info(f"API Oficial: Chaves configuradas com sucesso (ID: {CLIENT_ID[:5]}...)")
        else:
            logger.warning("ERRO: SPOTIFY_CLIENT_ID ou SPOTIFY_CLIENT_SECRET ausentes no ambiente!")
        
        sp = None
        # Tenta usar o token do usuário se fornecido
        if access_token and access_token.strip():
            sp = spotipy.Spotify(auth=access_token)
            try:
                sp.me() # Teste rápido de token
            except:
                logger.warning("Token de usuário falhou. Tentando Client Credentials...")
                sp = None
        else:
            logger.info("Nenhum token de usuário fornecido pelo frontend. Tentando Client Credentials...")

        # Fallback para Client Credentials (estável para playlists públicas)
        if sp is None and CLIENT_ID and CLIENT_SECRET:
            from spotipy.oauth2 import SpotifyClientCredentials
            auth_manager = SpotifyClientCredentials(client_id=CLIENT_ID, client_secret=CLIENT_SECRET)
            sp = spotipy.Spotify(auth_manager=auth_manager)
            if sp:
                logger.info("Client Credentials configurado e usado com sucesso.")
            else:
                logger.warning("Client Credentials não configurado (CLIENT_ID/SECRET ausentes) ou falhou na inicialização.")

        if sp:
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
                
                if not page.get('next'): break
                offset += limit
            return # Sucesso com API oficial
        else:
            logger.warning("Nenhuma autenticação (usuário ou Client Credentials) foi bem-sucedida. Caindo para o Scraper.")

    except Exception as e:
        logger.exception(f"API Oficial falhou inesperadamente. Tentando modo Scraper...") # Use logger.exception for traceback
        yield json.dumps({"status": "fallback", "reason": str(e), "keys_found": bool(CLIENT_ID)}) + "\n"

    # --- TENTATIVA 2: SCRAPER DE EMBED (Fallback de Emergência) ---
    try:
        import asyncio
        # O scraper é assíncrono, então usamos um helper para rodar sincronamente
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        playlist_data = loop.run_until_complete(get_playlist(playlist_id))
        loop.close()
        
        for track in playlist_data.get("tracks", []):
            yield json.dumps(track) + "\n"
    except Exception as e:
        logger.error(f"Fallback falhou: {e}")
        yield json.dumps({"error": f"Não foi possível carregar a playlist: {str(e)}"}) + "\n"

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
    
    # Spotify 2024/2025: As imagens agora podem estar em 'image', 'images' ou 'coverArt'
    img_fields = ["image", "images", "coverArt"]
    for field in img_fields:
        if cover: break
        img_data = item.get(field)
        if not img_data: continue
        
        if isinstance(img_data, list) and len(img_data) > 0:
            cover = img_data[0].get("url") or img_data[0].get("sources", [{}])[0].get("url")
        elif isinstance(img_data, dict):
            cover = img_data.get("url") or img_data.get("sources", [{}])[0].get("url")

    if not cover and "album" in item:
        imgs = item["album"].get("images", [])
        if imgs: cover = imgs[0].get("url")
            
    return {"id": track_id, "title": title, "artist": artist, "cover": cover or ""}

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

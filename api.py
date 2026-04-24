import os
import time
import logging
import json
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import StreamingResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET", "")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class ScrapeRequest(BaseModel):
    url: str

def extract_playlist_id(url: str) -> str:
    # Suporta links completos ou apenas o ID
    if "playlist/" in url:
        return url.split("playlist/")[1].split("?")[0]
    return url

def scrape_spotify_generator(url: str):
    try:
        yield json.dumps({"status": "connected"}) + "\n"
        
        playlist_id = extract_playlist_id(url)
        logger.info(f"Tentando acessar playlist: {playlist_id}")
        
        # Conecta na API oficial
        auth_manager = SpotifyClientCredentials(client_id=CLIENT_ID, client_secret=CLIENT_SECRET)
        sp = spotipy.Spotify(auth_manager=auth_manager)
        
        # Tenta pegar informações básicas primeiro
        try:
            pl_info = sp.playlist(playlist_id)
            logger.info(f"Playlist encontrada: {pl_info['name']} ({pl_info['tracks']['total']} músicas)")
        except Exception as e_pl:
            logger.error(f"Erro ao validar playlist: {e_pl}")
            yield json.dumps({"error": f"Playlist não encontrada ou privada: {str(e_pl)}"}) + "\n"
            return
        
        yield json.dumps({"status": "searching"}) + "\n"
        
        # Busca os itens da playlist
        results = sp.playlist_items(playlist_id)
        tracks = results.get('items', [])
        
        logger.info(f"Lote inicial: {len(tracks)} músicas encontradas.")
        
        def process_item(item):
            if not item: return None
            track = item.get('track')
            if not track: return None
            
            # Garante que temos as informações básicas
            track_id = track.get('id') or f"temp-{time.time()}"
            title = track.get('name') or "Sem título"
            artist = ", ".join([a['name'] for a in track.get('artists', [])]) or "Desconhecido"
            
            cover = ""
            if track.get('album') and track['album'].get('images'):
                cover = track['album']['images'][0]['url']

            return {
                "id": track_id,
                "title": title,
                "artist": artist,
                "cover": cover
            }

        # Envia as primeiras músicas
        sent_count = 0
        for item in tracks:
            data = process_item(item)
            if data:
                yield json.dumps(data) + "\n"
                sent_count += 1
                time.sleep(0.02)
        
        logger.info(f"Enviadas {sent_count} músicas iniciais.")

        # Continua buscando se houver mais páginas
        while results.get('next'):
            results = sp.next(results)
            for item in results.get('items', []):
                data = process_item(item)
                if data:
                    yield json.dumps(data) + "\n"
                    sent_count += 1
        
        logger.info(f"Total final enviado: {sent_count}")
        
    except Exception as e:
        logger.error(f"Erro na API Spotify: {e}")
        yield json.dumps({"error": str(e)}) + "\n"

@app.post("/api/scrape")
def api_scrape(req: ScrapeRequest):
    return StreamingResponse(scrape_spotify_generator(req.url), media_type="application/x-ndjson")

app.mount("/", StaticFiles(directory=".", html=True), name="static")

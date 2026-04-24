import time
import logging
import json
import spotipy
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import StreamingResponse

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

        sp = spotipy.Spotify(auth=access_token)

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

app.mount("/", StaticFiles(directory=".", html=True), name="static")

import logging
import json
import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_EMBED_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
}


class ScrapeRequest(BaseModel):
    url: str


def _extract_playlist_id(url: str) -> str:
    if "playlist/" in url:
        return url.split("playlist/")[1].split("?")[0]
    return url.strip()


def _parse_track(item: dict) -> dict | None:
    uri = item.get("uri", "")
    track_id = item.get("id") or (uri.split(":")[-1] if ":" in uri else uri)
    if not track_id:
        return None

    title = item.get("title") or item.get("name") or "Sem título"
    subtitle = item.get("subtitle") or ""
    artists = item.get("artists") or []
    artist = subtitle or ", ".join(a.get("name", "") for a in artists) or "Desconhecido"

    cover = item.get("imageUrl")
    for field in ["image", "images", "coverArt", "album"]:
        if cover:
            break
        img_data = item.get(field)
        if not img_data:
            continue
        if field == "album" and isinstance(img_data, dict):
            img_data = img_data.get("images", [])
        if isinstance(img_data, list) and img_data:
            cover = img_data[0].get("url") or (img_data[0].get("sources") or [{}])[0].get("url")
        elif isinstance(img_data, dict):
            cover = img_data.get("url") or (img_data.get("sources") or [{}])[0].get("url")

    return {"id": track_id, "title": title, "artist": artist, "cover": cover or ""}


def _scrape_embed(playlist_id: str) -> tuple[str, list[dict]]:
    url = f"https://open.spotify.com/embed/playlist/{playlist_id}"
    res = httpx.get(url, headers=_EMBED_HEADERS, follow_redirects=True, timeout=30.0)

    if res.status_code != 200:
        raise Exception(f"Spotify embed retornou {res.status_code}")

    soup = BeautifulSoup(res.text, "html.parser")
    script = soup.find("script", {"id": "resource"}) or soup.find("script", {"id": "__NEXT_DATA__"})

    if not script or not script.string:
        logger.warning("Script de dados não encontrado. HTML (primeiros 3000 chars): %s", res.text[:3000])
        raise Exception("Dados não encontrados no embed do Spotify")

    data = json.loads(script.string)

    # Tenta estrutura __NEXT_DATA__
    entity = (
        data.get("props", {})
        .get("pageProps", {})
        .get("state", {})
        .get("data", {})
        .get("entity", {})
    )
    track_list = entity.get("trackList")

    # Tenta estrutura resource (embed antigo)
    if track_list is None:
        track_list = data.get("trackList")

    if track_list is None:
        entity = data.get("data", {}).get("entity", {})
        track_list = entity.get("trackList") or entity.get("tracks", {}).get("items")

    if track_list is None:
        logger.warning("trackList não encontrado. Estrutura JSON: %s", json.dumps(data)[:3000])
        raise Exception("Lista de músicas não encontrada nos dados do embed")

    playlist_name = (
        entity.get("name")
        or data.get("name")
        or data.get("data", {}).get("entity", {}).get("name")
        or ""
    )
    tracks = [t for item in track_list if (t := _parse_track(item))]
    logger.info("Playlist '%s': %d músicas extraídas", playlist_name, len(tracks))

    return playlist_name, tracks


def _scrape_generator(url: str):
    playlist_id = _extract_playlist_id(url)
    try:
        playlist_name, tracks = _scrape_embed(playlist_id)
        if not tracks:
            yield json.dumps({"error": "Nenhuma música encontrada na playlist"}) + "\n"
            return
        yield json.dumps({"status": "ok", "name": playlist_name, "total": len(tracks)}) + "\n"
        for track in tracks:
            yield json.dumps(track) + "\n"
    except Exception as e:
        logger.error("Scrape falhou: %s", e)
        yield json.dumps({"error": str(e)}) + "\n"


@app.post("/api/scrape")
def api_scrape(req: ScrapeRequest):
    return StreamingResponse(
        _scrape_generator(req.url),
        media_type="application/x-ndjson",
    )


app.mount("/", StaticFiles(directory=".", html=True), name="static")

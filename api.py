import time
import logging
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from playwright.sync_api import sync_playwright

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Add CORS middleware to prevent "Failed to Fetch" due to origin mismatches
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class ScrapeRequest(BaseModel):
    url: str

def scrape_spotify(url: str):
    logger.info(f"Iniciando raspagem profunda (v4): {url}")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, slow_mo=50, args=["--no-sandbox", "--disable-setuid-sandbox"])
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 1000}
        )
        page = context.new_page()
        
        try:
            logger.info("Navegando...")
            page.goto(url, wait_until='load', timeout=60000)
            
            # Clique inicial para foco
            page.mouse.click(600, 500)
            time.sleep(1)

            tracks = {}
            last_len = 0
            stuck_count = 0
            
            logger.info("Iniciando scroll dinâmico...")
            for i in range(120):
                # Localizar linhas APENAS dentro do container da playlist (ignora recomendações)
                rows = page.locator('div[data-testid="playlist-tracklist"] [data-testid="tracklist-row"]').all()
                
                if not rows:
                    # Se o seletor específico falhar, tenta o genérico (fallback)
                    rows = page.locator('[data-testid="tracklist-row"]').all()
                    page.evaluate("window.scrollBy(0, 800)")
                    time.sleep(1)
                    continue

                # Extrair dados
                for row in rows:
                    try:
                        track_link = row.locator('a[href*="/track/"]').first
                        if track_link.count():
                            href = track_link.get_attribute('href')
                            t_id = href.split('/track/')[-1].split('?')[0]
                            
                            if t_id not in tracks:
                                title = track_link.inner_text()
                                
                                # Artistas
                                artists = row.locator('a[href*="/artist/"]').all_inner_texts()
                                artist_str = ", ".join(artists) if artists else "Desconhecido"
                                
                                # Capa
                                img = row.locator('img').first
                                cover = ""
                                if img.count():
                                    cover = img.get_attribute('src') or ""
                                    if not cover:
                                        srcset = img.get_attribute('srcset')
                                        if srcset: cover = srcset.split(' ')[0]
                                if cover and cover.startswith('//'): cover = 'https:' + cover
                                
                                tracks[t_id] = {
                                    'id': t_id,
                                    'title': title,
                                    'artist': artist_str,
                                    'cover': cover
                                }
                    except Exception:
                        pass

                # Feedback e controle de parada
                if len(tracks) != last_len:
                    logger.info(f"Progresso: {len(tracks)} músicas encontradas...")
                    last_len = len(tracks)
                    stuck_count = 0
                else:
                    # Detectar se chegamos na seção de recomendações do Spotify
                    recs_heading = page.locator('h2:has-text("Recomendado"), h2:has-text("Recommended"), h2:has-text("Músicas recomendadas")').first
                    if recs_heading.count() and recs_heading.is_visible():
                        # Garantir que o heading está ABAIXO do conteúdo que já pegamos
                        # (Spotify às vezes renderiza o heading antes de carregar tudo, mas o is_visible() ajuda)
                        logger.info("Seção de recomendações detectada. Finalizando coleta para evitar músicas extras.")
                        break

                    # Se parou de crescer, tenta um scroll forçado ou para
                    if stuck_count > 12:
                        logger.info("Fim da lista atingido.")
                        break
                    stuck_count += 1

                # Rolar para a última linha visível
                try:
                    rows[-1].scroll_into_view_if_needed()
                    time.sleep(0.3)
                except:
                    page.evaluate("window.scrollBy(0, 800)")
                
            logger.info(f"Finalizado! Total: {len(tracks)}")
            
        except Exception as e:
            logger.error(f"Erro no scraper: {e}")
            raise e
        finally:
            browser.close()
            
        return {
            "playlist": {
                "id": "scraped",
                "name": "Playlist Importada",
                "owner": "Spotify",
                "cover": ""
            },
            "tracks": list(tracks.values())
        }

@app.post("/api/scrape")
def api_scrape(req: ScrapeRequest):
    if "open.spotify.com/playlist/" not in req.url:
        raise HTTPException(status_code=400, detail="URL inválida.")
    
    try:
        data = scrape_spotify(req.url)
        if not data["tracks"]:
            raise HTTPException(status_code=404, detail="Nenhuma música encontrada.")
        return data
    except Exception as e:
        logger.exception("Erro interno na API")
        raise HTTPException(status_code=500, detail=str(e))

app.mount("/", StaticFiles(directory=".", html=True), name="static")

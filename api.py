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
            
            logger.info("Iniciando scroll dinâmico ultra-veloz...")
            for i in range(150):
                # Extração em massa via Javascript (MUITO mais rápido)
                batch = page.evaluate("""() => {
                    const rows = document.querySelectorAll('[data-testid="tracklist-row"]');
                    return Array.from(rows).map(row => {
                        const trackLink = row.querySelector('a[href*="/track/"]');
                        if (!trackLink) return null;
                        const href = trackLink.getAttribute('href');
                        const id = href.split('/track/')[1].split('?')[0];
                        const title = trackLink.innerText;
                        const artists = Array.from(row.querySelectorAll('a[href*="/artist/"]')).map(a => a.innerText);
                        const img = row.querySelector('img');
                        let cover = img ? img.getAttribute('src') : "";
                        if (!cover && img) {
                             const srcset = img.getAttribute('srcset');
                             if (srcset) cover = srcset.split(' ')[0];
                        }
                        return { id, title, artist: artists.join(', '), cover };
                    }).filter(x => x !== null);
                }""")
                
                # Mesclar resultados
                new_found = False
                for track in batch:
                    if track['id'] not in tracks:
                        tracks[track['id']] = track
                        new_found = True
                
                if new_found:
                    stuck_count = 0
                    logger.info(f"Progresso: {len(tracks)} músicas...")
                else:
                    stuck_count += 1
                
                # Critério de parada: Recomendações visíveis ou parado por muito tempo
                recs = page.locator('h2:has-text("Recomendado"), h2:has-text("Recommended")').first
                if (recs.count() and recs.is_visible()) or stuck_count > 15:
                    break
                
                # Rolar para baixo (salto maior)
                page.mouse.wheel(0, 1500)
                time.sleep(0.4)
            
            logger.info(f"Finalizado! Total: {len(tracks)}")
                
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

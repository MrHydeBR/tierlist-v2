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
        # Modo ultra-econômico de memória
        browser = p.chromium.launch(
            headless=True, 
            args=[
                "--no-sandbox", 
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",  # Crucial para Docker/Render
                "--disable-gpu",
                "--no-zygote",
                "--single-process",         # Economiza muita RAM
                "--disable-accelerated-2d-canvas",
                "--no-first-run"
            ]
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1000, "height": 800} # Reduzido para poupar RAM
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
                # Extração Hiper-Flexível via Javascript
                batch = page.evaluate("""() => {
                    // Busca todos os links de música na página
                    const trackLinks = Array.from(document.querySelectorAll('a[href*="/track/"]'));
                    const results = [];
                    
                    trackLinks.forEach(link => {
                        const href = link.getAttribute('href');
                        const idMatch = href.match(/\/track\/([a-zA-Z0-9]+)/);
                        if (!idMatch) return;
                        
                        const id = idMatch[1];
                        const title = link.innerText.trim();
                        if (!title || title.length < 1) return;

                        // Tenta achar o container da linha subindo o DOM
                        const row = link.closest('[role="row"], div > div:has(img)');
                        if (!row) return;

                        // Busca artistas e capa dentro desse container
                        const artistLinks = Array.from(row.querySelectorAll('a[href*="/artist/"]'));
                        const artist = artistLinks.map(a => a.innerText).join(', ') || "Desconhecido";
                        
                        const img = row.querySelector('img');
                        let cover = img ? img.getAttribute('src') : "";
                        if (!cover && img) {
                             const srcset = img.getAttribute('srcset');
                             if (srcset) cover = srcset.split(' ')[0];
                        }

                        results.push({ id, title, artist, cover });
                    });
                    return results;
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

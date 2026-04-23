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

import json
from fastapi.responses import StreamingResponse

def scrape_spotify_generator(url: str):
    logger.info(f"Iniciando streaming de raspagem: {url}")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True, 
            args=[
                "--no-sandbox", 
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-zygote",
                "--single-process",
                "--disable-blink-features=AutomationControlled"
            ]
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1000, "height": 800}
        )
        page = context.new_page()
        
        try:
            # Envia um pingo inicial para o frontend saber que estamos vivos
            yield json.dumps({"status": "connected"}) + "\n"

            # Bypass de detecção de robô
            page.goto(url, wait_until='load', timeout=60000)
            
            # Espera bruta para garantir que o conteúdo dinâmico apareça
            time.sleep(5)
            
            page.mouse.click(600, 500)
            time.sleep(1)

            tracks_sent = set()
            stuck_count = 0
            
            for i in range(250):
                if len(tracks_sent) >= 150: break

                batch = page.evaluate("""() => {
                    const trackLinks = Array.from(document.querySelectorAll('a[href*="/track/"]'));
                    const results = [];
                    
                    // Localiza o título de recomendações para servir de "parede"
                    const recsHeading = Array.from(document.querySelectorAll('h2')).find(h => 
                        h.innerText.includes('Recomendado') || 
                        h.innerText.includes('Recommended') ||
                        h.innerText.includes('Músicas recomendadas')
                    );

                    trackLinks.forEach(link => {
                        // Se a música estiver DEPOIS do título de recomendações, ignora
                        if (recsHeading && (recsHeading.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING)) {
                            return;
                        }

                        const href = link.getAttribute('href');
                        const idMatch = href.match(/\/track\/([a-zA-Z0-9]+)/);
                        if (!idMatch) return;
                        const id = idMatch[1];
                        const title = link.innerText.trim();
                        if (!title) return;

                        const row = link.closest('[role="row"], div > div:has(img)');
                        if (!row) return;

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
                
                new_found = False
                for track in batch:
                    if track['id'] not in tracks_sent:
                        tracks_sent.add(track['id'])
                        new_found = True
                        yield json.dumps(track) + "\n"
                        if len(tracks_sent) >= 150: break
                
                if not new_found: 
                    stuck_count += 1
                else: 
                    stuck_count = 0

                # Para apenas se ficar travado por muito tempo (fim da página real)
                if stuck_count > 35:
                    break
                
                # Rolar para baixo usando teclado e JS (mais confiável em servidores)
                page.keyboard.press("PageDown")
                page.evaluate("window.scrollBy(0, 800)")
                
                # Se não achou nada, espera um pouco mais (paciência)
                if not new_found:
                    time.sleep(1.0)
                else:
                    time.sleep(0.5)
            
            logger.info(f"Streaming finalizado. Total: {len(tracks_sent)}")
            
        except Exception as e:
            logger.error(f"Erro no streaming: {e}")
            yield json.dumps({"error": str(e)}) + "\n"
        finally:
            browser.close()

@app.post("/api/scrape")
def api_scrape(req: ScrapeRequest):
    if "open.spotify.com/playlist/" not in req.url:
        raise HTTPException(status_code=400, detail="URL inválida.")
    
    return StreamingResponse(scrape_spotify_generator(req.url), media_type="application/x-ndjson")

app.mount("/", StaticFiles(directory=".", html=True), name="static")

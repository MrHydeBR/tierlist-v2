import httpx
import json
from bs4 import BeautifulSoup
import logging
import pprint

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_EMBED_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
}

async def test_playlist(playlist_id):
    url = f"https://open.spotify.com/embed/playlist/{playlist_id}"
    print(f"Fetching {url}...")
    async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
        res = await client.get(url, headers=_EMBED_HEADERS)
    
    print(f"Status: {res.status_code}")
    if res.status_code != 200:
        return
        
    soup = BeautifulSoup(res.text, "html.parser")
    script = soup.find("script", {"id": "__NEXT_DATA__"})
    
    if not script:
        print("Script#next_data NOT FOUND")
        return

    try:
        data = json.loads(script.string)
        print("JSON parsed successfully")
        
        state = data.get("props", {}).get("pageProps", {}).get("state", {})
        data_obj = state.get("data", {})
        print("Data keys:", data_obj.keys())
        
        entity = data_obj.get("entity", {})
        print("Entity keys:", entity.keys())
        
        if "trackList" in entity:
            print(f"Found trackList with {len(entity['trackList'])} items")
            first = entity['trackList'][0]
            print("First track keys:", first.keys())
            # Search for anything that looks like an image hash or URL in the first track
            for k, v in first.items():
                if isinstance(v, str) and (v.startswith("http") or len(v) > 30):
                    print(f"  {k}: {v}")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    import asyncio
    asyncio.run(test_playlist("240r8IyH3C7eogLnu9TAGx"))

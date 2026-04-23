# Como publicar sua Music Tier List V2.0

Para colocar sua aplicação online, siga estes passos:

## 1. GitHub (Código)
Como já inicializamos o Git localmente, você só precisa:
1. Criar um repositório vazio no GitHub chamado `tierlist-v2`.
2. Rodar estes comandos no terminal:
   ```bash
   git remote add origin https://github.com/SEU_USUARIO/tierlist-v2.git
   git branch -M main
   git push -u origin main
   ```

## 2. Render.com (Hospedagem)
O GitHub Pages não suporta Python/Playwright. Use o **Render.com**:
1. Conecte seu GitHub no Render.
2. Crie um **Web Service**.
3. **Build Command:** `pip install -r requirements.txt && playwright install chromium`
4. **Start Command:** `python -m uvicorn api:app --host 0.0.0.0 --port 10000`

---
*Gerado por Antigravity AI*

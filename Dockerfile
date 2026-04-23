# Usar imagem estável do Playwright
FROM mcr.microsoft.com/playwright/python:v1.40.0-focal

WORKDIR /app

# Copiar dependências e instalar
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar o restante do código
COPY . .

# Comando para rodar a aplicação
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "10000"]

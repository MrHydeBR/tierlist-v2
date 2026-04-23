# Usar a imagem oficial do Playwright que já vem com TUDO instalado
FROM mcr.microsoft.com/playwright/python:v1.49.0-noble

WORKDIR /app

# Copiar dependências e instalar
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar o restante do código
COPY . .

# Comando para rodar a aplicação
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "10000"]

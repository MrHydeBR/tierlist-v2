#!/usr/bin/env bash
# Sair se houver erro
set -o errexit

echo "--- Instalando dependências do Python ---"
pip install -r requirements.txt

echo "--- Instalando navegadores do Playwright ---"
python -m playwright install chromium

echo "--- Build finalizado com sucesso ---"

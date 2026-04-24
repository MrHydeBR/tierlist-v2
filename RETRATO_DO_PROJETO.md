# Jornada de Otimização: Spotify Playlist Scraper

Este documento registra as tentativas, desafios e a evolução técnica do projeto para extrair músicas de playlists do Spotify de forma estável e performática.

## 1. O Objetivo Inicial
Desenvolver uma ferramenta capaz de capturar todas as músicas (116+) de uma playlist do Spotify e permitir a classificação em Tiers (S a D), superando as limitações do plano gratuito do Render.com (512MB RAM).

---

## 2. Fase 1: O "Gato e Rato" (Web Scraping)

### Abordagem: Playwright + Chromium
Tentamos simular um usuário real navegando e rolando a tela para carregar músicas dinâmicas (Lazy Loading).

| Tentativa | Problema Enfrentado | Resultado |
| :--- | :--- | :--- |
| **Rolagem Simples** | O Spotify bloqueava a rolagem após 31 músicas (limite do viewport inicial). | Estagnado em 31 faixas. |
| **Rolagem Universal JS** | Identificamos que o Spotify usa containers internos de scroll. | Chegamos a 78 faixas. |
| **Bypass de Cookies** | O banner de cookies impedia a interação com a lista. | O robô passou a "limpar" o banner antes da busca. |
| **Filtro de Índice (#)** | O robô capturava "Recomendações" extras do Spotify no final da lista. | Filtramos apenas faixas com número de índice. |
| **Modo Stealth** | O Spotify detectava o robô e exibia uma página vazia (0 músicas). | Removemos a marca de `webdriver` e simulamos comportamento humano. |
| **Simulação Mobile** | Bloqueios agressivos na versão Desktop. | **Sucesso Parcial:** Chegamos a 100 faixas simulando um iPhone 13. |

**Conclusão da Fase 1:** Inconsistência. A raspagem é sensível a qualquer mudança de layout do Spotify e consome muita memória no servidor (causando OOM - Out of Memory).

---

## 3. Fase 2: Crise de Interface e Refatoração
Durante as mudanças constantes, a interface sofreu instabilidades devido a conflitos de scripts e arquivos ausentes.

*   **Problema:** Tiers sumindo e barra de busca oculta.
*   **Causa:** Ausência do arquivo `utils.js` e importações de módulos JS quebradas.
*   **Solução:** 
    *   Unificação do `app.js` (eliminando dependências externas).
    *   Restauração do CSS Premium com foco em visibilidade (Z-Index) e estética "Glassmorphism".

---

## 4. Fase 3: A e mesmo com a API Oficial, o Spotify bloqueia requisições (*Forbidden*) se o app tentar ler episódios de podcast sem autorização.

*   **Problema:** Spotipy solicita `track,episode` por padrão, causando erro 403 imediato.
*   **Solução:** Forçamos o parâmetro `additional_types=['track']` tanto no Frontend quanto no Backend para garantir 100% de acesso.

---

## 5. Fase 4: Arquitetura Híbrida e Resiliente
Para vencer o limite de 100 músicas do Scraper e a instabilidade do servidor, o app agora tenta carregar dados diretamente do navegador do usuário.

*   **Status Atual:** Busca direta via navegador ativa (prioritária), Fallback para API Oficial via Backend (secundária) e Scraper de Embed "blindado" (emergência).
*   **Resolução de Erro:** Corrigido o erro de escopo de variáveis no Python movendo constantes como `_EMBED_HEADERS` para o topo.
*   **Nova Abordagem:** Simplificação radical das chamadas de API (remoção de `fields` e `additional_types`) para contornar o erro 403 Forbidden que bloqueava o acesso a metadados.
*   **Resultado:** Carregamento estável de playlists grandes (116+ músicas) com capas corrigidas via SVG Data-URI.

### Abordagem: Spotipy + Client Credentials
Decidimos abandonar a raspagem de tela em favor da comunicação direta com os servidores do Spotify.

*   **Vantagens:** 100% de estabilidade, carregamento instantâneo de todas as músicas, consumo mínimo de memória.
*   **Implementação:** Integração de `Client ID` e `Client Secret` fornecidos pelo usuário.
*   **Status Atual:** 
    *   Interface Premium restaurada e funcional.
    *   Comunicação via API Oficial ativa.
    *   Ajustes finais em logs para garantir que 100% das faixas sejam lidas corretamente.

---

## 5. Resumo Técnico de Erros e Soluções
*   **Erro 31/70/100 músicas:** Limitação de renderização dinâmica do navegador. Resolvido com a API Oficial.
*   **Erro "ASGI app not found":** Execução do servidor fora da pasta raiz. Resolvido com `cd` correto.
*   **Layout Quebrado:** Conflitos de CSS e `hidden` states. Resolvido com reescrita simplificada e robusta.

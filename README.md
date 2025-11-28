# Mídia única com link fixo (frontend + backend)

Fluxo simples para ter uma única mídia (vídeo ou imagem) sempre atualizada e servida no mesmo link. O frontend é estático e o backend Node/Express recebe uploads e expõe a mídia em `/media/latest.*`.

## Como funciona
- Backend guarda **apenas um arquivo** chamado `latest.<ext>` na pasta `media/`.
- API:
  - `POST /api/upload` — recebe `file` (multipart), valida formato e sobrescreve o anterior.
  - `GET /api/info` — retorna metadados do arquivo atual.
  - `GET /media/latest` ou `/media/latest.<ext>` — serve a mídia atual com cabeçalho `Cache-Control: no-cache`.
- Frontend consulta `/api/info`, exibe a mídia atual e permite enviar um novo arquivo (mp4/webm/mov/ogg/mkv ou jpg/jpeg/png/webp/gif/svg).
- Página dedicada `viewer.html`: abre a mídia atual em tela cheia com botões de baixar e compartilhar (abre em nova guia a partir do botão na home).

## Rodando localmente (backend + front)
```bash
npm install
npm run dev         # ou npm start
# abre http://localhost:3000
```
- O backend serve o `index.html` e a pasta `media/` no mesmo host/porta.
- Uploads feitos pelo formulário já salvam como `latest.<ext>` no backend.

## Hospedando
1) **Backend**: suba em um serviço que permita Node (Render, Railway, Fly.io, Heroku, VPS etc.).  
   - Coloque os arquivos do repositório no servidor.  
   - Rode `npm install` e `npm start`.  
   - Exponha a porta (padrão 3000) e obtenha a URL pública (ex.: `https://sua-api.com`).  
   - Opcional: defina `CORS_ORIGIN` com a origem do front (ex.: `https://seuuser.github.io`).

2) **Frontend estático** (GitHub Pages ou similar):  
   - Em `config.js`, defina `apiBase` para a URL pública do backend:  
     ```js
     window.APP_CONFIG = { apiBase: "https://sua-api.com" };
     ```  
   - Publique os arquivos estáticos (index.html, styles.css, script.js, config.js).  
   - O visitante acessa esse link fixo; o player carrega sempre a mídia mais recente do backend.

> Se backend e frontend estiverem no **mesmo domínio/porta**, deixe `apiBase` vazio (`""`) e use o servidor Node para tudo.

## Fluxo do usuário final
1) Abrir o link fixo do site.  
2) Clicar em “Subir nova mídia”, escolher o arquivo e “Enviar e publicar”.  
3) O backend salva como `latest.<ext>`; qualquer pessoa que abrir o link verá a versão mais recente.  
4) Botões “Recarregar mídia” e “Ver em tela cheia” ajudam a validar e evitar cache.

## Variáveis de ambiente úteis
- `PORT`: porta do backend (padrão 3000).  
- `MAX_UPLOAD_MB`: limite de upload em MB (padrão 200).  
- `CORS_ORIGIN`: lista de origens permitidas (separadas por vírgula). Padrão: `*`.

## Formatos aceitos
- Vídeo: mp4, webm, mov, ogg, mkv  
- Imagem: jpg, jpeg, png, webp, gif, svg

## Estrutura
- `index.html`, `styles.css`, `script.js`, `config.js` — frontend estático.
- `viewer.html`, `viewer.js` — página de visualização em tela cheia.
- `server.js` — backend Express.
- `media/` — pasta onde o backend salva `latest.<ext>`.
- `package.json` — dependências e scripts.

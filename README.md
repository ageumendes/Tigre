# Servidor TV Tigre v2.16.0

## Portal cativo e análises v2.16.0

- Downloads e compartilhamentos de imagens usam as variantes JPG criadas durante o upload.
- O compartilhamento móvel envia o arquivo JPG pelo menu nativo quando o navegador permite.
- O usuário pode navegar pelas promoções arrastando para os lados, com movimento e transição visual.
- Cliques repetidos em conectar são bloqueados no navegador e deduplicados novamente no servidor.
- Duplicidades históricas continuam preservadas no banco, mas são desconsideradas das análises.
- O dashboard oferece períodos de 7 e 30 dias, dispositivos únicos, sessões, taxas de conclusão e conexão, tendência diária e distribuição por SSID.
- `auth_redirect` é apresentado corretamente como solicitação de liberação, sem afirmar que o AP confirmou a autenticação.

## Orientação das TVs

O botão **Girar** percorre `0° → 90° → 180° → 270° → 0°`. Em `0°` e `180°`,
o player utiliza as variantes landscape e mantém o layout de três mídias. Em
`90°` e `270°`, utiliza as variantes portrait geradas no upload e mostra somente
a mídia principal. A inversão CSS de 180° é aplicada apenas em `180°` e `270°`,
sem trocar largura e altura ou deformar o conteúdo.

O ângulo é salvo no navegador separadamente para cada página de TV e restaurado
após atualização ou reinício. Antes da primeira escolha manual, o player segue
a orientação informada pelo dispositivo. Mídias antigas sem fonte portrait usam
a fonte landscape como fallback.

## Refinamento visual v2.14.1

- A mídia principal usa aproximadamente 95% da altura disponível em tela horizontal.
- As duas mídias secundárias são exibidas em quadros gêmeos de proporção 9:16.
- Cada quadro secundário possui 70% da altura da mídia principal.
- O conteúdo usa `object-fit: contain`, preservando textos, preços e telefones sem cortes.
- A opacidade reduzida das secundárias foi mantida para destacar a programação principal.

## Layout responsivo de três mídias

Nos players em tela horizontal, a mídia principal permanece centralizada e as
duas mídias secundárias ocupam os espaços laterais sem sobreposição. O player
mede as proporções reais após cada carregamento, aumenta as laterais conforme o
espaço disponível e mantém iguais as margens externas e internas. O cálculo é
refeito em cada troca, redimensionamento, rotação e entrada ou saída da tela cheia.

## Banco de dados e atualização automática

A partir da v2.13.0, configurações, promoções, estatísticas e fila de conversão são
armazenadas em SQLite. No primeiro início, o servidor importa automaticamente os
JSON existentes e guarda uma cópia em `media/json-migration-backup`. O banco padrão
é `media/tv-media.sqlite`; use `DB_PATH` somente se quiser mantê-lo em outro volume.

O endpoint público `/media-config.json` continua disponível para TVs e players, mas
agora é produzido a partir do banco. Não edite os JSON antigos após a migração.

Servidor de TV corporativa/digital signage para publicar vídeos e imagens por TV ou grupo, com HLS, variantes para Roku, carrossel, monitoramento e atualização automática dos players.

## Validade e mídia permanente

- Uma publicação temporária pode receber uma `Data de fim da reprodução`.
- Ela deixa de ser exibida às 00:00 dessa data no fuso definido por `MEDIA_TIMEZONE` (padrão `America/La_Paz`).
- Publicações permanentes fazem parte continuamente da programação. Quando existem temporárias válidas, os dois grupos são intercalados; sem temporárias válidas, somente as permanentes são exibidas.
- Uma nova publicação temporária substitui a temporária anterior e preserva a permanente.
- Uma nova publicação permanente substitui a permanente anterior e preserva a temporária.
- Mídias antigas sem os novos campos continuam válidas como temporárias sem vencimento.

Consulte `DESENVOLVIMENTO.md` para o histórico e a lista de evolução.

## Gerenciamento de mídias

A tela principal possui a seção **Gerenciar mídias publicadas**. Após informar
a senha administrativa é possível filtrar mídias temporárias, permanentes,
vencidas e desativadas; alterar a data final; renovar uma mídia vencida;
transformar em permanente; ativar/desativar; ou excluir da programação.

## Reprodução offline

- O player registra um worker local e guarda a página, os scripts, o último manifesto e as mídias sincronizadas.
- Em caso de queda da rede ou indisponibilidade do servidor, a TV continua reproduzindo o conteúdo salvo.
- As mídias permanentes e temporárias ativas são baixadas antecipadamente para reprodução offline.
- Se uma temporária vencer durante a falta de rede, ela sai da programação e as permanentes continuam disponíveis, usando o fuso `America/La_Paz`.
- A programação anterior só é descartada depois que todos os arquivos da nova programação foram armazenados.
- Um indicador discreto aparece no canto da tela enquanto a TV está offline.

Para preparar uma TV para uso offline, abra seu player ao menos uma vez com conexão e aguarde o download das mídias. A primeira visita ainda precisa de internet.

## Fila persistente de vídeos

- Cada vídeo enviado é registrado no SQLite antes do processamento.
- Tarefas interrompidas por reinício do Node, servidor ou PM2 são retomadas automaticamente.
- As tentativas usam espera progressiva e são limitadas por `MAX_TRANSCODE_ATTEMPTS`.
- Arquivos derivados incompletos são descartados antes de uma nova tentativa; o original é preservado até a conclusão.
- A área **Fila de processamento de vídeos** mostra tarefas pendentes, em execução, agendadas e com falha.
- Uma falha definitiva pode ser reenviada pelo botão **Tentar novamente**.
- Excluir uma mídia cancela também sua tarefa persistente.

Variáveis: `MAX_TRANSCODE_JOBS` controla o paralelismo; `MAX_TRANSCODE_ATTEMPTS` controla o limite automático; `TRANSCODE_RETRY_BASE_MS` define a espera inicial.

Fluxo simples para ter uma única mídia (vídeo MP4) sempre atualizada e servida no mesmo link. O frontend é estático e o backend Node/Express recebe uploads e expõe a mídia em `/media/latest.mp4`.

## Como funciona
- Backend guarda **apenas um arquivo** chamado `latest.mp4` na pasta `media/`.
- API:
  - `POST /api/upload` — recebe `file` (multipart), valida (somente MP4) e sobrescreve o anterior.
  - `GET /api/info` — retorna metadados do arquivo atual.
  - `GET /media/latest` ou `/media/latest.mp4` — serve a mídia atual com cabeçalho `Cache-Control: no-cache`.
- Frontend consulta `/api/info`, exibe a mídia atual e permite enviar um novo arquivo (somente MP4 para compatibilidade com splash).
- Página dedicada `viewer.html`: abre a mídia atual em tela cheia com botões de baixar e compartilhar (abre em nova guia a partir do botão na home).

## Rodando localmente (backend + front)
```bash
npm install
npm run dev         # ou npm start
# abre http://localhost:3000
```
- O backend serve o `index.html` e a pasta `media/` no mesmo host/porta.
- Uploads feitos pelo formulário já salvam como `latest.mp4` no backend.

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
2) Clicar em “Subir nova mídia”, escolher o arquivo (MP4) e “Enviar e publicar”.  
3) O backend salva como `latest.mp4`; qualquer pessoa que abrir o link verá a versão mais recente.  
4) Botões “Recarregar mídia” e “Ver em tela cheia” ajudam a validar e evitar cache.

## Variáveis de ambiente úteis
- `PORT`: porta do backend (padrão 3000).  
- `MAX_UPLOAD_MB`: limite de upload em MB (padrão 200).  
- `CORS_ORIGIN`: lista de origens permitidas (separadas por vírgula). Padrão: `*`.  
- `OPENAI_API_KEY`: chave usada pela rota `/api/cotacoes-agro` (Responses API com busca web). Mantenha em segredo.
- `DEVICE_KEYS`: chaves dos aparelhos separadas por `;` (obrigatórias em produção para telemetria).
- `MEDIA_TIMEZONE`: fuso usado para encerrar a reprodução à meia-noite.
- `CORS_ORIGINS`: origens administrativas permitidas, separadas por vírgula.

Nunca distribua o arquivo `.env` em ZIPs ou repositórios. Use somente `.env.example` como modelo.

Você pode copiar `.env.example` e preencher suas chaves antes de subir o ambiente local ou configurar as variáveis direto no servidor de deploy.

## Formatos aceitos
- Vídeo: mp4 (H.264/AAC) — obrigatório

## Estrutura
- `index.html`, `styles.css`, `script.js`, `config.js` — frontend estático.
- `viewer.html`, `viewer.js` — página de visualização em tela cheia.
- `server.js` — backend Express.
- `media/` — pasta onde o backend salva `latest.mp4`.
- `package.json` — dependências e scripts.

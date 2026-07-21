# Lista de desenvolvimento — Servidor TV Tigre

## v2.16.1 — programação mista permanente e temporária

- [x] Manter mídias permanentes na programação mesmo quando existem temporárias válidas.
- [x] Intercalar temporárias e permanentes preservando a ordem relativa de cada grupo.
- [x] Exibir somente permanentes quando nenhuma temporária estiver ativa.
- [x] Aplicar a mesma regra aos players web, ao modo offline e ao catálogo consumido pelo Roku.
- [x] Renovar o cache offline para distribuir a atualização aos players instalados.

## v2.16.0 — captive social, JPG e analytics confiável

- [x] Baixar imagens do portal cativo em JPG.
- [x] Compartilhar o arquivo JPG pelo compartilhamento nativo quando disponível.
- [x] Copiar o link direto da mídia JPG como fallback.
- [x] Navegar entre mídias por gesto horizontal com acompanhamento do dedo.
- [x] Preservar navegação por setas, temporizador e vídeos.
- [x] Bloquear cliques repetidos no botão de conexão no frontend.
- [x] Deduplicar eventos novamente no servidor por dispositivo, SSID, tipo e janela de tempo.
- [x] Desconsiderar duplicidades históricas sem apagar registros originais.
- [x] Exibir períodos reais de 7 e 30 dias no dashboard.
- [x] Calcular dispositivos únicos e sessões com janela de 30 minutos.
- [x] Calcular taxas de conclusão e avanço para liberação.
- [x] Separar visualizações e conexões no gráfico diário.
- [x] Exibir conexões por SSID e indicador de qualidade dos dados.
- [x] Usar nomes profissionais e precisos para os eventos.
- [x] Escapar dados externos antes de inseri-los na tabela do dashboard.
- [x] Preservar os ajustes manuais da v2.15.1 em `index.html` e `styles.css`.

## v2.15.0 — orientação horizontal e vertical

- [x] Fazer o botão Girar percorrer 0°, 90°, 180° e 270°.
- [x] Usar as variantes landscape em 0° e 180°.
- [x] Usar as variantes portrait geradas no upload em 90° e 270°.
- [x] Exibir somente a mídia principal nos dois modos verticais.
- [x] Aplicar CSS de 180° somente em 180° e 270°.
- [x] Girar também controles e indicador offline quando invertidos.
- [x] Preservar proporção, reprodução de vídeo e transições.
- [x] Salvar o ângulo individualmente para cada página de TV.
- [x] Restaurar o ângulo depois de atualizar ou reiniciar o dispositivo.
- [x] Detectar automaticamente a orientação antes da primeira escolha manual.
- [x] Usar landscape como fallback quando não existir variante portrait.
- [x] Incluir variantes de vídeo das duas orientações no cache offline.
- [x] Atualizar a versão do service worker.

## v2.14.1 — principal ampliada e secundárias gêmeas

- [x] Remover a redução global de 10% aplicada ao carrossel horizontal.
- [x] Ampliar a mídia principal para aproveitar as margens superior e inferior.
- [x] Criar dois quadros secundários com dimensões exatamente iguais.
- [x] Fixar cada quadro secundário em 70% da altura da mídia principal.
- [x] Padronizar os quadros laterais na proporção vertical 9:16.
- [x] Preservar as mídias completas com `object-fit: contain`.
- [x] Manter o destaque da mídia principal pela opacidade das secundárias.
- [x] Recalcular margens externas e internas de forma simétrica.

## v2.14.0 — layout responsivo do player

- [x] Medir as dimensões reais das três mídias depois do carregamento.
- [x] Recalcular o layout em todas as trocas, inclusive após a terceira mídia.
- [x] Manter a mídia principal centralizada e livre de sobreposição.
- [x] Distribuir igualmente margens externas e intervalos internos.
- [x] Aumentar as mídias secundárias conforme o espaço disponível.
- [x] Preservar a proporção de imagens e vídeos sem corte ou deformação.
- [x] Recalcular ao redimensionar, girar ou alternar a tela cheia.
- [x] Corrigir a mídia anterior exibida no lado esquerdo.
- [x] Atualizar o cache offline do player para a nova versão.

## v2.13.0 — armazenamento SQLite

- [x] Migrar configurações de mídias, TVs e promoções para SQLite.
- [x] Migrar estatísticas e a fila de transcodificação para SQLite.
- [x] Importar automaticamente os arquivos JSON existentes no primeiro início.
- [x] Preservar uma cópia dos JSON em `media/json-migration-backup`.
- [x] Ativar WAL, espera de bloqueio e verificação de integridade do banco.
- [x] Usar o banco como fonte oficial sem quebrar `media-config.json` para os players.
- [x] Impedir que a limpeza de mídias remova o banco, WAL ou backups.
- [x] Verificar o banco no endpoint `/readyz`.

## v2.12.0 — fila persistente de conversão

- [x] Persistir tarefas de vídeo em disco antes do processamento.
- [x] Recuperar tarefas interrompidas após reinício do servidor ou PM2.
- [x] Controlar paralelismo da conversão.
- [x] Repetir falhas automaticamente com espera progressiva.
- [x] Limitar tentativas automáticas e registrar o último erro.
- [x] Preservar o vídeo original até a conversão terminar.
- [x] Limpar saídas parciais antes de repetir a tarefa.
- [x] Exibir a fila no painel administrativo.
- [x] Permitir nova tentativa manual de falhas definitivas.
- [x] Cancelar a tarefa quando sua mídia for excluída.

## v2.11.0 — reprodução offline

- [x] Armazenar o player e seus recursos essenciais no dispositivo.
- [x] Persistir o último manifesto também em armazenamento local.
- [x] Baixar antecipadamente as mídias ativas e permanentes.
- [x] Continuar reproduzindo quando servidor ou internet ficarem indisponíveis.
- [x] Responder solicitações HTTP Range usando o vídeo armazenado localmente.
- [x] Trocar para a mídia permanente se a temporária vencer durante uma queda de rede.
- [x] Preservar o cache anterior até concluir a nova sincronização.
- [x] Limpar versões antigas e limitar os arquivos candidatos por programação.
- [x] Mostrar indicador de modo offline na TV.
- [x] Retomar a sincronização automaticamente quando a conexão voltar.

## v2.10.0 — gerenciamento de mídias

- [x] Listar todas as mídias, inclusive vencidas e desativadas.
- [x] Filtrar temporárias, permanentes, vencidas e desativadas.
- [x] Alterar e renovar a data final de reprodução.
- [x] Transformar mídia temporária em permanente e vice-versa.
- [x] Ativar ou desativar sem excluir o arquivo.
- [x] Excluir mídia da programação com confirmação.
- [x] Atualizar manifesto web e catálogo Roku imediatamente após alterações.
- [x] Proteger toda a área com senha administrativa.

## v2.9.0 — validade e fallback permanente

- [x] Permitir definir a data final da mídia durante o upload.
- [x] Encerrar a elegibilidade da mídia às 00:00 da data escolhida.
- [x] Usar o fuso configurável `MEDIA_TIMEZONE` (padrão `America/La_Paz`).
- [x] Permitir cadastrar mídia permanente por TV ou para todas as TVs.
- [x] Priorizar mídias temporárias válidas.
- [x] Exibir automaticamente as mídias permanentes quando nenhuma temporária estiver válida.
- [x] Preservar a mídia permanente ao publicar uma temporária e vice-versa.
- [x] Aplicar as regras tanto ao manifesto web quanto ao catálogo Roku.
- [x] Proteger alterações de promoções com senha administrativa.
- [x] Proteger estatísticas e métricas administrativas.
- [x] Exigir chave dos dispositivos em produção.
- [x] Remover o CORS global permissivo.
- [x] Usar comparação de senha resistente a variação de tempo.
- [x] Gravar arquivos JSON de configuração de forma atômica.
- [x] Remover rotas duplicadas de saúde.
- [x] Padronizar a versão do aplicativo.

## Próximas melhorias recomendadas

- [x] Migrar configurações e estatísticas de JSON para PostgreSQL ou SQLite.
- [ ] Criar usuários administrativos, perfis e auditoria de publicações.
- [x] Implementar download/cache offline completo nos dispositivos.
- [x] Persistir a fila de transcodificação e recuperar tarefas após reinício.
- [ ] Separar o backend monolítico em módulos.
- [x] Criar tela para listar, editar, renovar e remover mídias publicadas.
- [ ] Adicionar alertas de TV offline e falha de reprodução.

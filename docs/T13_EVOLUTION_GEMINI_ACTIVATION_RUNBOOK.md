# T13.7 — Evolution V4 não-root e Gemini privado (candidata)
 
## Escopo e estado
- Baseline implantado: PR42, main 2c0e3b6dde12f13207df12c77b5e4f836141354e; manter a instalação interna FM, regras Firestore e flags comerciais intactas.
- A prova anterior UID1000 encontrou script 0700 e falhou na inicialização das migrations/Prisma. A candidata separa a migração e geração do cliente Prisma do processo permanente. A imagem V4 aprovada não é recompilada.
- O endpoint de smoke agora exige resultado Gemini real, concluído e marcador exato; não aceita fallback. O novo smoke CLI usa exclusivamente prompt sintético, não lê clientes e não executa o worker.
- Código e topologia candidatos não são prova de provisionamento, conexão ou homologação. Em 27/11/2026, os comandos remotos de inventário GCP e Contabo foram recusados pelo controle PowerShell antes de executar. Nenhuma credencial foi criada nesta rodada.

## Sequência Evolution (infra isolada antes do go-live)
1. Confirmar digest da imagem V4 e proveniência da imagem Postgres e gateway. Não usar a instalação ou o número da FM. Renderizar base `deploy/t13-evolution-provider.compose.yaml` + `deploy/t13-evolution-nonroot.overlay.compose.yaml` com arquivos de segredo exclusivos, em diretório privado.
2. Para ensaio, usar projeto e redes exclusivos; tornar provider-egress internal e renomear commercial-private em overlay local de fixture, sem DNS/porta pública, volumes externos ou rede da aplicação comercial. Validar configuração e locks antes de subir.
3. Subir Postgres e confirmar saúde; executar migração one-shot com a própria V4 (ambiente DOCKER_ENV=true), somente rede interna, CAP_CHOWN explicitamente limitada, sem daemon Docker ou host mounts adicionais. Exigir exit 0, 57 migrations concluídas e zero pendentes para a V4 atual; conferir geração Prisma e cliente read-only no serviço permanente.
4. Subir provider UID1000:1000 e gateway UID101. Comprovar leitura do cliente gerado, escrita de instâncias no volume exclusivo, health real, TLS CA/SAN correto, rejeição hostname incorreto, sem porta pública, todas as rotas permitidas com dois tokens sintéticos e acesso cruzado negado. Em caso de falha, coletar apenas classificação sanitizada, parar a fixture e não promover.
5. Provar restart, restore PostgreSQL e separação da instalação FM. Provisionamento definitivo segue ADR-010: PKI privada e ACL, instância por tenant/unidade, segredo avevo- escopado no Secret Manager, IAM apenas para o segredo autorizado, QR e número de teste exclusivo. Nenhum token global no app. Estado close/HTTP400 não prova revogação.
6. Somente após aceite técnico, revisão independente e release certificada, conectar overlay da API à rede privada e habilitar pairing controlado. Inbound/attendance/go-live continuam false até autorização e homologação real.

## Sequência Gemini
- Inventariar exclusivamente projeto comercial `ai-sales-saas-vendedor-ia-prod` (estado, APIs habilitadas, chaves por nome/restrições, billing). Não listar valores de chaves. Não habilitar faturamento nem atribuir roles amplas sem autorização.
- Criar ou usar uma autorização Gemini exclusiva, vinculada à identidade dedicada sem privilégios de outros produtos, restringir à Generative Language API e ao IP de saída quando suportado. Não reutilizar chave FM/Firebase frontend. Confirmar modelo disponível pela API; não presumir que a configuração default esteja disponível. Não imprimir chave, bearer, conteúdo de segredo ou URL com credencial.
- Montar arquivo privado regular 0400/0600, sem symlink, legível pelo UID node mapeado, fora do repositório. No host comercial, declarar apenas `T13_GEMINI_API_KEY_FILE` (caminho absoluto) e `T13_GEMINI_MODEL` (modelo aprovado) no arquivo privado de runtime. O rollout aprovado carrega overlay e executa smoke no digest assinado antes de parar serviços. Se falhar, mantém a instalação anterior. O overlay não ativa WhatsApp nem altera permissões comerciais.
- O worker Evolution também aceita GEMINI_API_KEY_FILE; alias EVOLUTION_GEMINI_SECRET_FILE permanece compatível, mas duas fontes simultâneas são recusadas. Nunca exportar o valor no ambiente a partir do arquivo. Smoke autenticado OWNER e CLI exigem completed, provider gemini e marcador esperado; não retornam texto do provedor.
- A prova de chamada real tem custo de geração mínimo e deve usar apenas marcador sintético. CI usa doubles, não segredos. A disponibilidade de Gemini não equivale a atendimento WhatsApp real nem a release comercial GO.

## Travas
Sem merge/deploy desta candidata até CI do SHA exato, revisão independente e aprovação aplicável. Sem mudança de Firestore, IAM amplo, cobrança, canal real, flags de produção, instalação interna FM ou T14. Registrar evidência e limitações na issue #35.

# ADR-010 — WhatsApp dual provider: Evolution first

Data: 2026-11-24. Decisão de produto aprovada pelo Diretor. Implementação e homologação pendentes. Complementa ADR-009; substitui sua previsão de homologação inicial exclusivamente Meta.

## Decisão
- Evolution API (QR Code/Baileys) será a primeira opção de conexão do novo SaaS comercial, configurável por tenant/unidade.
- Meta WhatsApp Cloud API permanece como segunda opção oficial, preservando integralmente o adaptador, contratos e testes existentes. Ativação comercial Meta fica para etapa posterior, quando a empresa dispuser da estrutura cadastral e credenciais exigidas para seu onboarding.
- Não impor CNPJ ao fluxo Evolution nem declarar que Evolution dispensa obrigações legais, consentimento ou termos do WhatsApp.
- A atendente interna FM, repositório fm-vendedor-recuperacao-vendas, permanece intocada; nenhuma sessão, chave, banco, webhook ou contêiner dela será reutilizado ou alterado.
- Para o novo SaaS, provisionar gateway Evolution próprio, com versão imutável, armazenamento e credenciais exclusivos. Decisão de isolamento proposta pela engenharia em cumprimento à separação aprovada; validar recursos e operação antes de ativação.
- Sem fallback automático entre Evolution e Meta; seleção explícita de uma conexão ativa por unidade/canal, respeitando escopo tenant.

## Bloco de execução proposto T14 — Evolution-first (sequência com trava)
T14.1 — Inventário de contratos, regras e versão Evolution comprovada no código anterior; ADR e matriz de compatibilidade T13; preservar Cloud API.
T14.2 — Gateway Evolution dedicado e isolado: redes, persistência, backup/restore, credenciais, limites e health; gestão não exposta publicamente.
T14.3 — Adaptador TypeScript server-side: seleção de provider, cofre por conexão, instância vinculada a tenant/unidade, contratos HTTP, timeout, estado incerto, QR/TTL, reconexão/revogação; nenhuma chave global no browser.
T14.4 — Webhook autenticado e segregado, validação da origem e instância, dedupe/replay, status monotônico, limites, opt-out; conexão ao pipeline existente sem duplicação de conversas/outbox.
T14.5 — Onboarding no painel: OWNER autorizado seleciona Evolution/Meta; QR temporário no-store, expiração e estado remoto verificável; Meta preservada como segunda opção.
T14.6 — Envio e recebimento governados, IA e políticas existentes, handoff, isolamento por tenant/unidade, sem reenvio inseguro nem fallback cruzado; limites e riscos Baileys avaliados.
T14.7 — Certificação interna cumulativa: testes positivos/negativos, dois tenants, spoof/replay, queda/reconexão, timeout, concorrência, falhas de gateway, regressão Meta, backup/restore e revisão independente. Nova CI e release assinados para SHA resultante.
T14.8 — Homologação externa com número de teste exclusivo e destinatário autorizado: QR, estado conectado, inbound, resposta IA, outbound, status, dedupe, revogação e recuperação. Só depois de comprovação e autorização separada promover modo live. Não usar número da FM.
T14.9 — Fechamento, evidências e go/no-go comercial, atualização do cronograma mestre.

## Governança
T13.7 permanece em fechamento operacional, independente da homologação externa do WhatsApp. Implementação T14 pode ser preparada em branch própria, mas promoção exige gates sequenciais e nova certificação; o release T13 não é retroativamente alterado. Números reais, envio, cobrança e go-live continuam bloqueados até aprovação específica. Não inventar homologação.
Referência técnica da implementação anterior: docs/adr/0006-whatsapp-evolution-adapter.md e docs/EVOLUTION_V2_MESSAGE_BRIDGE_2026-10-22.md no commit b448de871ce87b395444d5332952358194b43fcd. Reutilizar conhecimento e contratos, não segredos ou sessões.
Risco: Evolution/Baileys não é a API oficial Meta; pode sofrer desconexões, restrições e bloqueios. Manter transparência, consentimento, opt-out e políticas aplicáveis. A Meta continua alternativa de produto.

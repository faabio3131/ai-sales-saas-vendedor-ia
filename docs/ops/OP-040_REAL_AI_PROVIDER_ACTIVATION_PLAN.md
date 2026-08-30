# OP-040 — Real AI Provider Activation

## Estado
EM EXECUÇÃO.

## Objetivo
Ativar o primeiro provedor real de IA do Vendedor IA em produção sem acoplar a lógica comercial ao fornecedor, preservando a Universal AI Provider Interface e os gates de tenant, segurança, testes e observabilidade.

## Decisão operacional inicial
O primeiro provedor real será Gemini por meio da Gemini API, encapsulada atrás de `GeminiTransport` e `GeminiAdapter`.

A integração runtime será feita por HTTP/REST dentro do adapter/transport. Nenhum módulo de negócio poderá chamar a API Gemini diretamente.

Para a ativação nova, o transporte real usa a **Interactions API estável v1**, e não `generateContent`. A decisão acompanha a direção atual do provedor: Interactions tornou-se a interface padrão em junho de 2026 e `generateContent` passou a ser considerado legado, embora ainda suportado.

A geração é stateless com `store=false`. O boundary interno continua sendo `GeminiTransport`, de modo que mudanças futuras do protocolo externo não contaminem aplicação, domínio ou roteador de IA.

Parâmetros de sampling legados/depreciados não são enviados pelo transporte real. O limite de saída continua sendo aplicado por `generation_config.max_output_tokens`.

## Cadeia obrigatória
`Business/Application → AIRouterInterface → AIRouter → AIProviderInterface → GeminiAdapter → GeminiHttpTransport → Gemini API`

## Escopo autorizado
- implementar transporte HTTP real do Gemini atrás do boundary existente;
- ler `GEMINI_API_KEY` apenas do runtime/Secret Manager;
- usar authorization key do Gemini vinculada a service account para a ativação de produção, evitando standard key em processo de descontinuação;
- tornar o modelo configurável por `GEMINI_MODEL`;
- não hardcodar segredo;
- adicionar readiness real do provedor;
- adicionar smoke operacional controlado para provar geração real;
- exigir autenticação, tenant válido e role `OWNER` no smoke operacional;
- normalizar resposta, latência e contagem de tokens quando retornadas;
- sanitizar falhas do provedor;
- adicionar testes de regressão;
- atualizar configuração de produção e documentação operacional;
- executar CI completo antes de qualquer deploy.

## Modelo inicial de produção
`gemini-3.7-flash`.

Motivo: modelo Flash estável/GA atual, adequado para produção e para os fluxos de chat, classificação, extração e raciocínio desta fase. O nome permanece configurável por `GEMINI_MODEL`; não existe dependência de domínio no modelo escolhido.

## Capacidades inicialmente habilitadas
- `FAST_CHAT`;
- `LEAD_CLASSIFICATION`;
- `DATA_EXTRACTION`;
- `GENERAL_REASONING`.

Capacidades multimodais, tool use e advanced reasoning não serão ativadas automaticamente nesta operação.

## Readiness
`GET /api/operations/ai-readiness`

Proteção:
- sessão autenticada;
- tenant autorizado.

O readiness deve verificar configuração e reachability do modelo sem expor API key.

## Smoke real
`POST /api/operations/ai-smoke`

Proteção:
- sessão autenticada;
- tenant autorizado;
- role `OWNER`.

O smoke usa prompt fixo e controlado, não aceita prompt arbitrário do cliente e serve apenas para validar a cadeia real de geração.

## Segurança
- API key nunca retorna em payload, log ou erro;
- resposta de erro do fornecedor não deve ser propagada ao cliente;
- nenhuma rota genérica de geração de IA será aberta;
- o smoke não substitui Policy Engine nem cria ação comercial;
- nenhuma autonomia comercial será promovida nesta operação.

## Fora de escopo
- WhatsApp real;
- respostas automáticas a clientes;
- alteração de autonomia;
- OpenAI/Anthropic reais;
- tool use;
- pagamentos;
- piloto comercial;
- declarar `PILOT_VALIDATED`.

## Critérios de saída técnicos
- Build PASS;
- Typecheck PASS;
- Tests PASS;
- Runtime security boundaries PASS;
- Production Docker smoke PASS;
- transporte Gemini real coberto por testes;
- readiness não expõe segredo;
- smoke exige OWNER;
- business code permanece desacoplado do provider.

## Critérios de saída externos
Após deploy e configuração segura do Secret Manager:
- readiness em produção retorna `READY`;
- smoke real retorna geração válida via `gemini`;
- modelo real é identificado;
- nenhuma API key aparece na resposta;
- usuário sem tenant/sem autorização não consegue executar smoke.

## Regra de fechamento
A OP-040 só poderá ser declarada VALIDADA EXTERNAMENTE após CI verde, deploy, configuração real do segredo e evidência de uma geração real em produção.

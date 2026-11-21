# T01 — Runtime interno e certificado de testes cognitivos

## Operação local de teste (NÃO é deploy Contabo)
```bash
export COGNITIVE_S2S_SECRET='<valor-gerado-localmente-com-no-minimo-32-caracteres>'
python3 -m unittest cognitive_service.test_core -v
python3 -m cognitive_service.server
```
O serviço escuta somente `127.0.0.1:8185` por padrão. Para conectar o backend
em sessão de teste, injetar no runtime Node `COGNITIVE_SERVICE_URL=http://127.0.0.1:8185`
e o mesmo segredo pelo mecanismo do operador. **Não commitar o valor**.
O cliente não fala com Python: somente `SalesEngine → AIRouterInterface →
CognitiveServiceAdapter` no servidor. Em rede real, HTTP só pode ser usado no
loopback; uma URI remota precisa de `https` e firewall privado.

## Configuração segura
- `COGNITIVE_SERVICE_URL`: opt-in. Ausente com secret ausente => rota Python desligada.
- `COGNITIVE_S2S_SECRET`: pelo menos 32 caracteres no backend e Python; a presença
  de apenas uma das variáveis deve bloquear configuração.
- `COGNITIVE_ROUTE_PRIORITY`: padrão mantém Gemini primeiro; `COGNITIVE_FIRST`
  prioriza baseline Python somente em validação autorizada.
- `COGNITIVE_METERING_ENABLED=true`: grava metadados sem conteúdo em
  `cognitiveUsageEvents`. Conceder apenas as permissões de execução mínimas.
- `COGNITIVE_SERVICE_HOST`: loopback por padrão; não expor publicamente.
  Binding não-loopback exige autorização explícita e proteção de rede independente.
- `COGNITIVE_SERVICE_PORT`: padrão 8185. `/health` informa somente versão/status.

## Checagens obrigatórias
1. `python3 -m unittest cognitive_service.test_core -v`.
2. `npm run build && npm run typecheck && npm test`.
3. Na CI, `npm test` inicia um serviço Python **real** em loopback e o testa via
   fetch/HMAC. Não é apenas stub.
4. Simular falha de Python e conferir fallback para Gemini ou baseline comercial.
5. Verificar cross-tenant, spoofing, resposta malformada, request repetido e
   invasão por conteúdo não confiável.
6. Sem rede/segredos reais, não declarar ativação externa ou custo de Gemini conhecido.

## Política de continuidade
Não conectar esse serviço ao FM Command nem ao Core NFCore: ambos permanecem
independentes. O Python não possui acesso de escrita à base comercial.
Não liberar T02 por revisão de código ou mera publicação de branch.

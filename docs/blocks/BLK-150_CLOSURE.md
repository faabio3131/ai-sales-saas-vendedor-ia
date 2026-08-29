# BLK-150 — Payments — Fechamento

**Status:** IMPLEMENTADO / TESTADO / VALIDADO.

## Entregue
- Payment domain com estados e minor units em BRL;
- PaymentProviderInterface provider-neutral conforme contrato canônico;
- PaymentService com criação de Pix/link, leitura, refresh server-side e webhook;
- criação somente a partir de Quote ACCEPTED e valor derivado do domínio;
- idempotencyKey obrigatória na criação;
- confirmação de pagamento somente por consulta ao provider ou webhook validado;
- deduplicação de webhook por tenant + provider + eventId;
- repositories in-memory para testes e Firestore adapter tenant-scoped;
- StructuralPaymentProvider sem I/O externo, usado enquanto nenhum adquirente real estiver aprovado;
- API `/api/payments` protegida por authentication + tenancy;
- runtime marker e CI avançados para BLK-150.

## Evidência de validação
GitHub Actions run `33226746592` no commit `21178c9107d9baedef50823a1eba9a3163c14948`:
- Build: PASS;
- Typecheck: PASS;
- Test Files: 15/15 PASS;
- Tests: 90/90 PASS;
- Payments: 6/6 PASS;
- Runtime security boundaries: PASS;
- runtime block `BLK-150`: PASS;
- `/api/payments` sem sessão: 401 `SESSION_REQUIRED`.

## Segurança preservada
- frontend não confirma pagamento;
- provider payload não vira fonte de verdade diretamente;
- nenhum segredo/token real versionado;
- erros desconhecidos do provider são sanitizados;
- tenant isolation aplicado a Payment e webhook event.

## Limitações conhecidas
- nenhum adquirente real, credencial, Pix real ou link real foi conectado/testado;
- Firestore não foi testado contra projeto/credenciais reais;
- a unicidade de `idempotencyKey` no Firestore é garantida logicamente pela consulta anterior à criação, mas ainda não por transação/claim atômico sob concorrência distribuída;
- deduplicação de webhook também deve ganhar claim transacional antes de tráfego distribuído real;
- o webhook HTTP permanece atrás de sessão/tenant nesta fundação; exposição pública de webhook de provedor exigirá resolução segura de tenant por conexão/provedor e assinatura antes de ser habilitada;
- Sale completa e vínculo definitivo `saleId` continuam para evolução futura; o pagamento atual referencia a Quote aceita.

## Conclusão
BLK-150 está pronto e validado dentro do escopo autorizado. Nenhuma integração financeira real foi falsamente declarada como testada. Próximo bloco oficial: BLK-160 — Revenue Expansion, somente após autorização do Diretor.
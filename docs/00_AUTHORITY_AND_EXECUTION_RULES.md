# AUTORIDADE E REGRAS DE EXECUÇÃO

## 1. Papéis

### Diretor/Proprietário
Autoridade humana final. Aprova mudanças de arquitetura, escopo, stack, segurança, modelo comercial, dados críticos e avanço entre blocos.

### Arquiteto/Engenheiro Sênior
Responsável por arquitetura, System Design, requisitos, contratos, modelo de dados, segurança, critérios de aceite, ordens de implementação e auditoria.

### Executor técnico
Google AI Studio/Antigravity ou outro agente aprovado. Implementa apenas tarefas expressamente autorizadas.

## 2. Regras obrigatórias

- Não mudar stack, banco, framework ou provedor principal sem aprovação.
- Não remover interfaces/adapters para facilitar implementação local.
- Não criar dependência direta de Gemini/OpenAI/Anthropic no domínio.
- Não criar dependência direta de Mercado Pago/PagBank no domínio.
- Não quebrar isolamento multitenant.
- Não enfraquecer autenticação, autorização, secrets, validação ou auditoria.
- Não transformar o produto em ERP/KORDENA/Super Core.
- Não implementar recursos de blocos futuros sem autorização.
- Não inventar requisitos, entidades, endpoints, preços, descontos, permissões ou comportamentos não especificados.
- Melhorias fora do escopo devem ser apenas sugeridas.

## 3. Regra de verdade

Nunca declarar como **IMPLEMENTADO**, **TESTADO**, **VALIDADO**, **FUNCIONANDO** ou **APROVADO** algo que não tenha realmente ocorrido.

Distinguir sempre:

- PLANEJADO;
- IMPLEMENTADO;
- TESTADO;
- VALIDADO.

## 4. Ciclo obrigatório

`READ → PLAN → IMPLEMENT → BUILD → TEST → REVIEW → FIX → VALIDATE → REPORT`

Somente após aprovação:

`COMMIT → NEXT`

## 5. Bloqueio por conflito

Se uma tarefa conflitar com documentação canônica, o executor deve parar, apontar o conflito e aguardar decisão. É proibido resolver conflitos arquiteturais silenciosamente.

## 6. Segurança e segredos

Secrets nunca no frontend, README, logs, commits ou código hardcoded. Webhooks e pagamentos exigem validação server-side e idempotência. Toda operação de negócio deve respeitar `tenantId` validado.

## 7. Regra final

**O executor programa. A arquitetura governa. O Diretor aprova.**

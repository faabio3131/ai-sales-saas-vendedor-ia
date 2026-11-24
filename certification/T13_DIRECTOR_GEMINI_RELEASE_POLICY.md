# T13.7 — política de release assinável com auditoria Gemini e autorização do diretor

**Escopo:** permite apenas o selamento/publicação de imagem OCI assinada, sem deploy e sem go-live.
É uma alternativa controlada à revisão GitHub APPROVED de outro usuário para o repositório privado operado exclusivamente pelo diretor.

## Proveniência honesta
O parecer Gemini foi transcrito pelo responsável em conversa e representado por
certification/t13-gemini-owner-transcribed-audit.json. Ele **não** tem assinatura criptográfica do Gemini.
O gate não fabrica uma revisão GitHub. A declaração externa é autenticada pelo responsável
por meio de comentário de aprovação da conta proprietária no GitHub, vinculado ao digest SHA-256
da transcrição e ao HEAD exato da PR de governança.

## Condições obrigatórias para o selo
1. Execução manual workflow_dispatch em main iniciada por faabio3131; environment
   t13-release-signing existente e SHA idêntico ao GITHUB_SHA e input.
2. A PR de governança deve estar merged em main com SHA de merge igual ao SHA de release.
3. A PR original #29 deve ser a0e335d (HEAD auditado), merge dbe52a89..., CI push SUCCESS.
4. A comparação GitHub (merge-base e lista completa de arquivos) desde dbe52a89 até o SHA do selo pode alterar somente a lista fechada de arquivos
   de política, documentação, CI e metadados de certificação. **Qualquer alteração em src/,
   serviços de pagamentos, firewalls, imagem de runtime ou outra configuração não listada bloqueia**.
5. Comentário da conta GitHub proprietária em PR #29 com corpo exato
   T13-DIRECTOR-SIGNED-RELEASE-ATTESTATION/V1, sem edição, declarando
   SHA do HEAD da PR de governança, digest da transcrição, escopo SIGNED_OCI_RELEASE_ONLY
   e que deploy/go-live NÃO estão autorizados.
6. CI pós-merge do SHA de release aprovada, mais dependências, scanners e regras candidatas
   Firestore (offline) válidas; assinatura Cosign, digest OCI imutável e provenance/SBOM.
7. Caso exista APPROVED de revisor GitHub independente e reviewers de environment,
   o caminho anterior continua válido, sem usar a exceção.

## Limites
O release de imagem é uma ação de supply-chain, distinta de sua ativação real.
O workflow de deploy mantém a revisão própria e verifica regras ativas reais, assinatura,
atestado, acesso SSH e rollback. **A autorização da diretoria para o selo não substitui
uma autorização específica de deploy.** Não iniciar workflow de produção automaticamente.
A CI executa testes negativos de autorização falsa, dados adulterados, PR diferente,
cobertura incompleta, código src alterado, hash incorreto e evento não manual.

## Formato da assinatura da diretoria
Use o SHA-256 da transcrição exibido na CI do branch da PR de governança e o HEAD exato da
mesma PR para publicar o comentário no histórico da PR #29. O gate consulta a API GitHub
e verifica conta proprietária, author_association OWNER, integridade e ausência de edição.

## Compatibilidade com repositório privado pessoal — attestations de imagem

O workflow #45283271550 demonstrou que o serviço GitHub Artifact Attestations
falha em repositórios privados de conta pessoal (mesmo com `attestations: write`).
A assinatura Cosign e a publicação no GHCR chegaram a passar, mas a etapa
`actions/attest-build-provenance` falhou: nenhuma certificação final foi emitida.

A correção mantém a imagem privada e troca os dois atestados GitHub por **atestados
OCI Sigstore/Cosign keyless**, associados ao **digest exato** da imagem publicada:
proveniência do próprio workflow em formato SLSA v1 e SBOM CycloneDX.
Os dois predicados são assinados usando GitHub OIDC, verificados por identidade
exata do workflow e issuer e **analisados semanticamente** para comparar commit,
imagem, repositório, caminho do workflow e conteúdo do SBOM. O selo armazena
o SHA256 do predicado e o digest do artefato.

Isso **não é** um atestado do serviço GitHub, não alega SLSA Build Level 3 e
não altera a autenticação nem libera o deploy. O workflow de deploy permanece
com guardas separados, regras Firestore ativas, verificação Cosign das duas
attestations e gate de autorização próprio.

Não tornar o repositório público como correção do erro.

## Produção governada — proposta para revisão independente

A rota de revisão GitHub independente permanece disponível. A rota de diretor único exige cumulativamente: o parecer histórico Gemini transcrito e autenticado, comparação fechada de arquivos de política, novo aceite de selagem do HEAD de governança, CI push SUCCESS no SHA exato, run de selagem manual SUCCESS para o mesmo SHA e artefato não expirado. O deploy usa `expected_sha`, `image_digest`, `seal_run_id`, `seal_run_attempt`. O digest deve ter assinatura Cosign e provenance SLSA verificada com o invocationId exato do run/attempt, além do SBOM. Nenhuma alteração em src/ é implicitamente aprovada.

O ambiente `t13-production-approval` deve estar protegido por required reviewers, incluindo a conta proprietária `faabio3131`. Não se remove a proteção nem se utiliza bypass administrativo. No modelo de único diretor, a própria conta poderá aprovar a execução manual que iniciou se a política do ambiente permitir; isto é aprovação humana de implantação, **não** uma segunda revisão independente. Se prevent self-review estiver ativo, a execução fica bloqueada até aprovação por revisor elegível ou decisão explícita da autoridade sobre essa configuração. Segredos permanecem no ambiente protegido/host.

Após revisão independente Gemini do HEAD final de governança, a autoridade humana registra o comentário de aprovação nativo em **Review deployments**, exatamente no formato abaixo (preencher valores reais, nunca declarar a revisão antes de ocorrer). A API de histórico de approvals deve comprovar a conta proprietária, o ID do ambiente, estado approved e conteúdo integral. A primeira tentativa do rollout é obrigatória para a rota do diretor; falhas exigem novo dispatch e novo aceite, não rerun. Nenhuma aprovação de produção é inferida da conversa, do seal ou de um comentário genérico.

```text
T13-DIRECTOR-PRODUCTION-APPROVAL/V1
repository=faabio3131/ai-sales-saas-vendedor-ia
commit=<merge SHA>
image-digest=<sha256:...>
seal-run=<run ID>
seal-attempt=<attempt>
governance-pr-head=<PR HEAD>
audit-evidence-sha256=<SHA256 da transcrição original>
policy-review=GEMINI_REVIEWED_EXACT_GOVERNANCE_HEAD
decision=AUTHORIZE_CONTROLLED_PRODUCTION_DEPLOY
commercial-go-live=NOT_AUTHORIZED
```

A autorização de produção não dispensa verificação Firestore ativa, verificação OCI, SSH com known_hosts e rollback. Não ativa pagamentos reais, WhatsApp ou go-live comercial. A nova política não é certificada até CI, revisão independente e autorização humana do HEAD final.

## Revisão externa nova, com escopo exato — V2 (candidata)

Quando a PR altera arquivos não cobertos pela prova histórica, não ampliar a allowlist antiga. O Diretor deve obter de Gemini (ou usar revisão GitHub independente) um parecer NOVO do HEAD exato, incluindo todos os arquivos e o resultado da CI. Antes do merge, o proprietário publica manualmente, como comentário não editado na própria PR, o cabeçalho `T13-DIRECTOR-TRANSCRIBED-GEMINI-AUDIT/V2` seguido de uma nova linha e um objeto JSON:

- repository, pullRequest (inteiro), auditedHead, auditedBase (main antes do merge);
- candidateCiRunId (string), candidateCiAttempt (inteiro);
- auditor: "Gemini"; verdict: "APPROVED_FOR_MERGE"; findings: {"critical":0,"high":0,"medium":0};
- auditedFiles: lista completa dos caminhos alterados; report: texto integral do parecer real (mínimo 300 caracteres);
- productionDeploymentAuthorized: false; commercialActivationAuthorized: false.

Após o parecer, o Diretor registra comentário separado com corpo exato produzido por freshSignoffBody(report, sha256(corpo integral do comentário de parecer)). O hash é dos bytes UTF-8 exatos, sem newline acrescentado ao final. O gate usa a identidade GitHub do proprietário, CI da PR concluída antes do parecer, lista completa de arquivos, primeiro pai do merge e igualdade da árvore do HEAD auditado com a árvore do merge. Exige ambiente protegido com required reviewer proprietário também na selagem. O parecer continua sendo declaração transcrita pelo Diretor, não assinatura de Gemini; não criar parecer fictício ou autorização automaticamente. O fluxo V1 restrito continua sem alteração de escopo.

Na produção, o comentário nativo usa o mesmo formato V1, trocando somente o cabeçalho por T13-DIRECTOR-PRODUCTION-APPROVAL/V2 e a linha policy-review por policy-review=GEMINI_REVIEWED_EXACT_PR_HEAD. O digest de auditoria é o hash do novo parecer V2. Todos os demais controles de CI push, run de selagem, OCI, aprovação nativa, tentativa única e bloqueio comercial continuam obrigatórios.

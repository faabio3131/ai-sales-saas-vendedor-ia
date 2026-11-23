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
4. O diff desde dbe52a89 até o SHA do selo pode alterar somente a lista fechada de arquivos
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

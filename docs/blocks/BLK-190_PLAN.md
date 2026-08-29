# BLK-190 — Pilot — Plano

**Status:** AUTORIZADO PARA IMPLEMENTAÇÃO

## Objetivo
Preparar e validar o sistema para um piloto controlado com empresas reais, sem declarar produção comercial antes de integração e operação reais.

## Escopo
- checklist operacional de prontidão do piloto;
- endpoint protegido e tenant-scoped para leitura da prontidão;
- verificação estrutural de configuração de sessão, Firebase, WhatsApp, IA e pagamentos sem expor segredos;
- critérios objetivos de go/no-go;
- testes de segurança, sanitização e tenant boundary;
- runtime marker BLK-190 e CI correspondente;
- documentação do roteiro de piloto e evidências necessárias.

## Regras de verdade
- CI verde não equivale a piloto real executado;
- integração estrutural não equivale a credencial/provedor real validado;
- nenhum segredo deve ser retornado pela API ou versionado;
- o piloto só pode ser marcado GO quando todos os requisitos obrigatórios do ambiente real forem confirmados.

## Fora de escopo
- rollout comercial aberto;
- billing comercial definitivo;
- ativação de adquirente/WhatsApp real sem credenciais fornecidas e ambiente aprovado;
- inventar empresa piloto ou resultado comercial.

## Gates
Architecture, Tenant, Security, Test, Documentation e Git obrigatoriamente verdes.

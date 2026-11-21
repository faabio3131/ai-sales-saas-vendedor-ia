# PagBank, Santander e Itaú — estado de engenharia

## PagBank
Adaptador de Orders API implementado e vinculado ao roteador multi-tenant via PaymentAdapterFactory. Cobra Pix usando /orders, exige perfil faturamento verificado do comprador (nome, email, CPF/CNPJ e telefone), recupera QR Pix da resposta, consulta /orders/:id e reconcilia valor em centavos, referência e estado da cobrança. Requer autorização comercial, conta PagBank com chave Pix e credencial em cofre. Webhook do PagBank permanece não habilitado até verificação de autenticação e processamento idempotente. Pagamento real não homologado.

## Santander
Banco confirmado como candidato da API Pix Recebimentos/QR Code, porém os contratos exatos de URL e autenticação por produto/conta ainda precisam ser obtidos no Developer Portal/convênio. Registrado como CONTRACT_PENDING: não ativar, não reutilizar cegamente endpoints de Efí, Inter ou BB. O padrão Pix Cob e o contrato de normalização existente serão reusados mediante certificação específica.

## Itaú
Banco confirmado como candidato API Pix Recebimentos. Autenticação mTLS com certificado dinâmico e token curto requer habilitação OfficerCash e endpoint de produto. Não assumir que o OAuth genérico de bancos se aplica ao Itaú. Registrado como CONTRACT_PENDING até obter contrato de integração e sandbox/credenciais, mantendo fail-closed.

Fontes: 
- https://developer.pagbank.com.br/reference/criar-pedido-com-qr-code-pix-v2
- https://developer.pagbank.com.br/reference/consultar-pedido
- https://developer.santander.com.br/api/visao-geral/pix-visao-geral
- https://devportal.itau.com.br/autenticacao-documentacao

Status de todos: integração interna NÃO é homologação bancária ou deploy. Sem recibos falsos, sem alteração de conta bancária e sem credenciais no GitHub.

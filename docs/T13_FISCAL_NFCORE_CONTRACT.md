# T13.5 — Fiscal source contract for NFCore (internal; no issuance)

The AtendeVendeIA role is **producer of auditable commercial source facts**. NFCore is
the separate fiscal engine and authority for tax classification, readiness, document
choice and emission. None of the events below authorizes an NF-e, NFC-e or NFS-e.
No NFCore API credential or commercial activation is presumed.

| Vertical/source | Intent state | Potential document | Important limitation |
|---|---|---|---|
| Retail, PSP GET verified and completed | PENDING_FISCAL_CLASSIFICATION | NFC-e/NF-e | NFCore still requires taxpayer, jurisdiction, fiscal recipient, tax codes, readiness |
| Retail, manually recorded | BLOCKED_MANUAL_SETTLEMENT_REVIEW | NFC-e/NF-e | Merchant declaration is **not** PSP/bank settlement proof |
| Service booking completed | BLOCKED_SERVICE_NFSE_CONTRACT | NFS-e only | Deposit is **partial**, and services contract/jurisdiction must be confirmed |
| Service without price | BLOCKED_AMOUNT_INTEGRITY | NFS-e candidate only | Cannot invent the amount |
| Existing food quote sale | PENDING_FISCAL_CLASSIFICATION or BLOCKED_UNSUPPORTED_SALE_CONTENT | NFC-e/NF-e | Existing sales pack does not authorize services |

Internal implementation: transactional source facts in `multisectorFiscalIntents`
during first retail/service completion, linked to tenant, unit, original source,
version and fingerprint. Every record states
`automaticIssuanceAuthorized=false`, `externalFiscalDocumentId=null`,
`nfcoreCapabilityCheckRequired=true` and `fiscalScopeBindingRequired=true`.
The adapter must never issue solely because a payment was settled.

Before any eventual real NFCore call: business fiscal identity, correct issuer
tenant/unit, approved document kind and NFCore use case, legal authorization,
tax code and municipal/UF readiness, NFCore-issued idempotency token and a real
NFCore acknowledgement. Refund, fiscal cancellation and adjustment are different
state machines and must not be inferred from a PSP payment status. NFCore
credential onboarding, taxpayer approval, regulatory homologation and
production go-live are **external** tasks; unimplemented adapter and the
acknowledged fiscal document response remain **internal** delivery gaps for
a future full end-to-end issuance claim.

Internal T13.5 contract reconciliation does not certify fiscal issuance.

## Historical PSP credential provenance — T13.2
The historic PSP resolver can automatically reopen an archived connection **only**
when it contains an immutable, explicitly numbered Google Secret Manager secret
version, passes the tenant/provider/recipient binding and matches the stored
connection fingerprint. Operations can provision that reference using
`attachVault(tenant, provider, 'GOOGLE', projectId, secretVersion)`.

`/versions/latest`, mutable mounted files and legacy records without a
verified binding MUST fail closed and enter human financial reconciliation.
No client API may select an arbitrary vault path or supply raw bank secrets.
Preservation of old immutable secret versions is an operational requirement.

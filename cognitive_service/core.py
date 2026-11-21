"""Commercial reasoning baseline, context evidence and safe response validation.

Ported patterns (not fiscal business rules) from FM Core Base and NFCore:
tenant scope, evidence provenance, sensitive-data redaction and deterministic fallback.
No provider secret, payment, tenant database write or privileged tool is reachable here.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

CONTRACT = "atendevende.cognitive/v1"
STAGES = {
    "NOVO": ("QUALIFY", "O cliente ainda precisa ser qualificado.", 0.9),
    "CONVERSANDO": ("RESPOND", "A conversa precisa de continuidade.", 0.85),
    "QUALIFICADO": ("CREATE_QUOTE", "A oportunidade está pronta para análise de proposta.", 0.85),
    "PROPOSTA": ("FOLLOW_UP", "Há proposta aguardando acompanhamento.", 0.8),
    "AGUARDANDO_CLIENTE": ("FOLLOW_UP", "A resposta do cliente está pendente.", 0.8),
    "RECUPERACAO": ("RECOVER", "A oportunidade está em recuperação.", 0.9),
    "FECHADO": ("NO_ACTION", "A oportunidade já foi encerrada.", 1),
    "PERDIDO": ("NO_ACTION", "Oportunidade encerrada sem autorização de reativação.", 1),
}
REFERENCE = re.compile(r"^[a-zA-Z0-9_:-]{1,128}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")

class CognitiveValidationError(ValueError):
    pass

def _safe_str(value: Any, max_len: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > max_len:
        raise CognitiveValidationError("invalid_field")
    return value.strip()

def _valid_request(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) != {
        "contractVersion", "tenantId", "requestId", "capability", "contextPack"
    }:
        raise CognitiveValidationError("invalid_envelope")
    if payload["contractVersion"] != CONTRACT:
        raise CognitiveValidationError("contract_mismatch")
    tenant = _safe_str(payload["tenantId"], 128)
    request_id = _safe_str(payload["requestId"], 128)
    if not REFERENCE.fullmatch(tenant) or not REFERENCE.fullmatch(request_id):
        raise CognitiveValidationError("invalid_scope")
    if payload["capability"] != "GENERAL_REASONING":
        raise CognitiveValidationError("capability_unavailable")
    pack = payload["contextPack"]
    if not isinstance(pack, dict) or set(pack) != {
        "contextHash", "evidenceIds", "trustedFacts", "untrustedData", "scopeTenantId"
    }:
        raise CognitiveValidationError("invalid_context")
    if pack["scopeTenantId"] != tenant:
        raise CognitiveValidationError("scope_mismatch")
    if not isinstance(pack["contextHash"], str) or not SHA256.fullmatch(pack["contextHash"]):
        raise CognitiveValidationError("invalid_context_hash")
    ids = pack["evidenceIds"]
    if not isinstance(ids, list) or len(ids) > 16 or len(ids) != len(set(str(x) for x in ids)):
        raise CognitiveValidationError("invalid_evidence")
    if not all(isinstance(x, str) and REFERENCE.fullmatch(x) for x in ids):
        raise CognitiveValidationError("invalid_evidence")
    facts = pack["trustedFacts"]
    data = pack["untrustedData"]
    if not isinstance(facts, str) or len(facts) > 16384 or not isinstance(data, str) or len(data) > 32768:
        raise CognitiveValidationError("context_too_large")
    expected = hashlib.sha256(
        json.dumps({
            "tenantId": tenant, "evidenceIds": ids, "trustedFacts": facts, "untrustedData": data
        }, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    if pack["contextHash"] != expected:
        raise CognitiveValidationError("context_hash_mismatch")
    return payload

def decide(payload: Any) -> dict[str, Any]:
    """Return a *proposal*, never an executed operation or fabricated commercial fact."""
    req = _valid_request(payload)
    pack = req["contextPack"]
    try:
        data = json.loads(pack["untrustedData"])
    except (ValueError, TypeError) as exc:
        raise CognitiveValidationError("invalid_input") from exc
    if not isinstance(data, dict):
        raise CognitiveValidationError("invalid_input")
    stage = data.get("stage")
    objection = data.get("objection")
    if isinstance(objection, str) and objection.strip():
        action, reason, confidence = ("RESPOND", "Há uma objeção comercial a esclarecer.", 0.8)
    elif isinstance(stage, str) and stage in STAGES:
        action, reason, confidence = STAGES[stage]
    else:
        action, reason, confidence = ("REQUEST_HUMAN", "Faltam dados confiáveis para decidir.", 1)
    return {
        "contractVersion": CONTRACT,
        "requestId": req["requestId"],
        "provider": "fm-cognitive",
        "model": "commercial-baseline-v1",
        "structuredData": {
            "action": action,
            "reason": reason,
            "confidence": confidence,
        },
        "provenance": {
            "contextHash": pack["contextHash"],
            "evidenceIds": pack["evidenceIds"],
            "origin": "DETERMINISTIC_BASELINE",
        },
        # Model-token usage is not measured for a deterministic rule engine.
        "usage": {
            "costMicroUsd": 0,
            "costSource": "NO_PAID_MODEL",
        },
    }

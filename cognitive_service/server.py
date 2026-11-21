"""Small private HTTP boundary for the commercial cognitive baseline.

Run: COGNITIVE_S2S_SECRET=... python3 -m cognitive_service.server
Default binding is 127.0.0.1:8185. TLS termination, IAM and firewall are deployment concerns.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .core import CognitiveValidationError, decide

MAX_BODY = 65536
SIGNATURE = re.compile(r"^t=(\d{10}),nonce=([0-9a-f]{32}),v1=([0-9a-f]{64})$")
REPLAY_LOCK = threading.Lock()
SEEN_NONCES: dict[str, int] = {}

def validate_signature(header: str, raw: bytes, secret: bytes, now: int | None = None) -> bool:
    match = SIGNATURE.fullmatch(header)
    if not match:
        return False
    timestamp, nonce, digest = match.groups()
    current = int(time.time()) if now is None else now
    when = int(timestamp)
    if current - when > 300 or when - current > 30:
        return False
    expected = hmac.new(secret, (timestamp + "." + nonce + ".").encode("ascii") + raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, digest):
        return False
    with REPLAY_LOCK:
        expired = [k for k, until in SEEN_NONCES.items() if until <= current]
        for k in expired:
            SEEN_NONCES.pop(k, None)
        if nonce in SEEN_NONCES:
            return False
        SEEN_NONCES[nonce] = current + 330
    return True

class CognitiveHandler(BaseHTTPRequestHandler):
    secret: bytes = b""

    def log_message(self, format: str, *args: object) -> None:
        # Never print request URLs, authorization headers, body or personal data.
        pass

    def _send(self, status: int, payload: dict[str, object]) -> None:
        raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(200, {"status": "ok", "contractVersion": "atendevende.cognitive/v1"})
        else:
            self._send(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path != "/v1/execute":
            self._send(404, {"error": "not_found"})
            return
        length = self.headers.get("Content-Length", "")
        if not length.isdecimal() or int(length) < 1 or int(length) > MAX_BODY:
            self._send(413, {"error": "invalid_body_size"})
            return
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            self._send(415, {"error": "unsupported_media_type"})
            return
        raw = self.rfile.read(int(length))
        if not validate_signature(self.headers.get("X-AV-Signature", ""), raw, self.secret):
            self._send(401, {"error": "invalid_signature"})
            return
        try:
            body = json.loads(raw)
            result = decide(body)
        except (json.JSONDecodeError, CognitiveValidationError):
            self._send(422, {"error": "invalid_request"})
            return
        except Exception:
            self._send(503, {"error": "cognitive_unavailable"})
            return
        self._send(200, result)

def run() -> None:
    secret = os.environ.get("COGNITIVE_S2S_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("A COGNITIVE_S2S_SECRET with at least 32 characters is required.")
    host = os.environ.get("COGNITIVE_SERVICE_HOST", "127.0.0.1")
    if host not in ("127.0.0.1", "localhost", "::1") and os.environ.get("COGNITIVE_ALLOW_NON_LOOPBACK") != "true":
        raise RuntimeError("Non-loopback binding requires explicitly authorized private networking.")
    port = int(os.environ.get("COGNITIVE_SERVICE_PORT", "8185"))
    CognitiveHandler.secret = secret.encode("utf-8")
    server = ThreadingHTTPServer((host, port), CognitiveHandler)
    server.serve_forever(poll_interval=0.2)

if __name__ == "__main__":
    run()

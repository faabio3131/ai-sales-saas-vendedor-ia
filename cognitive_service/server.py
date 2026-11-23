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
from socket import timeout as SocketTimeout

from .core import CognitiveValidationError, decide
from .replay import ReplayStore, create_replay_store

MAX_BODY = 65536
SIGNATURE = re.compile(r"^t=(\d{10}),nonce=([0-9a-f]{32}),v1=([0-9a-f]{64})$")
REPLAY_LOCK = threading.Lock()
SEEN_NONCES: dict[str, int] = {}
MAX_NONCES = 100_000

def validate_signature(header: str, raw: bytes, secret: bytes, now: int | None = None,
                       store: ReplayStore | None = None) -> bool:
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
    if store is not None:
        try:
            # Single atomic SET NX EX is the distributed linearization point.
            return store.claim(nonce)
        except (OSError, ValueError, TimeoutError):
            # Never allow a broken replay backend to authorize a transaction.
            return False
    with REPLAY_LOCK:
        expired = [k for k, until in SEEN_NONCES.items() if until <= current]
        for k in expired:
            SEEN_NONCES.pop(k, None)
        if nonce in SEEN_NONCES or len(SEEN_NONCES) >= MAX_NONCES:
            return False
        SEEN_NONCES[nonce] = current + 330
    return True

class BoundedCognitiveServer(ThreadingHTTPServer):
    """Bound active HTTP requests; private network remains mandatory."""
    request_queue_size = 32
    daemon_threads = True

    def __init__(self, address, handler, max_workers=16):
        self.slots = threading.BoundedSemaphore(max_workers)
        super().__init__(address, handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class CognitiveHandler(BaseHTTPRequestHandler):
    timeout = 5
    secret: bytes = b""
    replay_store: ReplayStore | None = None

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
        try:
            raw = self.rfile.read(int(length))
        except (SocketTimeout, OSError):
            self.close_connection = True
            return
        if len(raw) != int(length):
            self._send(400, {"error": "incomplete_body"})
            return
        if not validate_signature(self.headers.get("X-AV-Signature", ""), raw, self.secret,
                                  store=self.replay_store):
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
    CognitiveHandler.replay_store = create_replay_store(host)
    server = BoundedCognitiveServer((host, port), CognitiveHandler)
    server.serve_forever(poll_interval=0.2)

if __name__ == "__main__":
    run()

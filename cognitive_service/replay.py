"""Distributed, atomic nonce consumption for the cognitive S2S signature boundary.

Production non-loopback service requires a Redis shared store over TLS.
No request body, tenant record or secret is persisted as a replay key.
"""
from __future__ import annotations

import hashlib
import os
import socket
import ssl
from pathlib import Path
from urllib.parse import unquote, urlsplit
from typing import Protocol


class ReplayStore(Protocol):
    def claim(self, nonce: str) -> bool: ...


class RedisReplayStore:
    """Redis SET <digest> 1 NX EX 360. A server outage fails closed."""

    def __init__(self, url: str, timeout: float = 0.8) -> None:
        parsed = urlsplit(url)
        if parsed.scheme not in ("redis", "rediss") or not parsed.hostname:
            raise ValueError("Invalid cognitive replay backend.")
        if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise ValueError("Replay backend must not select a different database.")
        # A Redis connection across hosts must use authenticated TLS.
        if parsed.scheme == "redis" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError("Remote cognitive replay storage requires rediss TLS.")
        self.host = parsed.hostname
        if parsed.scheme == "rediss" and parsed.port is None:
            raise ValueError("Explicit TLS replay port is required.")
        self.port = parsed.port or 6379
        self.tls = parsed.scheme == "rediss"
        self.username = unquote(parsed.username) if parsed.username else ""
        self.password = unquote(parsed.password) if parsed.password else ""
        password_file = os.environ.get("COGNITIVE_REPLAY_PASSWORD_FILE")
        if password_file:
            filename = Path(password_file)
            metadata = filename.lstat()
            if not filename.is_file() or filename.is_symlink() or metadata.st_mode & 0o077:
                raise ValueError("Unsafe replay credentials file.")
            self.password = filename.read_text(encoding="utf-8").strip()
        if self.tls and not self.password:
            raise ValueError("Remote replay store must have credentials.")
        self.timeout = timeout

    @staticmethod
    def _encode(*args: str) -> bytes:
        payload = [f"*{len(args)}\r\n".encode()]
        for arg in args:
            raw = arg.encode("utf-8")
            payload.extend([f"${len(raw)}\r\n".encode(), raw, b"\r\n"])
        return b"".join(payload)

    @staticmethod
    def _receive(reader) -> str | None:
        response = reader.readline(1024)
        if response == b"$-1\r\n":
            return None
        if not response.endswith(b"\r\n") or len(response) > 1024:
            raise OSError("Invalid replay store response.")
        if response.startswith(b"-"):
            raise OSError("Replay store rejected command.")
        if not response.startswith(b"+"):
            raise OSError("Unexpected replay store response.")
        return response[1:-2].decode("ascii")

    def claim(self, nonce: str) -> bool:
        digest = hashlib.sha256(nonce.encode("ascii")).hexdigest()
        key = "av:cognitive:replay:v1:" + digest
        with socket.create_connection((self.host, self.port), timeout=self.timeout) as connected:
            connected.settimeout(self.timeout)
            if self.tls:
                tls = ssl.create_default_context().wrap_socket(connected, server_hostname=self.host)
                sock = tls
            else:
                sock = connected
            with sock, sock.makefile("rb") as reader:
                if self.password:
                    command = ("AUTH", self.username, self.password) if self.username else ("AUTH", self.password)
                    sock.sendall(self._encode(*command))
                    if self._receive(reader) != "OK":
                        raise OSError("Replay store authorization failed.")
                sock.sendall(self._encode("SET", key, "1", "NX", "EX", "360"))
                return self._receive(reader) == "OK"


def create_replay_store(bind_host: str) -> ReplayStore | None:
    url = os.environ.get("COGNITIVE_REPLAY_REDIS_URL", "")
    if url:
        return RedisReplayStore(url)
    if bind_host not in ("127.0.0.1", "localhost", "::1"):
        raise RuntimeError("Shared Redis replay storage is mandatory on non-loopback cognitive runtimes.")
    return None

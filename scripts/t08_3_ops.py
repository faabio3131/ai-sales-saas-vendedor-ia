#!/usr/bin/env python3
"""T08.3 guarded staging operations. Never changes a live traffic router."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen

IMAGE = re.compile(r"^[a-zA-Z0-9._:/-]+@sha256:[0-9a-f]{64}$")
PROJECT = re.compile(r"^[a-z][a-z0-9-]{4,62}$")
PREFIX = re.compile(r"^gs://[a-z0-9][a-z0-9._-]{2,222}/[a-zA-Z0-9_./-]+$")
COMPOSE = "deploy/t08-3-staging.compose.yaml"
DEFAULT_STATE = ".t08-3/staging-state.json"

class GuardError(Exception):
    pass

def require_project(value: str) -> str:
    if not PROJECT.fullmatch(value) or "staging" not in value.lower() or "prod" in value.lower():
        raise GuardError("Project must be an explicitly named staging Firebase project.")
    return value

def require_image(value: str) -> str:
    if not IMAGE.fullmatch(value):
        raise GuardError("Certified OCI image digest (repository@sha256:64-hex) required.")
    return value

def require_bucket(value: str) -> str:
    if not PREFIX.fullmatch(value) or ".." in value or "//" in value[5:]:
        raise GuardError("A safe gs://bucket/prefix URI is required.")
    return value.rstrip("/")

def require_execution(args: argparse.Namespace) -> bool:
    if not args.execute:
        return False
    if not args.confirm_staging:
        raise GuardError("--confirm-staging is required for execution.")
    return True

def run_command(cmd: list[str], env: dict[str,str] | None = None) -> str:
    result = subprocess.run(cmd, check=True, capture_output=True, text=True, env=env)
    return result.stdout

def wait_health(port: int, timeout: int = 45) -> None:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as r:
                response = json.load(r)
                if r.status == 200 and response.get("status") == "ok" and response.get("governance",{}).get("tenantIsolationEnforced") is True:
                    return
        except (OSError, ValueError, TimeoutError):
            pass
        time.sleep(1)
    raise GuardError("Staging health and tenancy governance failed.")

def state_read(path: Path) -> dict:
    if not path.exists(): return {}
    obj = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(obj, dict): raise GuardError("Invalid local staging recovery state.")
    return obj

def state_write(path: Path, content: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".t08-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(content, f, sort_keys=True, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(temp, 0o600)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp): os.unlink(temp)

def compose_up(image: str, port: int, project: str) -> None:
    env = dict(os.environ, ATENDEVENDE_IMAGE=image, ATENDEVENDE_STAGING_PORT=str(port),
               FIREBASE_PROJECT_ID=project)
    # The compose file has hardcoded fail-closed live flags.
    run_command(["docker","compose","-p","atendevende-t083-staging","-f",COMPOSE,"config","--quiet"], env)
    run_command(["docker","compose","-p","atendevende-t083-staging","-f",COMPOSE,"up","-d","--no-build"], env)
    wait_health(port)

def deploy(args: argparse.Namespace, rollback: bool = False) -> None:
    project = require_project(args.project)
    if not 1025 <= args.port <= 65535: raise GuardError("Unprivileged staging-only host port required.")
    path = Path(args.state)
    prior = state_read(path)
    if prior and prior.get("project") != project:
        raise GuardError("Recovery state belongs to another staging project.")
    image = require_image(prior.get("previousImage","") if rollback else args.image)
    if rollback and image == prior.get("image"):
        raise GuardError("No distinct prior image is recorded for rollback.")
    plan = {"action": "rollback" if rollback else "deploy", "image":image,
            "project":project,"port":args.port,"publicTrafficSwitch":False,
            "liveFlags":False, "execute":bool(args.execute)}
    if not require_execution(args):
        print(json.dumps(plan, sort_keys=True)); return
    if len(os.environ.get("SESSION_SECRET","")) < 32:
        raise GuardError("An external staging-only SESSION_SECRET (32+ chars) is required.")
    try:
        compose_up(image,args.port,project)
    except Exception:
        old = prior.get("image")
        if old and old != image:
            try: compose_up(require_image(old),args.port,project)
            except Exception as error:
                raise GuardError("Candidate failed; automatic staging rollback also failed.") from error
        raise
    state_write(path,{"project":project,"port":args.port,"image":image,
                      "previousImage":prior.get("image") if not rollback else None,
                      "updatedAt":datetime.now(timezone.utc).isoformat(),
                      "publicTrafficSwitch":False,"liveFlags":False})
    print(json.dumps({"result":"STAGING_HEALTHY","image":image,"publicTrafficSwitch":False}))

def gcloud_wait(operation_name: str, project: str, max_polls: int = 60) -> None:
    if not operation_name.startswith("projects/") or "/operations/" not in operation_name:
        raise GuardError("Invalid Firestore operation response.")
    for _ in range(max_polls):
        response = json.loads(run_command(["gcloud","firestore","operations","describe",operation_name,
                                           "--project",project,"--format=json"]))
        if response.get("done"):
            if response.get("error"): raise GuardError("Firestore operation failed.")
            return
        time.sleep(5)
    raise GuardError("Firestore operation did not complete within polling limit.")

def firestore(args: argparse.Namespace, importing: bool) -> None:
    project = require_project(args.project)
    uri = require_bucket(args.uri)
    if importing:
        source = require_project(args.source_project)
        if source == project: raise GuardError("Restore drill requires a distinct isolated destination project.")
        if not args.restore_confirm: raise GuardError("Restore into a distinct staging project requires --restore-confirm.")
    operation = "import" if importing else "export"
    cmd = ["gcloud","firestore",operation,uri,"--project",project,
           "--database=(default)","--async","--format=json"]
    if not require_execution(args):
        print(json.dumps({"action":operation,"project":project,"uri":uri,
                          "execute":False,"command":cmd,"publicTrafficSwitch":False})); return
    response = json.loads(run_command(cmd))
    name = response.get("name","")
    gcloud_wait(name,project)
    evidence = {"action":operation,"project":project,"uri":uri,
                "sourceProject":args.source_project if importing else project,
                "operationName":name,"completedAt":datetime.now(timezone.utc).isoformat(),
                "result":"COMPLETED"}
    if args.evidence:
        state_write(Path(args.evidence),evidence)
    print(json.dumps(evidence,sort_keys=True))

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="action",required=True)
    for name in ("deploy","rollback","backup","restore"):
        s = sub.add_parser(name)
        s.add_argument("--project",required=True)
        s.add_argument("--execute",action="store_true")
        s.add_argument("--confirm-staging",action="store_true")
        if name in ("deploy","rollback"):
            s.add_argument("--state",default=DEFAULT_STATE)
            s.add_argument("--port",type=int,default=18080)
            if name == "deploy": s.add_argument("--image",required=True)
        else:
            s.add_argument("--uri",required=True)
            s.add_argument("--evidence")
            if name == "restore":
                s.add_argument("--source-project",required=True)
                s.add_argument("--restore-confirm",action="store_true")
    args = p.parse_args(argv)
    try:
        if args.action == "deploy": deploy(args)
        elif args.action == "rollback": deploy(args,True)
        elif args.action == "backup": firestore(args,False)
        else: firestore(args,True)
        return 0
    except (GuardError,subprocess.CalledProcessError,ValueError,KeyError) as e:
        print(f"T08.3 blocked: {e}",file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())

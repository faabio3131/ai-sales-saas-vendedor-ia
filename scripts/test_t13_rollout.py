"""Offline deterministic rollout integration tests. No real Docker or cloud calls."""
import os
import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "deploy/t13-controlled-deploy.sh"
IMAGE = "ghcr.io/faabio3131/ai-sales-saas-vendedor-ia@sha256:" + "a"*64
OLD = IMAGE[:-64] + "b"*64
SHA = "c"*40

MOCK = r'''#!/usr/bin/env python3
import os,sys,pathlib
a=sys.argv[1:]
p=pathlib.Path(os.environ["MOCK_LOG"])
with p.open("a") as f: f.write(" ".join(a)+"\n")
image=os.environ.get("ATENDEVENDE_IMAGE","")
state=p.parent/"running-image"
if not state.exists() and os.environ.get("MOCK_PREVIOUS"): state.write_text(os.environ["MOCK_PREVIOUS"])
mode=os.environ.get("MOCK_MODE","")
if a[:1]==["info"]: print('["name=rootless"]' if mode!="rootful" else '["name=seccomp"]')
elif a[:2]==["image","inspect"]: print(os.environ["T13_EXPECTED_SHA"])
elif a[:1]==["pull"]: pass
elif a[:1]==["inspect"]: print(((state.read_text() if state.exists() else image) if mode!="bad-worker-digest" or a[-1]!="payment-reconciler" else image+"bad")+" healthy")
elif a[:1]==["compose"]:
    assert a[1:3]==["-p","atendevende-t13"]
    cmd=a[7:]
    if cmd[:2]==["ps","-aq"]:
        if mode=="untracked": print("unknown")
    elif cmd[:2]==["ps","-q"]: print(cmd[-1])
    elif cmd[:1]==["up"]:
        if cmd[-1]=="atendevende-api" and mode=="api-fail": sys.exit(1)
        if cmd[-1]=="payment-reconciler" and mode=="rollback-fail": sys.exit(1)
        if cmd[-1]=="payment-reconciler" and mode=="worker-fail" and image.endswith("a"*64): sys.exit(1)
        state.write_text(image)
else: sys.exit(9)
'''
class RolloutTests(unittest.TestCase):
    def run_case(self,mode="",authority=True,previous=False,project="demo-test"):
        with tempfile.TemporaryDirectory() as t:
            root=pathlib.Path(t); bin_dir=root/"bin"; bin_dir.mkdir()
            deploy=root/"deploy"; deploy.mkdir()
            for n in ("t13-production.compose.yaml","payment-reconciler.compose.yaml"):
                (deploy/n).touch()
            for n in ("session","firebase"):
                (root/n).write_text("fixture"); (root/n).chmod(0o600)
            envfile=root/".t13-runtime.env"
            envfile.write_text("FIREBASE_PROJECT_ID=demo-test\nPUBLIC_APP_URL=https://example.invalid\n"
                "T13_SESSION_SECRET_FILE="+str(root/"session")+"\nPAYMENT_FIREBASE_CREDENTIAL_FILE="+str(root/"firebase")+"\n"
                "T13_WORKER_AUTHORITY_CONFIRMED="+str(authority).lower()+"\n")
            envfile.chmod(0o600)
            state=root/".t13-certified-image"
            if previous: state.write_text(OLD+"\n")
            tools={"docker":MOCK,"id":"#!/bin/sh\necho atendevende_t13\n","cosign":"#!/bin/sh\nexit 0\n",
                   "curl":"#!/bin/sh\nprintf '%s' '{\"status\":\"ok\",\"governance\":{\"tenantIsolationEnforced\":true}}'\n"}
            for name,content in tools.items():
                target=bin_dir/name; target.write_text(content); target.chmod(0o700)
            log=root/"calls"
            proc=subprocess.run(["bash",str(SCRIPT)],cwd=root,env={**os.environ,"PATH":str(bin_dir)+":"+os.environ["PATH"],
                "T13_IMAGE_REF":IMAGE,"T13_EXPECTED_SHA":SHA,"T13_EXPECTED_FIREBASE_PROJECT":project,"MOCK_LOG":str(log),"MOCK_MODE":mode,
                **({"MOCK_PREVIOUS":OLD} if previous else {})},capture_output=True,text=True,timeout=15)
            return proc, state.read_text().strip() if state.exists() else None, log.read_text() if log.exists() else ""
    def test_success(self):
        p,state,log=self.run_case()
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual(state,IMAGE)
        self.assertIn("T13_DEPLOY_HEALTH_VERIFIED",p.stdout)
    def test_authority_missing(self):
        p,state,log=self.run_case(authority=False)
        self.assertNotEqual(p.returncode,0)
        self.assertIsNone(state)
        self.assertEqual(log,"")
    def test_rootful_refused(self):
        p,state,log=self.run_case(mode="rootful")
        self.assertNotEqual(p.returncode,0)
        self.assertNotIn("compose",log)
    def test_first_rollout_worker_failure(self):
        p,state,log=self.run_case(mode="worker-fail")
        self.assertNotEqual(p.returncode,0)
        self.assertIsNone(state)
        self.assertIn("T13_FIRST_ROLLOUT_STOPPED",p.stderr)
        self.assertIn("stop payment-reconciler atendevende-api",log)
    def test_wrong_worker_digest(self):
        p,state,log=self.run_case(mode="bad-worker-digest")
        self.assertNotEqual(p.returncode,0)
        self.assertIsNone(state)
    def test_untracked_refused(self):
        p,state,log=self.run_case(mode="untracked")
        self.assertNotEqual(p.returncode,0)
        self.assertNotIn(" up ",log)
    def test_previous_rollout_restored(self):
        p,state,log=self.run_case(mode="worker-fail",previous=True)
        self.assertNotEqual(p.returncode,0)
        self.assertEqual(state,OLD)
        self.assertIn("T13_ROLLBACK_HEALTH_VERIFIED",p.stderr)
    def test_api_failure_stops_before_worker(self):
        p,state,log=self.run_case(mode="api-fail")
        self.assertNotEqual(p.returncode,0)
        self.assertIsNone(state)
        self.assertNotIn("--wait-timeout 600 payment-reconciler",log)
    def test_wrong_project_refused(self):
        p,state,log=self.run_case(project="other-project")
        self.assertNotEqual(p.returncode,0)
        self.assertIn("T13_FIREBASE_PROJECT_MISMATCH",p.stderr)
        self.assertEqual(log,"")
    def test_failed_rollback_not_certified(self):
        p,state,log=self.run_case(mode="rollback-fail",previous=True)
        self.assertNotEqual(p.returncode,0)
        self.assertEqual(state,OLD)
        self.assertIn("T13_ROLLBACK_FAILED_MANUAL_RECOVERY_REQUIRED",p.stderr)
        self.assertNotIn("T13_ROLLBACK_HEALTH_VERIFIED",p.stderr)

import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import t08_3_ops as o

IMAGE_A = "registry.example.test/atendevende@sha256:" + "a"*64
IMAGE_B = "registry.example.test/atendevende@sha256:" + "b"*64
PROJECT = "av-staging-isolated"

def call(*args):
    with contextlib.redirect_stdout(io.StringIO()) as output, contextlib.redirect_stderr(io.StringIO()):
        result = o.main(list(args))
    return result, output.getvalue()

class GuardTests(unittest.TestCase):
    def test_projects_and_digests_are_fail_closed(self):
        for value in ("app-prod","production-staging","project","bad_staging", "demo"):
            with self.assertRaises(o.GuardError): o.require_project(value)
        self.assertEqual(o.require_project(PROJECT), PROJECT)
        for value in ("latest","repo:latest","repo@sha256:abc"):
            with self.assertRaises(o.GuardError): o.require_image(value)

    def test_no_execute_does_not_spawn_processes_or_write_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory)/"state.json")
            with patch.object(o,"run_command",side_effect=AssertionError("NO IO")):
                code, output = call("deploy","--project",PROJECT,"--image",IMAGE_A,"--state",path)
                self.assertEqual(code,0)
                self.assertEqual(json.loads(output)["liveFlags"],False)
            self.assertFalse(Path(path).exists())

    def test_deploy_requires_confirmation_and_secret(self):
        self.assertEqual(call("deploy","--project",PROJECT,"--image",IMAGE_A,
                              "--execute")[0],2)
        with patch.dict(os.environ,{"SESSION_SECRET":""}):
            self.assertEqual(call("deploy","--project",PROJECT,"--image",IMAGE_A,
                              "--execute","--confirm-staging")[0],2)

    def test_staging_version_rotation_and_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            state = str(Path(directory)/"s.json")
            with patch.dict(os.environ,{"SESSION_SECRET":"x"*40}):
                with patch.object(o,"compose_up") as compose:
                    for image in (IMAGE_A, IMAGE_B):
                        self.assertEqual(call("deploy","--project",PROJECT,"--image",image,
                            "--state",state,"--execute","--confirm-staging")[0],0)
                    record=json.loads(Path(state).read_text())
                    self.assertEqual(record["image"],IMAGE_B)
                    self.assertEqual(record["previousImage"],IMAGE_A)
                    self.assertFalse(record["liveFlags"])
                    self.assertEqual(call("rollback","--project",PROJECT,"--state",state,
                        "--execute","--confirm-staging")[0],0)
                    self.assertEqual(json.loads(Path(state).read_text())["image"],IMAGE_A)
                    self.assertEqual(compose.call_count,3)

    def test_failed_deploy_restores_last_staging_image(self):
        with tempfile.TemporaryDirectory() as directory:
            state = str(Path(directory)/"s.json")
            o.state_write(Path(state),{"project":PROJECT,"port":18080,"image":IMAGE_A})
            events=[]
            def compose(image,port,project):
                events.append(image)
                if image == IMAGE_B: raise o.GuardError("health failed")
            with patch.dict(os.environ,{"SESSION_SECRET":"x"*40}),patch.object(o,"compose_up",side_effect=compose):
                self.assertEqual(call("deploy","--project",PROJECT,"--image",IMAGE_B,
                     "--state",state,"--execute","--confirm-staging")[0],2)
            self.assertEqual(events,[IMAGE_B,IMAGE_A])
            self.assertEqual(json.loads(Path(state).read_text())["image"],IMAGE_A)

    def test_backup_and_restore_dry_runs_are_safe(self):
        with patch.object(o,"run_command",side_effect=AssertionError("NO IO")):
            code,out = call("backup","--project",PROJECT,"--uri","gs://av-staging-archive/backups/t083")
            self.assertEqual(code,0)
            self.assertEqual(json.loads(out)["action"],"export")
            self.assertEqual(call("restore","--project",PROJECT,
                "--source-project",PROJECT,"--restore-confirm",
                "--uri","gs://av-staging-archive/backups/t083")[0],2)
            self.assertEqual(call("restore","--project","av-staging-restore",
                "--source-project",PROJECT,"--uri","gs://av-staging-archive/backups/t083")[0],2)
            self.assertEqual(call("restore","--project","av-staging-restore",
                "--source-project",PROJECT,"--restore-confirm",
                "--uri","gs://av-staging-archive/backups/t083")[0],0)

    def test_backup_requires_confirmation_and_valid_prefix(self):
        self.assertEqual(call("backup","--project",PROJECT,
          "--uri","gs://mybucket/../escape")[0],2)
        self.assertEqual(call("backup","--project",PROJECT,
          "--uri","gs://mybucket/data","--execute")[0],2)

    def test_export_waits_for_completed_operation_before_evidence(self):
        operation="projects/av-staging-isolated/databases/(default)/operations/123"
        calls=[]
        def runner(cmd,env=None):
            calls.append(cmd)
            if cmd[2]=="export": return json.dumps({"name":operation})
            return '{"done":true}'
        with tempfile.TemporaryDirectory() as directory:
            proof=Path(directory)/"evidence.json"
            with patch.object(o,"run_command",side_effect=runner):
                result,out=call("backup","--project",PROJECT,"--uri","gs://backup-staging/data",
                  "--execute","--confirm-staging","--evidence",str(proof))
            self.assertEqual(result,0)
            self.assertEqual(json.loads(proof.read_text())["result"],"COMPLETED")
            self.assertEqual(len(calls),2)

if __name__ == "__main__": unittest.main()

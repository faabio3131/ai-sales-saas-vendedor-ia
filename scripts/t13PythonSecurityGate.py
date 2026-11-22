"""Safety gate for dangerous Python dynamic execution primitives.
Complements repository review, dependency audit, and AST scan for JS/TS.
"""
import ast
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent

def examine(filename: str, content: str):
    tree = ast.parse(content, filename=filename)
    unsafe = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = node.func
            if isinstance(fn, ast.Name) and fn.id in {"eval", "exec"}:
                unsafe.append((node.lineno, "PY_DYNAMIC_EXECUTION"))
            if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name):
                if fn.value.id == "os" and fn.attr == "system":
                    unsafe.append((node.lineno, "PY_SHELL_EXECUTION"))
                if fn.value.id == "subprocess":
                    if fn.attr in {"getoutput", "getstatusoutput"}:
                        unsafe.append((node.lineno, "PY_SHELL_EXECUTION"))
                    if fn.attr in {"run", "Popen", "call", "check_call", "check_output"} and any(
                        kw.arg == "shell" and isinstance(kw.value, ast.Constant) and kw.value.value is True
                        for kw in node.keywords
                    ):
                        unsafe.append((node.lineno, "PY_SHELL_EXECUTION"))
    return unsafe

def main():
    if "--self-test" in sys.argv:
        assert examine("sample.py", "import os\nos.system('echo unsafe')\n")
        assert examine("sample.py", "import subprocess\nsubprocess.run('echo x',shell=True)")
        assert examine("sample.py", "eval('1+1')")
        assert not examine("sample.py", "import subprocess\nsubprocess.run(['echo','safe'],shell=False)")
        print("t13_python_static_security_self_test_passed")
        return
    findings = []
    for root in [ROOT / "cognitive_service", ROOT / "scripts"]:
        for file in root.rglob("*.py"):
            if file.name == Path(__file__).name or "__pycache__" in file.parts:
                continue
            for line, reason in examine(str(file), file.read_text(encoding="utf-8")):
                findings.append((str(file.relative_to(ROOT)), line, reason))
    for file, line, reason in findings:
        print(f"{file}:{line}:{reason}", file=sys.stderr)
    if findings:
        raise SystemExit(1)
    print("t13_python_static_security_gate_passed")

if __name__ == "__main__":
    main()

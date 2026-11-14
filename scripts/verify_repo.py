import re
import subprocess
from pathlib import Path

from flowent.demo import fixtures
from flowent.model import compile_model

signature = re.compile(
    rb"gh[pous]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----"
)
for name in filter(
    None, subprocess.check_output(["git", "ls-files", "-z"]).decode().split("\0")
):
    path = Path(name)
    contents = path.read_bytes()
    if path.name == ".env" or signature.search(contents):
        raise SystemExit(f"Possible secret: {name}")
    if path.suffix == ".md":
        for value in re.findall(r"\]\(([^)]+)\)", contents.decode()):
            target = value.partition("#")[0]
            if target and "://" not in target and not (path.parent / target).exists():
                raise SystemExit(f"Broken reference in {path}: {target}")
for code, (_, source) in fixtures().items():
    path = Path(f"docs/processes/{code.lower()}.bpmn")
    if path.read_text() != source + "\n":
        raise SystemExit(f"BPMN fixture drift: {path}")
    compile_model(source)

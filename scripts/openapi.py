import json
import sys
from pathlib import Path

from flowent.api import app

target = Path("docs/openapi.json")
contract = (
    json.dumps(app.openapi(), sort_keys=True, ensure_ascii=False, indent=2) + "\n"
)
if "--check" in sys.argv:
    if target.read_text() != contract:
        raise SystemExit("OpenAPI differs from the running API")
else:
    target.write_text(contract)

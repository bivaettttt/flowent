import os

import httpx
from flowent.lab import Scenario

with httpx.Client(base_url="http://127.0.0.1:8000/api/", timeout=35) as client:

    def login(name):
        r = client.post(
            "auth/login", json={"login": name, "password": os.environ["DEMO_PASSWORD"]}
        )
        r.raise_for_status()
        return {"Authorization": "Bearer " + r.json()["token"]}

    employee, admin = login("employee"), login("admin")
    assert client.post("lab/run/parallel", headers=employee).status_code == 403
    for scenario in Scenario:
        response = client.post("lab/run/" + scenario, headers=admin)
        assert response.status_code == 200, (scenario, response.text[:600])
        result = response.json()
        assert result["passed"], (scenario, result["checks"])
        assert all(row["request"] for row in result["traffic"])
print(f"{len(Scenario)} lab scenarios verified over HTTP and PostgreSQL")

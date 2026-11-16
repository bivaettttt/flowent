from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)
]
Revision = Annotated[int, Field(strict=True, ge=1)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Login(Strict):
    login: Name
    password: Annotated[str, Field(min_length=1, max_length=128)]


class User(Login):
    name: Name
    password: Annotated[str, Field(min_length=12, max_length=128)]
    role: Literal["PROCESS_ANALYST", "PROCESS_MANAGER", "EMPLOYEE", "APPROVER", "ADMIN"]
    groups: list[Literal["employees", "managers", "finance", "security", "it"]] = []


class Draft(Strict):
    code: Annotated[str, StringConstraints(pattern=r"^[A-Z][A-Z0-9_-]{1,30}$")]
    name: Name
    xml: Annotated[str, Field(min_length=1, max_length=262144)]


class Update(Strict):
    name: Name
    xml: Annotated[str, Field(min_length=1, max_length=262144)]
    revision: Revision


class Publish(Strict):
    revision: Revision
    validated_digest: (
        Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")] | None
    ) = None


class Archive(Strict):
    revision: Revision
    archived: bool


class Values(Strict):
    values: dict[str, str | int | bool | None]


class Clock(Strict):
    seconds: Annotated[int, Field(strict=True, ge=0, le=31_536_000)] = 0
    fault: bool | None = None


class Retry(Strict):
    note: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=4, max_length=240)
    ]

from hashlib import sha256
from secrets import token_urlsafe
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from flowent.store import db, one, sql

passwords = PasswordHasher()
dummy = passwords.hash(token_urlsafe(32))
bearer = HTTPBearer(auto_error=False)
ROLES = {"PROCESS_ANALYST", "PROCESS_MANAGER", "EMPLOYEE", "APPROVER", "ADMIN"}


def digest(value):
    return sha256(value.encode()).hexdigest()


def authenticate(login, password):
    with db.begin() as conn:
        user = one(conn, "SELECT * FROM users WHERE login=:l", l=login)
        try:
            ok = passwords.verify(user["password"] if user else dummy, password)
        except VerifyMismatchError:
            ok = False
        if not user or not ok:
            raise HTTPException(401, "INVALID_CREDENTIALS")
        token = token_urlsafe(32)
        sql(
            conn,
            "INSERT INTO sessions VALUES (:d,:u,clock_timestamp()+interval '8 hours')",
            d=digest(token),
            u=user["id"],
        )
        return {"token": token}


def identity(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
):
    if credentials:
        key = digest(credentials.credentials)
        with db.connect() as conn:
            user = one(
                conn,
                """SELECT u.id,u.login,u.name,u.role,u.groups FROM users u JOIN sessions s ON s.actor=u.id
                           WHERE s.digest=:d AND s.expires>clock_timestamp()""",
                d=key,
            )
        if user:
            return {**user, "session": key}
    raise HTTPException(401, "AUTH_REQUIRED")


Actor = Annotated[dict, Depends(identity)]


def role(actor, *roles):
    if actor["role"] not in roles:
        raise HTTPException(403, "ROLE_FORBIDDEN")

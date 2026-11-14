import os
from uuid import uuid4

from flowent.access import passwords
from flowent.demo import fixtures
from flowent.operations import publish
from flowent.store import db, one, sql

USERS = [
    ("analyst", "Софья Орлова", "PROCESS_ANALYST", []),
    ("manager", "Анна Волкова", "PROCESS_MANAGER", []),
    ("employee", "Илья Морозов", "EMPLOYEE", ["employees"]),
    ("other", "Максим Лебедев", "EMPLOYEE", ["employees"]),
    ("approver", "Дарья Соколова", "APPROVER", ["managers"]),
    ("finance", "Олег Нестеров", "APPROVER", ["finance"]),
    ("security", "Елена Ким", "APPROVER", ["security"]),
    ("it", "Иван Ли", "APPROVER", ["it"]),
    ("admin", "Мария Павлова", "ADMIN", []),
]


def seed():
    password = os.environ["DEMO_PASSWORD"]
    if len(password) < 12:
        raise ValueError("DEMO_PASSWORD requires at least 12 characters")
    with db.begin() as conn:
        sql(conn, "SELECT pg_advisory_xact_lock(110011)")
        if one(conn, "SELECT id FROM users WHERE login='manager'"):
            return
        actors = {}
        for login, name, role, groups in USERS:
            actors[login] = one(
                conn,
                "INSERT INTO users(login,name,password,role,groups) VALUES (:l,:n,:p,:r,:g) RETURNING id",
                l=login,
                n=name,
                p=passwords.hash(password),
                r=role,
                g=groups,
            )["id"]
        for code, (name, xml) in fixtures().items():
            row = one(
                conn,
                "INSERT INTO definitions(code,name,owner,draft) VALUES (:c,:n,:u,:d) RETURNING id",
                c=code,
                n=name,
                u=actors["analyst"],
                d=xml,
            )
            publish(conn, row["id"], actors["manager"], uuid4(), 1)


if __name__ == "__main__":
    seed()

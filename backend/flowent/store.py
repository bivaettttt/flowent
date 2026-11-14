import json
import os

from fastapi.encoders import jsonable_encoder
from sqlalchemy import create_engine, text

db = create_engine(
    os.getenv("DATABASE_URL", "postgresql+psycopg://flowent@127.0.0.1:56435/flowent"),
    pool_pre_ping=True,
    hide_parameters=True,
)


def sql(conn, query, **params):
    return conn.execute(text(query), params)


def one(conn, query, **params):
    row = sql(conn, query, **params).mappings().one_or_none()
    return dict(row) if row is not None else None


def many(conn, query, **params):
    return [dict(row) for row in sql(conn, query, **params).mappings()]


def pack(value):
    return json.dumps(
        jsonable_encoder(value), ensure_ascii=False, sort_keys=True, allow_nan=False
    )

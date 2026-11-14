from alembic import context
from flowent.store import db

with db.connect() as connection:
    context.configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()

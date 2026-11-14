import logging
from time import sleep

from flowent.engine import tick
from flowent.store import db

logging.basicConfig(level=logging.INFO)
while True:
    try:
        with db.begin() as conn:
            active = tick(conn)
        if not active:
            sleep(0.25)
    except Exception:
        logging.exception("Worker iteration rolled back")
        sleep(1)

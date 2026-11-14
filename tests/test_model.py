import pytest
from flowent.demo import fixtures
from flowent.engine import select_flow, validate_form
from flowent.model import Invalid, compile_model


@pytest.mark.parametrize("code", ["EXPENSE", "ACCESS", "TRAVEL"])
def test_demo_compiles(code):
    model = compile_model(fixtures()[code][1])
    assert model["start"] == "Start"
    assert model["config"]["pairs"] == {"Split": "Join"}
    assert model["nodes"]["Wait"]["seconds"] == 5


@pytest.mark.parametrize(
    ("amount", "expected"),
    [(99999, "simple"), (100000, "complex"), (100001, "complex"), (None, "simple")],
)
def test_xor_and_default(amount, expected):
    model = compile_model(fixtures()["EXPENSE"][1])
    assert (
        select_flow(
            model["nodes"]["Route"], model["config"], {"input": {"amount": amount}}
        )
        == expected
    )


@pytest.mark.parametrize(
    ("old", "new"),
    [
        ("userTask", "manualTask"),
        ("PT5S", "P1D"),
        ('targetRef="Join"', 'targetRef="Reject"'),
        (">complex<", ">True<"),
        ('"group": "finance"', '"group": "missing"'),
        ('"type": "guard"', '"type": "fetch"'),
    ],
)
def test_unsupported_model(old, new):
    with pytest.raises(Invalid):
        compile_model(fixtures()["EXPENSE"][1].replace(old, new))


def test_dtd_rejected():
    with pytest.raises(Invalid):
        compile_model("<!DOCTYPE definitions>" + fixtures()["EXPENSE"][1])


def test_dynamic_date():
    model = compile_model(fixtures()["TRAVEL"][1])
    validate_form(
        model["config"]["input"],
        {
            "destination": "Tomsk",
            "date": "2027-01-01",
            "purpose": "Demo",
            "budget": 100,
        },
    )

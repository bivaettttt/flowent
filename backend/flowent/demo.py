import json
from pathlib import Path
from xml.etree import ElementTree as E

from flowent.model import BPMN

DI = "http://www.omg.org/spec/BPMN/20100524/DI"
DC = "http://www.omg.org/spec/DD/20100524/DC"
POINT = "http://www.omg.org/spec/DD/20100524/DI"
for prefix, ns in [("bpmn", BPMN), ("bpmndi", DI), ("dc", DC), ("di", POINT)]:
    E.register_namespace(prefix, ns)


def schema(**properties):
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


APPROVAL = schema(
    result={
        "type": "string",
        "title": "Решение",
        "enum": ["approve", "reject", "revise"],
    },
    comment={
        "type": "string",
        "title": "Комментарий",
        "minLength": 1,
        "maxLength": 240,
    },
)


def model(code, name, input_form, condition, secondary, finish, action, ground):
    root = E.Element(
        f"{{{BPMN}}}definitions",
        {"id": "Definitions", "targetNamespace": "urn:flowent:demo"},
    )

    def child(parent, ns, kind, **attrs):
        return E.SubElement(parent, f"{{{ns}}}{kind}", attrs)

    process = child(root, BPMN, "process", id=code, name=name, isExecutable="true")
    nodes = [
        ("Start", "startEvent", "", 20, 160),
        ("Route", "exclusiveGateway", "Маршрут", 105, 160),
        ("Solo", "userTask", "Стандартное согласование", 210, 60),
        ("Split", "parallelGateway", "Два согласования", 210, 220),
        ("Lead", "userTask", "Решение руководителя", 330, 140),
        ("Second", "userTask", secondary[0], 330, 305),
        ("Join", "parallelGateway", "Обе ветки", 530, 220),
        ("Result", "exclusiveGateway", "Решение", 620, 220),
        ("Revision", "userTask", "Уточнить заявку", 730, 60),
        ("Wait", "intermediateCatchEvent", "Ожидание", 735, 220),
        ("Service", "serviceTask", "Регистрация результата", 840, 220),
        ("Fulfil", "userTask", finish, 1020, 220),
        ("End", "endEvent", "Завершено", 1210, 240),
        ("Reject", "endEvent", "Отклонено", 740, 405),
    ]
    connections = [
        ("begin", "Start", "Route"),
        ("complex", "Route", "Split"),
        ("simple", "Route", "Solo"),
        ("splitLead", "Split", "Lead"),
        ("splitSecond", "Split", "Second"),
        ("leadJoin", "Lead", "Join"),
        ("secondJoin", "Second", "Join"),
        ("joined", "Join", "Result"),
        ("soloResult", "Solo", "Result"),
    ]
    # An XOR merge is explicit. Per-path decisions avoid interpreting data from earlier loops.
    nodes = [n for n in nodes if n[0] != "Result"] + [
        ("SoloDecision", "exclusiveGateway", "Обычный исход", 450, 25),
        ("LeadDecision", "exclusiveGateway", "Руководитель", 620, 190),
        ("SecondDecision", "exclusiveGateway", "Вторая ветвь", 620, 305),
    ]
    connections = [e for e in connections if e[2] != "Result"] + [
        ("joined", "Join", "LeadDecision"),
        ("soloResult", "Solo", "SoloDecision"),
    ]
    rules = {"complex": condition}
    defaults = {"Route": "simple"}
    for key, origin, scope, continuation in (
        ("solo", "SoloDecision", "Solo", "Wait"),
        ("lead", "LeadDecision", "Lead", "SecondDecision"),
        ("extra", "SecondDecision", "Second", "Wait"),
    ):
        defaults[origin] = key + "Ok"
        connections.extend(
            [
                (key + "No", origin, "Reject"),
                (key + "Rev", origin, "Revision"),
                (key + "Ok", origin, continuation),
            ]
        )
        for suffix, value in [("No", "reject"), ("Rev", "revise")]:
            rules[key + suffix] = {
                "field": scope + "/result",
                "op": "eq",
                "value": value,
            }
    connections.extend(
        [
            ("resubmit", "Revision", "Route"),
            ("ready", "Wait", "Service"),
            ("done", "Service", "Fulfil"),
            ("close", "Fulfil", "End"),
        ]
    )
    # A merge before the split keeps its incoming degree equal to one; retry re-evaluates input.
    nodes.append(("Entry", "exclusiveGateway", "Вход", 67, 160))
    connections = [
        (key, src, "Entry" if dst == "Route" else dst) for key, src, dst in connections
    ]
    connections.append(("entryRoute", "Entry", "Route"))
    config = {
        "input": input_form,
        "rules": rules,
        "pairs": {"Split": "Join"},
        "sla": 7200,
        "tasks": {
            node: {
                "group": group,
                "form": form,
                "sla": 10 if node == "Solo" else 3600,
                "priority": 80 if node == "Second" else 50,
            }
            for node, group, form in [
                ("Solo", "managers", APPROVAL),
                ("Lead", "managers", APPROVAL),
                ("Second", secondary[1], APPROVAL),
                (
                    "Revision",
                    "employees",
                    schema(
                        note={"type": "string", "title": "Уточнение", "minLength": 1}
                    ),
                ),
                (
                    "Fulfil",
                    ground,
                    schema(
                        note={
                            "type": "string",
                            "title": "Подтверждение",
                            "minLength": 1,
                        }
                    ),
                ),
            ]
        },
        "actions": {
            "Service": {"type": action, "message": "Учебная операция выполнена"}
        },
    }
    child(process, BPMN, "documentation").text = json.dumps(config, ensure_ascii=False)
    shapes = {}
    for id, kind, label, x, y in nodes:
        attrs = {"id": id}
        if label:
            attrs["name"] = label
        if id in defaults:
            attrs["default"] = defaults[id]
        item = child(process, BPMN, kind, **attrs)
        if id == "Wait":
            child(
                child(item, BPMN, "timerEventDefinition"), BPMN, "timeDuration"
            ).text = "PT5S"
        w, h = (145, 66) if kind.endswith("Task") else (38, 38)
        shapes[id] = (x, y, w, h)
    for id, src, dst in connections:
        element = child(
            process, BPMN, "sequenceFlow", id=id, sourceRef=src, targetRef=dst
        )
        if id in rules:
            child(element, BPMN, "conditionExpression").text = id
    plane = child(
        child(root, DI, "BPMNDiagram", id="Diagram"),
        DI,
        "BPMNPlane",
        id="Plane",
        bpmnElement=code,
    )
    for id, (x, y, w, h) in shapes.items():
        shape = child(plane, DI, "BPMNShape", id=id + "_di", bpmnElement=id)
        child(shape, DC, "Bounds", x=str(x), y=str(y), width=str(w), height=str(h))
    for id, src, dst in connections:
        edge = child(plane, DI, "BPMNEdge", id=id + "_di", bpmnElement=id)
        x, y, w, h = shapes[src]
        tx, ty, tw, th = shapes[dst]
        if tx >= x + w:
            points = [(x + w, y + h // 2), (tx, ty + th // 2)]
        else:
            points = [
                (x + w, y + h // 2),
                (x + w + 15, y + h // 2),
                (x + w + 15, 460),
                (tx - 12, 460),
                (tx - 12, ty + th // 2),
                (tx, ty + th // 2),
            ]
        for a, b in points:
            child(edge, POINT, "waypoint", x=str(a), y=str(b))
    E.indent(root)
    return E.tostring(root, encoding="unicode")


def fixtures():
    def text(label):
        return {
            "type": "string",
            "title": label,
            "minLength": 1,
            "maxLength": 180,
        }

    def amount(label):
        return {
            "type": "integer",
            "title": label,
            "minimum": 1,
            "maximum": 1000000000,
        }

    return {
        "EXPENSE": (
            "Корпоративные расходы",
            model(
                "EXPENSE",
                "Корпоративные расходы",
                schema(
                    amount=amount("Сумма, ₽"),
                    category={
                        "type": "string",
                        "title": "Категория",
                        "enum": ["equipment", "services"],
                    },
                    purpose=text("Назначение"),
                ),
                {"field": "input/amount", "op": "gte", "value": 100000},
                ("Финансовый контроль", "finance"),
                "Подтвердить расход",
                "guard",
                "employees",
            ),
        ),
        "ACCESS": (
            "Предоставление ИТ-доступа",
            model(
                "ACCESS",
                "Предоставление ИТ-доступа",
                schema(
                    system=text("Система"),
                    privileged={"type": "boolean", "title": "Привилегированный доступ"},
                    purpose=text("Обоснование"),
                ),
                {"field": "input/privileged", "op": "eq", "value": True},
                ("Проверка безопасности", "security"),
                "Предоставить доступ",
                "notify",
                "it",
            ),
        ),
        "TRAVEL": (
            "Согласование командировки",
            model(
                "TRAVEL",
                "Согласование командировки",
                schema(
                    destination=text("Место"),
                    date={"type": "string", "format": "date", "title": "Дата"},
                    budget=amount("Бюджет, ₽"),
                    purpose=text("Цель"),
                ),
                {"field": "input/budget", "op": "gt", "value": 80000},
                ("Проверка бюджета", "finance"),
                "Подтвердить поездку",
                "record",
                "employees",
            ),
        ),
    }


if __name__ == "__main__":
    folder = Path("docs/processes")
    folder.mkdir(parents=True, exist_ok=True)
    for code, (_, xml) in fixtures().items():
        (folder / (code.lower() + ".bpmn")).write_text(xml + "\n")

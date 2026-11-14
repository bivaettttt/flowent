import json
import re
from collections import defaultdict
from pathlib import Path

from jsonschema import Draft202012Validator
from lxml import etree

BPMN = "http://www.omg.org/spec/BPMN/20100524/MODEL"
TYPES = {
    "startEvent",
    "endEvent",
    "userTask",
    "serviceTask",
    "exclusiveGateway",
    "parallelGateway",
    "intermediateCatchEvent",
}
GROUPS = {"employees", "managers", "finance", "security", "it"}
ACTIONS = {"notify", "record", "guard"}
OPERATORS = {"eq", "gt", "gte", "lt", "lte"}
SCHEMA = etree.XMLSchema(etree.parse(str(Path(__file__).parent / "schema/BPMN20.xsd")))
SECONDS_LIMIT = 31_536_000


class Invalid(ValueError):
    def __init__(self, element, message):
        self.element = element
        super().__init__(message)


def require(condition, element, message):
    if not condition:
        raise Invalid(element, message)


def tag(name):
    return f"{{{BPMN}}}{name}"


def keys_only(value, allowed, element):
    require(
        isinstance(value, dict) and value.keys() <= set(allowed),
        element,
        "Invalid configuration keys",
    )


def form_schema(schema, identifier):
    keys_only(
        schema, {"properties", "required", "type", "additionalProperties"}, identifier
    )
    require(
        schema.get("type") == "object" and schema.get("additionalProperties") is False,
        identifier,
        "Form must be a closed object",
    )
    properties = schema.get("properties", {})
    require(
        isinstance(properties, dict) and len(properties) <= 30,
        identifier,
        "Too many fields",
    )
    required = schema.get("required", [])
    require(
        isinstance(required, list)
        and all(isinstance(k, str) and k in properties for k in required),
        identifier,
        "Unknown required field",
    )
    for key, prop in properties.items():
        require(
            bool(re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]{0,40}", key)),
            identifier,
            "Invalid field name",
        )
        keys_only(
            prop,
            {
                "type",
                "title",
                "enum",
                "minimum",
                "maximum",
                "minLength",
                "maxLength",
                "format",
                "description",
            },
            identifier,
        )
        require(
            prop.get("type") in ("string", "integer", "boolean")
            and prop.get("format") in (None, "date"),
            identifier,
            "Unsupported field type",
        )
    try:
        Draft202012Validator.check_schema(schema)
    except Exception as error:
        raise Invalid(identifier, "Invalid form schema") from error


EMPTY_FORM = {"type": "object", "additionalProperties": False, "properties": {}}


def compile_model(source):
    require(len(source.encode()) <= 262144, "XML", "Model is too large")
    try:
        root = etree.fromstring(
            source.encode(),
            etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True),
        )
        require(not root.getroottree().docinfo.doctype, "XML", "DTD forbidden")
        SCHEMA.assertValid(root)
    except etree.LxmlError as error:
        issue = error.error_log.last_error
        raise Invalid(
            "XML", f"Invalid XML/XSD near line {issue.line if issue else '?'}"
        ) from error
    processes = root.findall(tag("process"))
    require(len(processes) == 1, "XML", "Exactly one process required")
    process = processes[0]
    require(
        process.get("isExecutable") in ("true", "1"),
        process.get("id"),
        "Process must be executable",
    )
    require(
        all(
            child.tag
            in {
                tag("process"),
                "{http://www.omg.org/spec/BPMN/20100524/DI}BPMNDiagram",
                tag("documentation"),
            }
            for child in root
        ),
        "XML",
        "Unsupported top-level BPMN element",
    )
    identifier = process.get("id")
    try:
        config = json.loads(process.findtext(tag("documentation")) or "{}")
    except ValueError as error:
        raise Invalid(identifier, "Invalid Flowent JSON documentation") from error
    keys_only(
        config, {"input", "tasks", "actions", "rules", "pairs", "sla"}, identifier
    )
    form_schema(config.get("input", EMPTY_FORM), identifier)
    sla = config.get("sla", 86400)
    require(
        type(sla) is int and 1 <= sla <= SECONDS_LIMIT,
        identifier,
        "Invalid process SLA",
    )
    nodes, flows = {}, {}
    outgoing, incoming = defaultdict(list), defaultdict(list)
    for element in process:
        kind = etree.QName(element).localname
        id = element.get("id")
        if kind == "documentation":
            continue
        require(bool(id), identifier, "Every execution element needs an ID")
        require(kind in TYPES | {"sequenceFlow"}, id, "Unsupported execution element")
        children = {etree.QName(child).localname for child in element}
        allowed = {"incoming", "outgoing", "documentation"}
        if kind == "intermediateCatchEvent":
            allowed.add("timerEventDefinition")
        if kind == "sequenceFlow":
            allowed.add("conditionExpression")
        require(children <= allowed, id, "Unsupported child or event definition")
        require(
            not any(
                k
                not in {
                    "id",
                    "name",
                    "default",
                    "sourceRef",
                    "targetRef",
                    "gatewayDirection",
                }
                for k in element.attrib
            ),
            id,
            "Unsupported execution attribute",
        )
        if kind == "sequenceFlow":
            src, dst = element.get("sourceRef"), element.get("targetRef")
            expression = element.findtext(tag("conditionExpression"))
            flows[id] = {
                "id": id,
                "source": src,
                "target": dst,
                "expression": expression,
            }
            outgoing[src].append(id)
            incoming[dst].append(id)
            continue
        node = {
            "id": id,
            "kind": kind,
            "name": element.get("name", id),
            "default": element.get("default"),
        }
        if kind == "intermediateCatchEvent":
            timers = element.findall(tag("timerEventDefinition"))
            value = (
                timers[0].findtext(tag("timeDuration"), "") if len(timers) == 1 else ""
            )
            matched = re.fullmatch(r"PT([1-9][0-9]{0,7})S", value)
            require(
                matched and len(timers[0]) == 1 and int(matched[1]) <= SECONDS_LIMIT,
                id,
                "Expected one timer duration PT<n>S",
            )
            node["seconds"] = int(matched[1])
        nodes[id] = node
    require(1 <= len(nodes) <= 150, identifier, "Model node count out of range")
    for flow in flows.values():
        require(
            flow["source"] in nodes and flow["target"] in nodes,
            flow["id"],
            "Unknown flow endpoint",
        )
    starts = [id for id, node in nodes.items() if node["kind"] == "startEvent"]
    require(len(starts) == 1, identifier, "Exactly one none start required")
    start = starts[0]
    for section, kinds in {
        "tasks": {"userTask"},
        "actions": {"serviceTask"},
        "pairs": {"parallelGateway"},
        "rules": {"sequenceFlow"},
    }.items():
        group = config.setdefault(section, {})
        require(isinstance(group, dict), identifier, f"Expected object for {section}")
        for key in group:
            require(
                (
                    key in flows
                    if section == "rules"
                    else nodes.get(key, {}).get("kind") in kinds
                ),
                key,
                "Configuration refers to the wrong element",
            )
    for id, node in nodes.items():
        kind = node["kind"]
        ins, outs = incoming[id], outgoing[id]
        node.update(incoming=ins, outgoing=outs)
        if kind == "startEvent":
            require(
                not ins and len(outs) == 1, id, "Start requires one output and no input"
            )
        elif kind == "endEvent":
            require(ins and not outs, id, "End requires input and no output")
        else:
            require(ins and outs, id, "Missing input or output")
        if kind not in {"exclusiveGateway", "parallelGateway", "endEvent"}:
            require(len(outs) == 1, id, "One output required")
        if kind == "userTask":
            task = config["tasks"].get(id, {})
            keys_only(task, {"group", "form", "sla", "priority"}, id)
            require(
                task.get("group") in GROUPS, id, "Select a supported assignment group"
            )
            for key, default, bound in (
                ("sla", 3600, SECONDS_LIMIT),
                ("priority", 50, 100),
            ):
                value = task.get(key, default)
                require(
                    type(value) is int and 1 <= value <= bound, id, f"Invalid {key}"
                )
            form_schema(task.get("form", EMPTY_FORM), id)
        if kind == "serviceTask":
            action = config["actions"].get(id, {})
            keys_only(action, {"type", "message"}, id)
            require(
                action.get("type") in ACTIONS
                and isinstance(action.get("message"), str)
                and 1 <= len(action["message"]) <= 240,
                id,
                "Select a registered action and message",
            )
        if kind == "exclusiveGateway" and len(outs) > 1:
            require(
                len(ins) == 1 and node["default"] in outs,
                id,
                "XOR split requires one input and a default",
            )
        else:
            require(node["default"] is None, id, "Default only allowed on XOR split")
    for id, flow in flows.items():
        src = nodes[flow["source"]]
        conditional = (
            src["kind"] == "exclusiveGateway"
            and len(src["outgoing"]) > 1
            and src["default"] != id
        )
        rule = config["rules"].get(id)
        require(
            conditional == (rule is not None),
            id,
            "Conditional flows require a typed rule and default is unconditional",
        )
        require(
            flow["expression"] is None or (conditional and flow["expression"] == id),
            id,
            "Only a rule-ID condition expression is allowed",
        )
        if rule is not None:
            keys_only(rule, {"field", "op", "value"}, id)
            require(
                isinstance(rule.get("field"), str)
                and re.fullmatch(
                    r"(?:input|[A-Za-z_][\w.-]*)/[A-Za-z][\w]*", rule["field"]
                )
                and rule.get("op") in OPERATORS
                and type(rule.get("value"))
                in ((str, int, bool) if rule.get("op") == "eq" else (int,)),
                id,
                "Invalid typed rule",
            )
            scope, field = rule["field"].split("/")
            schema = (
                config.get("input", EMPTY_FORM)
                if scope == "input"
                else config["tasks"].get(scope, {}).get("form", EMPTY_FORM)
            )
            prop = schema.get("properties", {}).get(field, {})
            require(
                prop.get("type")
                == {str: "string", int: "integer", bool: "boolean"}[
                    type(rule["value"])
                ],
                id,
                "Rule value and field type must match",
            )

    def reachable(origin, stop=None):
        seen = set()
        todo = [origin]
        while todo:
            active = todo.pop()
            if active == stop or active in seen:
                continue
            seen.add(active)
            todo.extend(flows[f]["target"] for f in outgoing[active])
        return seen

    require(reachable(start) == nodes.keys(), identifier, "Unreachable node")
    ends = {id for id, n in nodes.items() if n["kind"] == "endEvent"}
    require(
        ends and all(reachable(id) & ends for id in nodes),
        identifier,
        "Every node must reach an end",
    )
    pairs = config["pairs"]
    splits = {
        id
        for id, n in nodes.items()
        if n["kind"] == "parallelGateway" and len(outgoing[id]) > 1
    }
    joins = {
        id
        for id, n in nodes.items()
        if n["kind"] == "parallelGateway" and len(incoming[id]) > 1
    }
    require(
        set(pairs) == splits
        and all(isinstance(v, str) for v in pairs.values())
        and set(pairs.values()) == joins
        and len(pairs) == len(joins)
        and not splits & joins,
        identifier,
        "Every AND split requires a unique paired join",
    )
    protected = set()
    for split, join in pairs.items():
        require(
            len(incoming[split]) == 1 and len(outgoing[join]) == 1,
            split,
            "Invalid split or join degree",
        )
        area = set()
        arrivals = set()
        for branch in outgoing[split]:
            entry = flows[branch]["target"]
            region = reachable(entry, join)
            require(
                not region & area and split not in region and not region & ends,
                split,
                "Parallel branches overlap or bypass join",
            )
            incoming_region = {
                f
                for n in region
                for f in incoming[n]
                if flows[f]["source"] not in region
            }
            require(
                incoming_region == ({branch} if region else set()),
                split,
                "External entry into parallel branch",
            )
            terminal = {
                f for n in region for f in outgoing[n] if flows[f]["target"] == join
            }
            if not region:
                terminal = {branch}
            require(
                len(terminal) == 1 and all(join in reachable(n) for n in region),
                join,
                "Every branch must arrive once",
            )
            arrivals.update(terminal)
            area.update(region)
        require(
            arrivals == set(incoming[join]), join, "Join has unexpected incoming routes"
        )
        protected.update(area | {split, join})
    # A cycle is legal only if a human task breaks synchronous execution, outside AND regions.
    color = {}

    def visit(id):
        require(color.get(id) != 1, id, "Automatic or parallel cycle")
        if color.get(id) == 2:
            return
        color[id] = 1
        if nodes[id]["kind"] != "userTask" or id in protected:
            for f in outgoing[id]:
                visit(flows[f]["target"])
        color[id] = 2

    for id in nodes:
        visit(id)
    return {"start": start, "nodes": nodes, "flows": flows, "config": config}

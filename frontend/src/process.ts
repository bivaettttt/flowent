export const definitions = "/process-definitions";
export const processes = "/process-instances";

const utc = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "UTC",
});
export function time(value: string | null | undefined) {
  return value ? utc.format(new Date(value)) + " UTC" : "—";
}

const types: Record<string, string> = {
  startEvent: "Начало",
  endEvent: "Завершение",
  userTask: "Пользовательская задача",
  serviceTask: "Сервисная задача",
  exclusiveGateway: "Условный шлюз",
  parallelGateway: "Параллельный шлюз",
  intermediateCatchEvent: "Промежуточное событие",
  sequenceFlow: "Поток управления",
};
export type ModelNode = {
  id: string;
  name: string;
  type: string;
  supported: boolean;
  configuration: Record<string, unknown>;
};

export function modelNodes(xml: string): ModelNode[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const process = document.getElementsByTagNameNS(
    "http://www.omg.org/spec/BPMN/20100524/MODEL",
    "process",
  )[0];
  if (!process) return [];
  const children = [...process.children];
  let configuration: Record<string, Record<string, unknown>> = {};
  try {
    configuration =
      JSON.parse(
        children.find((node) => node.localName === "documentation")
          ?.textContent ?? "{}",
      ) ?? {};
  } catch {
    // The compiler provides the diagnostic for malformed Flowent configuration.
  }
  return children.flatMap((node) => {
    const id = node.getAttribute("id");
    if (!id || node.localName === "documentation") return [];
    const timer = node.getElementsByTagNameNS(
      node.namespaceURI,
      "timeDuration",
    )[0];
    const entries = Object.entries(configuration)
      .filter(
        ([section, values]) =>
          ["tasks", "actions", "pairs", "rules"].includes(section) &&
          values &&
          typeof values === "object" &&
          id in values,
      )
      .map(([section, values]) => [section, values[id]]);
    const mapped = Object.fromEntries(entries);
    if (timer?.textContent) mapped.duration = timer.textContent;
    return [
      {
        id,
        name: node.getAttribute("name") || id,
        type: timer ? "BPMN-таймер" : (types[node.localName] ?? node.localName),
        supported: Boolean(types[node.localName]),
        configuration: mapped,
      },
    ];
  });
}

export function routeOptions(hash = location.hash) {
  const index = hash.indexOf("?");
  return new URLSearchParams(index < 0 ? "" : hash.slice(index + 1));
}

export function linkTo(
  path: string,
  fields: Record<string, string | null | undefined> = {},
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(fields))
    if (value) query.set(key, value);
  return "#" + path + (query.size ? "?" + query : "");
}

export function returnTo(route: string, prefix: string) {
  const previous = routeOptions(route).get("return");
  return previous?.startsWith("#" + prefix + "?") ? previous : "#" + prefix;
}

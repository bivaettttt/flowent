import { useEffect, useRef, useState } from "react";
import Modeler from "bpmn-js/lib/Modeler";
import Viewer from "bpmn-js/lib/NavigatedViewer";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";

export type CanvasAPI = {
  saveXML(options: { format: boolean }): Promise<{ xml?: string }>;
  get<T>(name: string): T;
};
type Registry = { get(id: string): unknown };
type Selection = {
  element?: { id: string; businessObject: { name?: string } };
};
export function Diagram({
  xml,
  edit,
  ready,
  active = [],
  completed = [],
  blocked = [],
}: {
  xml: string;
  edit?: boolean;
  ready?: (api: CanvasAPI) => void;
  active?: string[];
  completed?: string[];
  blocked?: string[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Selection["element"]>();
  const [name, setName] = useState("");
  const instance = useRef<CanvasAPI | null>(null);
  const highlights = active.join(",");
  const passed = completed.join(",");
  const failed = blocked.join(",");
  const callback = useRef(ready);
  callback.current = ready;
  useEffect(() => {
    const canvas = edit
      ? new Modeler({ container: container.current! })
      : new Viewer({ container: container.current! });
    const editor = canvas as unknown as CanvasAPI;
    let mounted = true;
    instance.current = editor;
    setSelected(undefined);
    setError("");
    if (edit)
      editor
        .get<{
          on(
            name: string,
            cb: (event: { newSelection: Selection["element"][] }) => void,
          ): void;
        }>("eventBus")
        .on("selection.changed", (e) => {
          const item = e.newSelection[0];
          setSelected(item);
          setName(item?.businessObject.name ?? "");
        });
    canvas
      .importXML(xml)
      .then(() => {
        if (!mounted) return;
        const visual = editor.get<{
          zoom(mode: string): void;
          addMarker(id: string, kind: string): void;
        }>("canvas");
        visual.zoom("fit-viewport");
        const registry = editor.get<Registry>("elementRegistry");
        for (const [ids, marker] of [
          [passed, "completed-node"],
          [highlights, "waiting"],
          [failed, "blocked-node"],
        ]) {
          for (const id of ids.split(","))
            if (registry.get(id)) visual.addMarker(id, marker);
        }
        callback.current?.(editor);
      })
      .catch((e) => {
        if (mounted) setError(String(e.message ?? e));
      });
    return () => {
      mounted = false;
      instance.current = null;
      canvas.destroy();
    };
  }, [xml, edit, highlights, passed, failed]);
  return (
    <>
      <div ref={container} className="diagram" aria-label="BPMN Canvas" />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {edit && selected && (
        <form
          className="toolbar pad"
          onSubmit={(e) => {
            e.preventDefault();
            const fields = new FormData(e.currentTarget);
            instance.current
              ?.get<{
                updateProperties(element: unknown, properties: object): void;
              }>("modeling")
              .updateProperties(selected, { id: fields.get("id"), name });
          }}
        >
          <label>
            Element ID
            <input
              key={selected.id}
              name="id"
              required
              defaultValue={selected.id}
            />
          </label>
          <label>
            Название элемента
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button>Применить свойства</button>
        </form>
      )}
    </>
  );
}

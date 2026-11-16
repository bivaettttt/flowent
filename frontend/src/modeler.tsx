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
type Bounds = { x: number; y: number; width: number; height: number };
type Viewport = {
  viewbox(box: false): {
    inner: Bounds;
    outer: Pick<Bounds, "width" | "height">;
  };
  viewbox(box: Bounds): void;
  resized(): void;
  addMarker(id: string, kind: string): void;
};
function fit(viewport: Viewport, paletteWidth: number) {
  const { inner, outer } = viewport.viewbox(false);
  const margin = 24;
  const width = outer.width - paletteWidth - 2 * margin;
  const height = outer.height - 2 * margin;
  if (!inner.width || !inner.height || width <= 0 || height <= 0) return;
  const scale = Math.min(1, width / inner.width, height / inner.height);
  viewport.viewbox({
    x: inner.x + inner.width / 2 - (outer.width + paletteWidth) / (2 * scale),
    y: inner.y + inner.height / 2 - outer.height / (2 * scale),
    width: outer.width / scale,
    height: outer.height / scale,
  });
}

type Registry = { get(id: string): unknown };
type Selection = {
  element?: { id: string; businessObject: { name?: string } };
};
export function Diagram({
  xml,
  edit,
  ready,
  changed,
  active = [],
  completed = [],
  blocked = [],
}: {
  xml: string;
  edit?: boolean;
  ready?: (api: CanvasAPI) => void;
  changed?: () => void;
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
  const resetView = useRef<(() => void) | null>(null);
  const callback = useRef(ready);
  callback.current = ready;
  const onChanged = useRef(changed);
  onChanged.current = changed;
  useEffect(() => {
    const element = container.current!;
    const options = {
      container: element,
      textRenderer: {
        defaultStyle: { fontSize: 15 },
        externalStyle: { fontSize: 13 },
      },
    };
    const canvas = edit ? new Modeler(options) : new Viewer(options);
    const editor = canvas as unknown as CanvasAPI;
    let mounted = true;
    let observer: ResizeObserver | undefined;
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
        const visual = editor.get<Viewport>("canvas");
        resetView.current = () => {
          const palette = element.querySelector<HTMLElement>(".djs-palette");
          fit(visual, palette ? palette.offsetLeft + palette.offsetWidth : 0);
        };
        resetView.current();
        observer = new ResizeObserver(() => visual.resized());
        observer.observe(element);
        const registry = editor.get<Registry>("elementRegistry");
        for (const [ids, marker] of [
          [passed, "completed-node"],
          [highlights, "waiting"],
          [failed, "blocked-node"],
        ]) {
          for (const id of ids.split(","))
            if (registry.get(id)) visual.addMarker(id, marker);
        }
        if (edit)
          editor
            .get<{ on(event: string, callback: () => void): void }>("eventBus")
            .on("commandStack.changed", () => onChanged.current?.());
        callback.current?.(editor);
      })
      .catch((e) => {
        if (mounted) setError(String(e.message ?? e));
      });
    return () => {
      mounted = false;
      instance.current = null;
      resetView.current = null;
      observer?.disconnect();
      canvas.destroy();
    };
  }, [xml, edit, highlights, passed, failed]);
  return (
    <>
      <div className={edit ? "diagram-frame editable" : "diagram-frame"}>
        <div ref={container} className="diagram" aria-label="BPMN Canvas" />
        {edit && (
          <button
            className="diagram-fit"
            type="button"
            onClick={() => resetView.current?.()}
          >
            Вписать в экран
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {edit && (
        <section className="element-properties" aria-label="Свойства элемента">
          <h3>Свойства элемента</h3>
          {selected ? (
            <form
              className="toolbar pad"
              onSubmit={(e) => {
                e.preventDefault();
                const fields = new FormData(e.currentTarget);
                instance.current
                  ?.get<{
                    updateProperties(
                      element: unknown,
                      properties: object,
                    ): void;
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
          ) : (
            <p className="muted">
              Выберите элемент на схеме, чтобы изменить его название или
              идентификатор.
            </p>
          )}
        </section>
      )}
    </>
  );
}

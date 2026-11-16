import { useEffect, useRef, useState } from "react";
import Modeler from "bpmn-js/lib/Modeler";
import Viewer from "bpmn-js/lib/NavigatedViewer";
import { modelNodes, type ModelNode } from "./process";
import type { Form } from "./api";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";

export type CanvasAPI = {
  saveXML(options: { format: boolean }): Promise<{ xml?: string }>;
  get<T>(name: string): T;
  focusElement(id: string): boolean;
};
type Bounds = { x: number; y: number; width: number; height: number };
type Shape = { id: string; businessObject: { name?: string } };
type Viewport = {
  viewbox(box: false): {
    inner: Bounds;
    outer: Pick<Bounds, "width" | "height">;
  };
  viewbox(box: Bounds): void;
  resized(): void;
  zoom(): number;
  zoom(scale: number, center: "auto"): void;
  scrollToElement(element: Shape): void;
  addMarker(id: string, kind: string): void;
  removeMarker(id: string, kind: string): void;
};
type Registry = { get(id: string): Shape | undefined };
type Commands = {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
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

export function Diagram({
  xml,
  edit,
  ready,
  changed,
  active = [],
  completed = [],
  blocked = [],
  selectedId,
  onSelect,
}: {
  xml: string;
  edit?: boolean;
  ready?: (api: CanvasAPI) => void;
  changed?: () => void;
  active?: string[];
  completed?: string[];
  blocked?: string[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Shape>();
  const [name, setName] = useState("");
  const [structure, setStructure] = useState<ModelNode[]>([]);
  const [scale, setScale] = useState(100);
  const [commands, setCommands] = useState({ undo: false, redo: false });
  const [generation, setGeneration] = useState(0);
  const instance = useRef<CanvasAPI | null>(null);
  const resetView = useRef<(() => void) | null>(null);
  const callbacks = useRef({ ready, changed, onSelect });
  callbacks.current = { ready, changed, onSelect };
  const selectedRef = useRef<Shape | undefined>(undefined);
  const highlights = active.join(",");
  const passed = completed.join(",");
  const failed = blocked.join(",");

  useEffect(() => {
    const element = container.current!;
    const options = {
      container: element,
      textRenderer: {
        defaultStyle: { fontSize: 15 },
        externalStyle: { fontSize: 13 },
      },
    };
    const renderer = edit ? new Modeler(options) : new Viewer(options);
    const editor = renderer as unknown as CanvasAPI;
    let mounted = true;
    let observer: ResizeObserver | undefined;
    let editSequence = 0;
    let lastWidth = element.clientWidth;
    setError("");
    setSelected(undefined);
    selectedRef.current = undefined;
    setStructure(modelNodes(xml));
    setCommands({ undo: false, redo: false });
    renderer
      .importXML(xml)
      .then(() => {
        if (!mounted) return;
        const viewport = editor.get<Viewport>("canvas");
        const registry = editor.get<Registry>("elementRegistry");
        const selection = editor.get<{ select(shape?: Shape): void }>(
          "selection",
        );
        const bus = editor.get<{
          on(
            event: string,
            callback: (value: { newSelection: Shape[] }) => void,
          ): void;
        }>("eventBus");
        editor.focusElement = (id) => {
          const shape = registry.get(id);
          if (!shape) return false;
          selection.select(shape);
          if (viewport.zoom() < 0.57) viewport.zoom(0.72, "auto");
          viewport.scrollToElement(shape);
          return true;
        };
        instance.current = editor;
        resetView.current = () => {
          const palette = element.querySelector<HTMLElement>(".djs-palette");
          fit(
            viewport,
            palette?.offsetWidth ? palette.offsetLeft + palette.offsetWidth : 0,
          );
          setScale(Math.round(viewport.zoom() * 100));
        };
        bus.on("canvas.viewbox.changed", () =>
          setScale(Math.round(viewport.zoom() * 100)),
        );
        bus.on("selection.changed", ({ newSelection }) => {
          const chosen = newSelection[0];
          selectedRef.current = chosen;
          setSelected(chosen);
          setName(chosen?.businessObject.name ?? "");
          callbacks.current.onSelect?.(chosen?.id ?? "");
        });
        if (edit) {
          const history = editor.get<Commands>("commandStack");
          bus.on("commandStack.changed", () => {
            callbacks.current.changed?.();
            setCommands({ undo: history.canUndo(), redo: history.canRedo() });
            const sequence = ++editSequence;
            void editor
              .saveXML({ format: true })
              .then((source) => {
                if (mounted && source.xml && sequence === editSequence)
                  setStructure(modelNodes(source.xml));
              })
              .catch(() => {});
            if (selectedRef.current)
              setName(selectedRef.current.businessObject.name ?? "");
          });
        }
        resetView.current();
        observer = new ResizeObserver(() => {
          viewport.resized();
          if (lastWidth !== element.clientWidth) {
            lastWidth = element.clientWidth;
            resetView.current?.();
          }
        });
        observer.observe(element);
        callbacks.current.ready?.(editor);
        setGeneration((value) => value + 1);
      })
      .catch((failure) => {
        if (mounted) setError(String(failure.message ?? failure));
      });
    return () => {
      mounted = false;
      instance.current = null;
      resetView.current = null;
      observer?.disconnect();
      renderer.destroy();
    };
  }, [xml, edit]);

  useEffect(() => {
    const diagram = instance.current;
    if (!diagram) return;
    const viewport = diagram.get<Viewport>("canvas");
    const registry = diagram.get<Registry>("elementRegistry");
    const markers = [
      [passed, "completed-node"],
      [highlights, "waiting"],
      [failed, "blocked-node"],
    ];
    for (const [ids, marker] of markers)
      for (const id of ids.split(","))
        if (registry.get(id)) viewport.addMarker(id, marker);
    return () => {
      if (instance.current !== diagram) return;
      for (const [ids, marker] of markers)
        for (const id of ids.split(","))
          if (registry.get(id)) viewport.removeMarker(id, marker);
    };
  }, [generation, passed, highlights, failed]);
  useEffect(() => {
    if (selectedId && selectedRef.current?.id !== selectedId)
      instance.current?.focusElement(selectedId);
    else if (selectedId === "" && selectedRef.current)
      instance.current?.get<{ select(): void }>("selection").select();
  }, [selectedId, generation]);

  function zoom(factor: number) {
    const viewport = instance.current?.get<Viewport>("canvas");
    if (!viewport) return;
    viewport.zoom(
      Math.max(0.015, Math.min(4, viewport.zoom() * factor)),
      "auto",
    );
    setScale(Math.round(viewport.zoom() * 100));
  }
  const item = structure.find((node) => node.id === selected?.id);
  return (
    <>
      <div className="diagram-controls" aria-label="Управление диаграммой">
        {edit && (
          <span className="toolbar desktop-only">
            <button
              type="button"
              disabled={!commands.undo}
              onClick={() =>
                instance.current?.get<Commands>("commandStack").undo()
              }
            >
              Отменить
            </button>
            <button
              type="button"
              disabled={!commands.redo}
              onClick={() =>
                instance.current?.get<Commands>("commandStack").redo()
              }
            >
              Повторить
            </button>
          </span>
        )}
        <button
          type="button"
          onClick={() => zoom(0.8)}
          aria-label="Уменьшить масштаб"
        >
          −
        </button>
        <span className="zoom-level" aria-label="Масштаб">
          {scale}%
        </span>
        <button
          type="button"
          onClick={() => zoom(1.25)}
          aria-label="Увеличить масштаб"
        >
          +
        </button>
        <button type="button" onClick={() => resetView.current?.()}>
          Вписать в экран
        </button>
        <label className="node-picker">
          <span>Элемент BPMN</span>
          <select
            value={selected?.id ?? ""}
            onChange={(event) => {
              if (event.target.value)
                instance.current?.focusElement(event.target.value);
              else
                instance.current
                  ?.get<{ select(shape?: Shape): void }>("selection")
                  .select();
            }}
          >
            <option value="">Выбрать элемент…</option>
            {structure.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name} · {node.id}
              </option>
            ))}
          </select>
        </label>
      </div>
      {edit && (
        <p className="pad muted small-only">
          Выберите шаг в списке. Визуальное редактирование доступно на широком
          экране.
        </p>
      )}
      <div className={edit ? "diagram-frame editable" : "diagram-frame"}>
        <div
          ref={container}
          className="diagram"
          role="region"
          aria-label="BPMN Canvas"
        />
      </div>
      {error && (
        <p className="error" role="alert">
          Диаграмму не удалось открыть. {error}
        </p>
      )}
      {edit && (
        <section className="node-properties" aria-label="Свойства элемента">
          <h3>Свойства элемента</h3>
          {selected ? (
            <>
              {item && (
                <p className="muted">
                  {item.type} · <code>{item.id}</code>
                  {!item.supported &&
                    " · вне исполняемого подмножества Flowent"}
                </p>
              )}
              <form
                className="toolbar desktop-only"
                onSubmit={(event) => {
                  event.preventDefault();
                  const fields = new FormData(event.currentTarget);
                  instance.current
                    ?.get<{
                      updateProperties(
                        element: Shape,
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
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <button>Применить свойства</button>
              </form>
              {item && <ExecutionProperties node={item} />}
              <details>
                <summary>Исходные настройки Flowent</summary>
                {item && Object.keys(item.configuration).length ? (
                  <pre>{JSON.stringify(item.configuration, null, 2)}</pre>
                ) : (
                  <p>
                    Для элемента нет отдельных настроек. Полная конфигурация
                    находится в исходнике XML.
                  </p>
                )}
              </details>
            </>
          ) : (
            <p className="muted">
              Выберите фигуру на схеме или элемент из списка.
            </p>
          )}
        </section>
      )}
    </>
  );
}

function ExecutionProperties({ node }: { node: ModelNode }) {
  const task = node.configuration.tasks as
    | { group?: string; sla?: number; priority?: number; form?: Form }
    | undefined;
  const action = node.configuration.actions as { type?: string } | undefined;
  const values = [
    ["Группа исполнителей", task?.group],
    ["Приоритет", task?.priority],
    [
      "Срок задачи",
      typeof task?.sla === "number" ? `${task.sla} с` : undefined,
    ],
    ["Длительность таймера", node.configuration.duration],
    ["Парный шлюз", node.configuration.pairs],
    ["Сервисное действие", action?.type],
  ].filter((entry) => entry[1] !== undefined);
  const fields = Object.entries(task?.form?.properties ?? {});
  if (!values.length && !fields.length) return null;
  return (
    <section aria-label="Настройки исполнения" className="model-configuration">
      <h4>Настройки исполнения</h4>
      <dl className="facts">
        {values.map(([label, value]) => (
          <div key={String(label)}>
            <dt>{String(label)}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
      {fields.length > 0 && (
        <p>
          Поля формы ·{" "}
          {fields
            .map(
              ([id, field]) =>
                (field.title ?? id) +
                (task?.form?.required?.includes(id) ? " (обязательное)" : ""),
            )
            .join(", ")}
        </p>
      )}
    </section>
  );
}

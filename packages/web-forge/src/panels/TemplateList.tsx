import { useEditor } from "../store/editor.js";

/**
 * The project's ship templates.
 *
 * Variants are shown under the template they copy, because that is what
 * `copy()` means in the emitted Lua: the base must exist earlier in the
 * same file, so the nesting on screen is the nesting in the output.
 */
export function TemplateList(): JSX.Element {
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedTemplateId);
  const selectTemplate = useEditor((s) => s.selectTemplate);
  const addTemplate = useEditor((s) => s.addTemplate);
  const copyTemplate = useEditor((s) => s.copyTemplate);
  const deleteTemplate = useEditor((s) => s.deleteTemplate);

  if (project === null) return <section className="panel" />;

  const templates = project.templates;
  const roots = templates.filter((t) => t.copyOf === null);
  const orphans = templates.filter(
    (t) => t.copyOf !== null && !templates.some((base) => base.name === t.copyOf),
  );

  const row = (id: string, name: string, note: string, depth: number): JSX.Element => (
    <li key={id} className={id === selectedId ? "selected" : ""}>
      <button
        type="button"
        className="row"
        style={{ paddingLeft: `${0.4 + depth * 0.9}rem` }}
        onClick={() => selectTemplate(id)}
      >
        <span>{name}</span>
        <span className="muted">{note}</span>
      </button>
      <button aria-label={`Duplicate template ${name} as a variant`}
        type="button"
        className="small"
        title="Duplicate: create a variant that copies this template. No map object moves to it."
        onClick={() => copyTemplate(id)}
      >
        <span aria-hidden="true">⎘</span>
      </button>
      <button aria-label={`Delete template ${name}`} type="button" className="small danger" onClick={() => deleteTemplate(id)}>
        <span aria-hidden="true">✕</span>
      </button>
    </li>
  );

  const branch = (name: string, depth: number): JSX.Element[] =>
    templates
      .filter((t) => t.copyOf === name)
      .flatMap((t) => [row(t.id, t.name, t.className ?? t.kind, depth), ...branch(t.name, depth + 1)]);

  return (
    <section className="panel">
      <h2>
        Project templates <span className="muted">{templates.length}</span>
      </h2>
      <p className="hint">Yours, saved in this project.</p>
      <ul className="template-list">
        {roots.flatMap((t) => [row(t.id, t.name, t.className ?? t.kind, 0), ...branch(t.name, 1)])}
        {orphans.map((t) =>
          row(t.id, t.name, `copies "${t.copyOf ?? ""}" — missing`, 0),
        )}
      </ul>
      {templates.length === 0 && (
        <p className="hint">
          None yet. A template defined here is written to the launch-time file, which EE loads
          before any scenario.
        </p>
      )}
      <button type="button" className="small" onClick={() => addTemplate("New Hull")}>
        + Template
      </button>
    </section>
  );
}

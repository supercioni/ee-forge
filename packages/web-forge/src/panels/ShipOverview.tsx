import type { EETemplateDef } from "@forge/contracts";
import { stockTemplateNamed } from "@forge/core/editor";
import { useEditor } from "../store/editor.js";
import { DeckPlan } from "./DeckPlan.js";
import { ShipDiagram } from "./ShipDiagram.js";

/** The proposal's technical rail. Reuses the real diagrams, never illustrative values.
 * In Weapons/Interior the diagram already sits beside its editable controls; the rail
 * then yields to Used by. The identity overview is read-only and never loads the 3D chunk.
 */
export function ShipOverview(): JSX.Element | null {
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  const selectedId = useEditor((s) => s.selectedTemplateId);
  const selectedStock = useEditor((s) => s.selectedStockTemplate);
  const section = useEditor((s) => s.shipSection);
  const setSection = useEditor((s) => s.setShipSection);
  if (project === null || (section !== "identity" && section !== "movement")) return null;
  const stock = selectedStock === null ? null : stockTemplateNamed(library, selectedStock);
  const template: EETemplateDef | null = selectedStock !== null
    ? stock === null ? null : { ...stock, id: stock.name, copyOf: null }
    : project.templates.find((t) => t.id === selectedId) ?? null;
  if (template === null) return null;
  return (
    <section className="panel ship-overview" aria-label="Technical preview">
      <h2>Technical preview</h2>
      <p className="hint">Diagrams from this hull’s properties.</p>
      <ShipDiagram template={template} />
      <button type="button" className="row-link preview-link" onClick={() => setSection("weapons")}>View weapons</button>
      <DeckPlan key={template.id} template={template} readOnly />
      <button type="button" className="row-link preview-link" onClick={() => setSection("interior")}>View rooms and doors</button>
    </section>
  );
}

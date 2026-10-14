import { useEditor } from "../store/editor.js";
import { RetargetOffer } from "./RetargetOffer.js";
import { ShipOverview } from "./ShipOverview.js";
import { ShipContext } from "./ShipContext.js";
import { ShipInspector } from "./ShipInspector.js";
import { StockTemplateList } from "./StockTemplateList.js";
import { TemplateList } from "./TemplateList.js";
import { Splitter } from "../ui/Splitter.js";
import { SHIP_DIAGRAMS, SHIP_LISTS } from "../ui/split.js";
import { useColumnCap } from "../ui/useColumnCap.js";
import { useColumnWidth } from "../ui/useColumnWidth.js";

/**
 * The ship view: the project's templates and the originals in the install
 * (two lists, never one), one form in five sections, and where the selected
 * hull is used.
 *
 * The pictures live inside the form, beside the block they explain (firing
 * arcs by the weapons, the deck plan by the rooms and doors, the model by the
 * hull). The right column — draggable, its width remembered — answers the
 * other question: which map objects spawn this, and how do I get to them.
 */
export function ShipView(): JSX.Element {
  const panelWidth = useEditor((s) => s.shipPanelWidth);
  const setPanelWidth = useEditor((s) => s.setShipPanelWidth);
  const cap = useColumnCap();
  const [listWidth, setListWidth] = useColumnWidth("shipLists", SHIP_LISTS);

  return (
    // The right column is draggable, so the grid template comes from
    // state rather than the stylesheet. It is the only inline style in the
    // view, and it is the one thing the stylesheet cannot know.
    <div
      className="workspace ship"
      style={{ gridTemplateColumns: `${cap(listWidth, 24)} 6px 1fr 6px ${cap(panelWidth, 34)}` }}
    >
      <aside className="left ship-lists">
        <TemplateList />
        <StockTemplateList />
      </aside>
      <Splitter side="left" width={listWidth} onChange={setListWidth} spec={SHIP_LISTS} label="Template lists width" />
      <main className="ship-main">
        <RetargetOffer />
        <ShipInspector />
      </main>
      <Splitter width={panelWidth} onChange={setPanelWidth} spec={SHIP_DIAGRAMS} label="Used-by column width" />
      <aside className="right ship-diagrams" aria-label="Where it is used">
        <ShipOverview />
        <ShipContext />
      </aside>
    </div>
  );
}

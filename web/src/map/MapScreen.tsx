// City map screen (travel mode) and the "Where's your tindahan?" picker (pick mode).
import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "../components/useFocusTrap";
import { useGame } from "../game/GameProvider";
import { Button } from "../components/ui";
import { loadCityMap, tintFor, type CityMap } from "./mapData";
import { MapView } from "./MapView";

export function MapPanel({
  mode,
  onRide,
  onPick,
  highlight = null,
}: {
  mode: "travel" | "pick";
  onRide?: (barangay: string | null) => void;
  onPick?: (barangay: string) => void;
  highlight?: string | null;
}) {
  const { barangayCounts, me, accountId, rules } = useGame();
  const [map, setMap] = useState<CityMap | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ name: string; n: number } | null>(null);
  const [list, setList] = useState(false);
  const [query, setQuery] = useState("");
  const home = me?.barangay ?? null;
  const verb = useMemo(() => {
    try {
      return window.matchMedia?.("(pointer: coarse)").matches ? "Tap" : "Click";
    } catch {
      return "Tap";
    }
  }, []);

  useEffect(() => {
    loadCityMap()
      .then(setMap)
      .catch(() => {
        setFailed(true);
        setList(true);
      });
  }, []);

  const names = useMemo(() => rules?.barangays ?? map?.barangays.map((b) => b.name) ?? [], [rules, map]);
  const shown = names.filter((n) => n.toLowerCase().includes(query.trim().toLowerCase()));
  const count = (n: string) => barangayCounts[n] ?? 0;
  const players = (n: string) => (count(n) === 0 ? "No players yet" : `${count(n)} player${count(n) === 1 ? "" : "s"}`);

  return (
    <div className="map-panel">
      {map && !failed ? (
        <MapView
          map={map}
          counts={barangayCounts}
          home={home}
          selected={selected}
          avatarId={accountId}
          onSelect={setSelected}
          highlight={highlight}
          focus={focus}
        />
      ) : (
        <div className="map-loading">{failed ? "The map couldn't load. Use the list." : "Unfolding the map…"}</div>
      )}

      {list ? (
        <div className="map-list" role="dialog" aria-label="Barangays">
          <input className="input search" placeholder="Search 27 barangays…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search barangays" data-autofocus />
          <ul>
            {shown.map((n) => (
              <li key={n}>
                <button
                  className={`map-list-row${selected === n ? " map-list-on" : ""}${n === highlight ? " map-list-tip" : ""}`}
                  onClick={() => {
                    setSelected(n);
                    setFocus({ name: n, n: Date.now() });
                    if (!failed) setList(false);
                  }}
                >
                  <span className="swatch" style={{ background: tintFor(count(n)) }} />
                  <span className="map-list-name">{n}</span>
                  {n === home ? <span className="tag">home</span> : null}
                  {n === highlight ? <span className="tag tag-preview">tip</span> : null}
                  <span className="muted small">{count(n)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="map-bottom">
        {selected ? (
          <div className="map-chip" role="status">
            <div className="map-chip-head">
              <strong>{selected}</strong>
              <span className="muted">
                {players(selected)}
                {selected === home ? " · your barangay" : ""}
              </span>
              <button className="icon-btn map-chip-x" aria-label="Close" onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>
            {mode === "pick" ? (
              <Button onClick={() => onPick?.(selected)}>Put my tindahan here</Button>
            ) : selected === home ? (
              <Button onClick={() => onRide?.(null)}>Go home</Button>
            ) : (
              <Button onClick={() => onRide?.(selected)}>Ride the jeepney</Button>
            )}
          </div>
        ) : (
          <p className="map-hint">
            {mode === "pick" ? `${verb} your barangay on the map, or use the list.` : `${verb} a barangay to visit its street.`}
          </p>
        )}
        <div className="map-tools">
          <button className={`chip${list ? " chip-on" : ""}`} onClick={() => setList(!list)} aria-expanded={list}>
            {list ? "Map" : "List"}
          </button>
          <div className="map-legend" aria-label="Players per barangay">
            {[0, 1, 2, 4, 7].map((n, i) => (
              <span key={n} className="legend-cell">
                <span className="swatch" style={{ background: tintFor(n) }} />
                {["0", "1", "2–3", "4–6", "7+"][i]}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MapScreen({ onRide }: { onRide: (barangay: string | null) => void }) {
  return (
    <div className="map-stage">
      <MapPanel mode="travel" onRide={onRide} />
    </div>
  );
}

/** Full-screen picker shown after joining and from the menu. */
export function BarangayPicker({ onClose, tip }: { onClose: () => void; tip?: { name: string; barangay: string } | null }) {
  const { actions, me } = useGame();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);
  return (
    <div className="picker-overlay" role="dialog" aria-modal="true" aria-label="Where's your tindahan?" ref={ref} tabIndex={-1}>
      <header className="picker-head">
        <div>
          <h2>Where's your tindahan?</h2>
          <p className="drawer-text">Pick your barangay in Mandaluyong. Only the barangay name is stored on-chain, never an address.</p>
          {tip ? (
            <p className="drawer-text picker-tip">
              Tip: <b>{tip.name}</b>, your first lender, is in <b>{tip.barangay}</b>.
            </p>
          ) : null}
        </div>
        <button className="icon-btn icon-close" onClick={onClose} aria-label={me?.barangay ? "Close" : "Choose later"}>
          ✕
        </button>
      </header>
      <div className="picker-map">
        <MapPanel
          mode="pick"
          highlight={tip?.barangay ?? null}
          onPick={async (b) => {
            if (await actions.setBarangay(b)) onClose();
          }}
        />
      </div>
    </div>
  );
}

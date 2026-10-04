import { MAX_POINTS, MAX_POIS, orderPois, roundCoord, sameCoords, type LonLat, type PoiDraft, type PoiType } from "@/components/admin/routes/route-geometry";

/**
 * Editing state of one DRAFT revision (P3-F): the working copy of the geometry and the POIs, with undo/redo and the last server-confirmed
 * copy ("baseline"). Pure reducer: every id and every point arrives inside the action, so each rule has a unit test. Nothing here is a
 * source of truth: "saved" is dispatched only after the API confirmed the write, with what the API answered.
 */
export type Snapshot = { readonly coords: readonly LonLat[]; readonly pois: readonly PoiDraft[] };

export type EditorState = {
  present: Snapshot;
  baseline: Snapshot;
  past: Snapshot[];
  future: Snapshot[];
  selected: number | null;
};

export const HISTORY_LIMIT = 100;

export function initialEditorState(snapshot: Snapshot): EditorState {
  return { present: snapshot, baseline: snapshot, past: [], future: [], selected: null };
}

export type EditorAction =
  | { type: "add_vertex"; point: LonLat }
  | { type: "insert_vertex"; index: number; point: LonLat }
  | { type: "move_vertex"; index: number; point: LonLat }
  | { type: "delete_vertex"; index: number }
  | { type: "replace_geometry"; coords: readonly LonLat[] }
  | { type: "set_edge_poi"; poi_type: "START" | "FINISH"; key: string; point: LonLat; name: string }
  | { type: "add_poi"; poi: PoiDraft }
  | { type: "update_poi"; key: string; patch: Partial<Omit<PoiDraft, "key">> }
  | { type: "remove_poi"; key: string }
  | { type: "select"; index: number | null }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "saved"; snapshot: Snapshot };

export function isDirty(state: EditorState): boolean {
  if (state.present === state.baseline) return false;
  if (!sameCoords(state.present.coords as LonLat[], state.baseline.coords as LonLat[])) return true;
  const a = state.present.pois;
  const b = state.baseline.pois;
  if (a.length !== b.length) return true;
  return a.some((poi, index) => {
    const other = b[index];
    return (
      poi.key !== other.key ||
      poi.poi_type !== other.poi_type ||
      poi.name !== other.name ||
      poi.description !== other.description ||
      poi.longitude !== other.longitude ||
      poi.latitude !== other.latitude
    );
  });
}

function commit(state: EditorState, next: Snapshot, selected: number | null = state.selected): EditorState {
  const past = [...state.past, state.present];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { ...state, present: next, past, future: [], selected };
}

function clampSelected(selected: number | null, length: number): number | null {
  if (selected === null || length === 0) return null;
  return Math.min(selected, length - 1);
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const { coords, pois } = state.present;
  switch (action.type) {
    case "add_vertex": {
      if (coords.length >= MAX_POINTS) return state;
      return commit(state, { coords: [...coords, roundCoord(action.point)], pois }, coords.length);
    }
    case "insert_vertex": {
      if (coords.length >= MAX_POINTS) return state;
      const index = Math.max(0, Math.min(action.index, coords.length));
      const next = [...coords.slice(0, index), roundCoord(action.point), ...coords.slice(index)];
      return commit(state, { coords: next, pois }, index);
    }
    case "move_vertex": {
      if (action.index < 0 || action.index >= coords.length) return state;
      const point = roundCoord(action.point);
      const current = coords[action.index];
      if (current[0] === point[0] && current[1] === point[1]) return state;
      const next = coords.slice();
      next[action.index] = point;
      return commit(state, { coords: next, pois }, action.index);
    }
    case "delete_vertex": {
      if (action.index < 0 || action.index >= coords.length) return state;
      const next = coords.filter((_, index) => index !== action.index);
      return commit(state, { coords: next, pois }, clampSelected(action.index, next.length));
    }
    case "replace_geometry": {
      if (action.coords.length < 2 || action.coords.length > MAX_POINTS) return state;
      return commit(state, { coords: action.coords.map(roundCoord), pois }, null);
    }
    case "set_edge_poi": {
      // One START and one FINISH at most: configuring it again moves the existing one (and keeps its name and description).
      const existing = pois.find((poi) => poi.poi_type === action.poi_type);
      const [longitude, latitude] = roundCoord(action.point);
      const next = existing
        ? pois.map((poi) => (poi === existing ? { ...poi, longitude, latitude } : poi))
        : [...pois, { key: action.key, poi_type: action.poi_type, name: action.name, description: "", longitude, latitude }];
      if (!existing && pois.length >= MAX_POIS) return state;
      return commit(state, { coords, pois: orderPois(next) });
    }
    case "add_poi": {
      if (pois.length >= MAX_POIS) return state;
      return commit(state, { coords, pois: orderPois([...pois, action.poi]) });
    }
    case "update_poi": {
      const target = pois.find((poi) => poi.key === action.key);
      if (!target) return state;
      const patch = { ...action.patch };
      if (typeof patch.longitude === "number" || typeof patch.latitude === "number") {
        const [longitude, latitude] = roundCoord([patch.longitude ?? target.longitude, patch.latitude ?? target.latitude]);
        patch.longitude = longitude;
        patch.latitude = latitude;
      }
      const type: PoiType | undefined = patch.poi_type;
      // Changing a POI into a START/FINISH would leave two of them; the other one becomes a generic point so the rule holds.
      const next = pois.map((poi) => {
        if (poi.key === action.key) return { ...poi, ...patch };
        if ((type === "START" || type === "FINISH") && poi.poi_type === type) return { ...poi, poi_type: "OTHER" as PoiType };
        return poi;
      });
      return commit(state, { coords, pois: orderPois(next) });
    }
    case "remove_poi": {
      if (!pois.some((poi) => poi.key === action.key)) return state;
      return commit(state, { coords, pois: pois.filter((poi) => poi.key !== action.key) });
    }
    case "select": {
      const selected = action.index === null ? null : clampSelected(action.index, coords.length);
      return selected === state.selected ? state : { ...state, selected };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        present: previous,
        past: state.past.slice(0, -1),
        future: [state.present, ...state.future],
        selected: clampSelected(state.selected, previous.coords.length),
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return {
        ...state,
        present: next,
        past: [...state.past, state.present],
        future: rest,
        selected: clampSelected(state.selected, next.coords.length),
      };
    }
    case "saved":
      return { present: action.snapshot, baseline: action.snapshot, past: [], future: [], selected: clampSelected(state.selected, action.snapshot.coords.length) };
  }
}

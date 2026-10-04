import { describe, expect, test } from "vitest";
import { HISTORY_LIMIT, editorReducer, initialEditorState, isDirty, type EditorAction, type EditorState } from "@/components/admin/routes/route-editor-state";
import { MAX_POIS, type LonLat, type PoiDraft } from "@/components/admin/routes/route-geometry";

const A: LonLat = [-100.3, 25.6];
const B: LonLat = [-100.2, 25.7];
const C: LonLat = [-100.1, 25.8];
const poi = (key: string, poi_type: PoiDraft["poi_type"] = "OTHER", name = key): PoiDraft => ({ key, poi_type, name, description: "", longitude: -100.25, latitude: 25.65 });

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}
const empty = () => initialEditorState({ coords: [], pois: [] });

describe("editing the trace", () => {
  test("add appends and selects the new vertex; insert goes in the middle; move and delete keep the rest", () => {
    let s = run(empty(), { type: "add_vertex", point: A }, { type: "add_vertex", point: C });
    expect(s.present.coords).toEqual([A, C]);
    expect(s.selected).toBe(1);
    s = run(s, { type: "insert_vertex", index: 1, point: B });
    expect(s.present.coords).toEqual([A, B, C]);
    expect(s.selected).toBe(1);
    s = run(s, { type: "move_vertex", index: 1, point: [-100.15, 25.75] });
    expect(s.present.coords[1]).toEqual([-100.15, 25.75]);
    s = run(s, { type: "delete_vertex", index: 0 });
    expect(s.present.coords).toEqual([[-100.15, 25.75], C]);
  });

  test("coordinates are rounded to six decimals and a move to the same place is not an edit", () => {
    let s = run(empty(), { type: "add_vertex", point: [-100.31612345678, 25.6866] });
    expect(s.present.coords[0]).toEqual([-100.316123, 25.6866]);
    const before = s;
    s = run(s, { type: "move_vertex", index: 0, point: [-100.316123, 25.6866] });
    expect(s).toBe(before);
  });

  test("out of range indexes change nothing", () => {
    const s = run(empty(), { type: "add_vertex", point: A });
    expect(run(s, { type: "move_vertex", index: 5, point: B })).toBe(s);
    expect(run(s, { type: "delete_vertex", index: -1 })).toBe(s);
  });
});

describe("undo, redo and dirty", () => {
  test("each edit is one undo step; a new edit clears redo", () => {
    let s = run(empty(), { type: "add_vertex", point: A }, { type: "add_vertex", point: B }, { type: "add_vertex", point: C });
    s = run(s, { type: "undo" }, { type: "undo" });
    expect(s.present.coords).toEqual([A]);
    s = run(s, { type: "redo" });
    expect(s.present.coords).toEqual([A, B]);
    s = run(s, { type: "add_vertex", point: C });
    expect(s.future).toEqual([]);
    expect(run(s, { type: "redo" })).toBe(s);
  });

  test("dirty follows the content: undoing back to the saved copy is clean again", () => {
    const saved = run(empty(), { type: "add_vertex", point: A }, { type: "add_vertex", point: B }, { type: "saved", snapshot: { coords: [A, B], pois: [] } });
    expect(isDirty(saved)).toBe(false);
    const edited = run(saved, { type: "add_vertex", point: C });
    expect(isDirty(edited)).toBe(true);
    expect(isDirty(run(edited, { type: "undo" }))).toBe(false);
    // add then delete the same vertex: different history, same content
    expect(isDirty(run(saved, { type: "add_vertex", point: C }, { type: "delete_vertex", index: 2 }))).toBe(false);
  });

  test("saved replaces the working copy and the baseline and drops the history", () => {
    const s = run(empty(), { type: "add_vertex", point: A }, { type: "add_vertex", point: B }, { type: "saved", snapshot: { coords: [A, B, C], pois: [poi("p1")] } });
    expect(s.past).toEqual([]);
    expect(s.future).toEqual([]);
    expect(s.present.coords).toHaveLength(3);
    expect(isDirty(s)).toBe(false);
  });

  test("history is bounded", () => {
    let s = empty();
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) s = run(s, { type: "add_vertex", point: [i / 1000, 0] });
    expect(s.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("start, finish and points of interest", () => {
  test("start and finish are unique: configuring again moves the existing one and keeps its name", () => {
    let s = run(empty(), { type: "set_edge_poi", poi_type: "START", key: "s1", point: A, name: "Salida" });
    s = run(s, { type: "update_poi", key: "s1", patch: { name: "Arco de salida" } });
    s = run(s, { type: "set_edge_poi", poi_type: "START", key: "s2", point: B, name: "Salida" });
    const starts = s.present.pois.filter((p) => p.poi_type === "START");
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ key: "s1", name: "Arco de salida", longitude: B[0], latitude: B[1] });
  });

  test("start sorts first and finish last", () => {
    const s = run(
      empty(),
      { type: "add_poi", poi: poi("h") },
      { type: "set_edge_poi", poi_type: "FINISH", key: "f", point: C, name: "Meta" },
      { type: "set_edge_poi", poi_type: "START", key: "s", point: A, name: "Salida" },
    );
    expect(s.present.pois.map((p) => p.key)).toEqual(["s", "h", "f"]);
  });

  test("turning a point into the start demotes the previous start, so there is still one", () => {
    let s = run(empty(), { type: "set_edge_poi", poi_type: "START", key: "s", point: A, name: "Salida" }, { type: "add_poi", poi: poi("h", "HYDRATION") });
    s = run(s, { type: "update_poi", key: "h", patch: { poi_type: "START" } });
    expect(s.present.pois.filter((p) => p.poi_type === "START").map((p) => p.key)).toEqual(["h"]);
    expect(s.present.pois.find((p) => p.key === "s")?.poi_type).toBe("OTHER");
  });

  test("update rounds coordinates, remove drops the point, unknown keys change nothing, and the cap holds", () => {
    let s = run(empty(), { type: "add_poi", poi: poi("a") }, { type: "update_poi", key: "a", patch: { latitude: 25.123456789 } });
    expect(s.present.pois[0].latitude).toBe(25.123457);
    expect(run(s, { type: "update_poi", key: "zzz", patch: { name: "x" } })).toBe(s);
    s = run(s, { type: "remove_poi", key: "a" });
    expect(s.present.pois).toEqual([]);
    let full = empty();
    for (let i = 0; i < MAX_POIS; i += 1) full = run(full, { type: "add_poi", poi: poi(`p${i}`) });
    expect(run(full, { type: "add_poi", poi: poi("extra") })).toBe(full);
  });
});

describe("selection and replacing the geometry", () => {
  test("select clamps to the trace and replace_geometry needs two points", () => {
    let s = run(empty(), { type: "add_vertex", point: A }, { type: "add_vertex", point: B });
    s = run(s, { type: "select", index: 99 });
    expect(s.selected).toBe(1);
    expect(run(s, { type: "replace_geometry", coords: [A] })).toBe(s);
    const replaced = run(s, { type: "replace_geometry", coords: [A, B, C] });
    expect(replaced.present.coords).toHaveLength(3);
    expect(replaced.selected).toBeNull();
    expect(isDirty(replaced)).toBe(true);
  });
});

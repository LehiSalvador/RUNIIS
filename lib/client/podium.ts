/**
 * Podium layout rule (ui-spec §3.7, UX AC-J6-2). Occupants are everyone ranked 1-3 (competition
 * ranking, so ties repeat a rank). Up to three occupants keep the three-pedestal shape, filled by
 * finishing order (not by rank number), so a 1,1,3 tie still shows all three people. More than
 * three switches to a ranked list so no pedestal ever holds two people.
 */
export type PodiumPlace = "first" | "second" | "third";

export type PodiumLayout<T> =
  | { mode: "pedestal"; slots: Array<{ occupant: T; place: PodiumPlace }> }
  | { mode: "list"; rows: T[] };

export function arrangePodium<T extends { rank: number }>(occupants: readonly T[]): PodiumLayout<T> {
  const top = occupants
    .map((occupant, index) => ({ occupant, index }))
    .filter(({ occupant }) => occupant.rank >= 1 && occupant.rank <= 3)
    .sort((a, b) => a.occupant.rank - b.occupant.rank || a.index - b.index)
    .map(({ occupant }) => occupant);

  if (top.length > 3) return { mode: "list", rows: top };

  const places: PodiumPlace[] = ["first", "second", "third"];
  return { mode: "pedestal", slots: top.map((occupant, i) => ({ occupant, place: places[i] })) };
}

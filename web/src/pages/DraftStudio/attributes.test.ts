import { describe, expect, it } from "vitest";
import type { Hero } from "../../types";
import { groupByAttribute } from "./attributes";

const hero = (key: string, attr: Hero["primary_attr"]): Hero => ({
  key,
  display_name: key[0].toUpperCase() + key.slice(1),
  primary_attr: attr,
  attack_type: "melee",
  roles: [],
});

describe("groupByAttribute", () => {
  it("groups in game order with A-Z inside each group", () => {
    const groups = groupByAttribute([
      hero("zeus", "int"),
      hero("axe", "str"),
      hero("mirana", "agi"),
      hero("lina", "int"),
      hero("marci", "all"),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Strength",
      "Agility",
      "Intelligence",
      "Universal",
    ]);
    expect(groups[2].heroes.map((h) => h.key)).toEqual(["lina", "zeus"]);
  });

  it("drops empty groups and buckets unknown attributes into Universal", () => {
    const weird = { ...hero("odd", "all"), primary_attr: "???" as Hero["primary_attr"] };
    const groups = groupByAttribute([hero("axe", "str"), weird]);
    expect(groups.map((g) => g.label)).toEqual(["Strength", "Universal"]);
    expect(groups[1].heroes[0].key).toBe("odd");
  });
});

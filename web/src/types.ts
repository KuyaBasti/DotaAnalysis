// Mirrors the API's patch-data responses. Like the API's own types, these are
// hand-written for now and should eventually be generated from schemas/.

export interface Hero {
  key: string;
  display_name: string;
  primary_attr: "str" | "agi" | "int" | "all";
  attack_type: "melee" | "ranged";
  roles: string[];
}

export interface PatchesResponse {
  patches: string[];
}

export interface HeroesResponse {
  patch_id: string;
  heroes: Hero[];
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

// The schemas in /schemas are the cross-language source of truth. These tests
// validate the ACTUAL responses of every /analysis/* route against them, so a
// drift between the API and the contract breaks here instead of shipping — the
// bug shape that once silently dropped the `bracket` field.

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");
const schemasDir = path.join(here, "..", "..", "schemas");

const ajv = new Ajv({ strict: false });
// Ajv registers schemas by $id and refuses to compile the same one twice, so
// validators are memoized rather than recompiled per test.
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
function validatorFor(name: string) {
  let v = validators.get(name);
  if (!v) {
    v = ajv.compile(
      JSON.parse(fs.readFileSync(path.join(schemasDir, `${name}.schema.json`), "utf8")),
    );
    validators.set(name, v);
  }
  return v;
}

function makeApp(modelsDir: string) {
  return buildApp({ snapshotDir: fixturesDir, simDir: fixturesDir, modelsDir });
}

async function post(modelsDir: string, url: string, payload: object) {
  const app = makeApp(modelsDir);
  const res = await app.inject({
    method: "POST",
    url,
    payload: { patch_id: "7.39c", ...payload },
  });
  await app.close();
  expect(res.statusCode).toBe(200);
  return res.json();
}

const pairsDir = path.join(fixturesDir, "with-pairs");
const timingDir = path.join(fixturesDir, "with-timing");
const DRAFT = { radiant: ["juggernaut", "crystal_maiden"], dire: ["lich"] };

describe("analysis responses honour their schemas", () => {
  it("POST /analysis/draft matches draft-eval.schema.json", async () => {
    const validate = validatorFor("draft-eval");
    const body = await post(pairsDir, "/analysis/draft", { ...DRAFT, bracket: "low" });
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  });

  it("POST /analysis/explain matches draft-explanation.schema.json", async () => {
    const validate = validatorFor("draft-explanation");
    const body = await post(pairsDir, "/analysis/explain", DRAFT);
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  });

  it("POST /analysis/suggest matches draft-suggestions.schema.json", async () => {
    const validate = validatorFor("draft-suggestions");
    const body = await post(pairsDir, "/analysis/suggest", {
      radiant: ["juggernaut"],
      dire: ["lich"],
      side: "dire",
      rank_by: "fit",
    });
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  });

  it("POST /analysis/timing matches draft-timing.schema.json", async () => {
    const validate = validatorFor("draft-timing");
    const body = await post(timingDir, "/analysis/timing", DRAFT);
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  });

  it("the schemas reject drift, not just accept the present", () => {
    // A contract that accepts anything is decoration. Prove additionalProperties
    // bites: a stray field must fail draft-eval.
    const validate = validatorFor("draft-eval");
    expect(
      validate({
        patch_id: "7.39c",
        bracket: "all",
        radiant_win_probability: 0.5,
        stray: true,
      }),
    ).toBe(false);
  });
});

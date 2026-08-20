import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain-JS build script, no declaration file; the test only
// needs its two exports and vitest executes it fine.
import { OUTPUT_PATH, generate } from "../../scripts/generate-types.mjs";

// The generated types are checked in so tsc and editors need no plumbing —
// which means they can silently drift from schemas/. This test regenerates
// them in memory and diffs against the file on disk, so a schema edit without
// `npm run generate:types` fails the suite instead of shipping stale types.
describe("generated types freshness", () => {
  it("src/types/generated.ts matches what the schemas generate", async () => {
    const onDisk = await readFile(OUTPUT_PATH, "utf8");
    expect(onDisk).toBe(await generate());
  });
});

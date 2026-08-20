// Generate web/src/types/generated.ts from schemas/*.schema.json — the
// cross-language contracts. The API side enforces these schemas at runtime
// (api/tests/contracts.test.ts, ajv); this makes the web side's compile-time
// types come from the same source of truth, so a contract change that isn't
// reflected here fails `npm test` (freshness test) instead of surfacing as a
// runtime surprise.
//
//   npm run generate:types    # regenerate after editing schemas/
//
// Kept as a checked-in file rather than a build step so `tsc` and editors need
// no plumbing; the freshness test is what keeps it honest.

import { compile } from "json-schema-to-typescript";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = resolve(HERE, "..", "..", "schemas");
export const OUTPUT_PATH = resolve(HERE, "..", "src", "types", "generated.ts");

// Response shapes the web consumes. timeline-event and scenario are pulled in
// transitively by sim-result / sim-aggregate via $ref and declared once.
const ROOTS = [
  "sim-result.schema.json",
  "sim-aggregate.schema.json",
  "draft-eval.schema.json",
  "draft-explanation.schema.json",
  "draft-suggestions.schema.json",
  "draft-timing.schema.json",
];

const HEADER = `// GENERATED from schemas/*.schema.json — do not edit by hand.
// Regenerate with \`npm run generate:types\`; a freshness test fails when this
// file and the schemas disagree.
/* eslint-disable */

`;

export async function generate() {
  const seen = new Set();
  const chunks = [HEADER];
  for (const name of ROOTS) {
    const schema = JSON.parse(await readFile(join(SCHEMAS_DIR, name), "utf8"));
    const compiled = await compile(schema, schema.title ?? name, {
      cwd: SCHEMAS_DIR, // resolves cross-file $refs like timeline-event.schema.json
      bannerComment: "",
      additionalProperties: false,
      style: { singleQuote: false },
    });
    // Cross-file $refs (TimelineEvent, Scenario) compile into every root that
    // uses them; keep the first declaration of each interface and drop repeats.
    for (const block of compiled.split(/\n(?=export )/)) {
      const m = /^export (?:interface|type) (\w+)/.exec(block);
      const key = m ? m[1] : block;
      if (seen.has(key)) continue;
      seen.add(key);
      chunks.push(block.endsWith("\n") ? block : `${block}\n`);
    }
  }
  return chunks.join("");
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const code = await generate();
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, code);
  console.log(`wrote ${OUTPUT_PATH} (${code.length} bytes)`);
}

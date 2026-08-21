/**
 * Cross-language schema consistency check — TypeScript side.
 * Counterpart of tests/test_schema_consistency.py.
 *
 * Reads the same canonical tegata.schema.json and checks the Zod schemas
 * agree with it. If you add/rename a field or enum value in
 * tegata.schema.json, update this file, its Python counterpart, and both
 * models.py / schema.ts, or this test will fail on purpose.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  RiskTier,
  WarrantStatus,
  AccessRequestSchema,
  WarrantSchema,
} from "../packages/schema/ts/schema";

const schemaPath = join(__dirname, "..", "packages", "schema", "tegata.schema.json");
const jsonSchema = JSON.parse(readFileSync(schemaPath, "utf-8"));

function assertSetsEqual(actual: Set<string>, expected: Set<string>, label: string) {
  const actualArr = [...actual].sort();
  const expectedArr = [...expected].sort();
  const same =
    actualArr.length === expectedArr.length &&
    actualArr.every((v, i) => v === expectedArr[i]);
  if (!same) {
    throw new Error(
      `${label} mismatch: schema=${JSON.stringify(expectedArr)} ts=${JSON.stringify(actualArr)}`
    );
  }
  console.log(`OK: ${label}`);
}

// RiskTier enum
assertSetsEqual(
  new Set(RiskTier.options),
  new Set(jsonSchema.definitions.RiskTier.enum),
  "RiskTier"
);

// WarrantStatus enum
assertSetsEqual(
  new Set(WarrantStatus.options),
  new Set(jsonSchema.definitions.WarrantStatus.enum),
  "WarrantStatus"
);

// AccessRequest required fields
const accessRequestShape = AccessRequestSchema.shape;
const accessRequestRequired = new Set(
  Object.entries(accessRequestShape)
    .filter(([, v]: [string, any]) => !v.isOptional())
    .map(([k]) => k)
);
assertSetsEqual(
  accessRequestRequired,
  new Set(jsonSchema.definitions.AccessRequest.required),
  "AccessRequest required fields"
);

// Warrant required fields (used is intentionally excluded — see schema comment)
const warrantShape = WarrantSchema.shape;
const warrantRequired = new Set(
  Object.entries(warrantShape)
    .filter(([, v]: [string, any]) => !v.isOptional())
    .map(([k]) => k)
);
assertSetsEqual(
  warrantRequired,
  new Set(jsonSchema.definitions.Warrant.required),
  "Warrant required fields"
);

console.log("All schema consistency checks passed.");

/**
 * Stretch B (ROADMAP.md Phase 7 #2): "after a PDF is generated, OCR is
 * re-run on the rendered visual output and compared against the
 * original text/metadata layer. A mismatch signals a possible
 * layer-mismatch attack" (docs/tegata-concept.md's own description).
 *
 * This module owns the ZIP parsing (foxitPdfServicesClient.ts stays a
 * thin, mechanical port of Foxit's 4 REST calls with no parsing mixed
 * in) and the actual consistency check: does every fact Tegata KNOWS
 * it put into the document (from buildWarrantVariables()'s own
 * output — the same values passed to Doctavian, not re-derived here)
 * actually appear in what Foxit's OCR+layout engine independently read
 * back out of the rendered PDF?
 *
 * This is a real re-implementation of the visual layer via OCR, not a
 * trust-the-same-source check — Doctavian and this extraction call are
 * two independent Foxit-family services reading the SAME rendered
 * bytes two different ways (template substitution vs. pixel-level
 * OCR), which is exactly the layer-mismatch attack this is meant to
 * catch: a PDF whose text stream says one thing but whose rendered
 * appearance (what OCR sees) says another.
 */
import JSZip from "jszip";
import { extractStructure, FoxitPdfServicesConfig } from "./foxitPdfServicesClient";

export interface StructuralExtractionElement {
  id: string;
  type: string;
  content?: { text?: string; [key: string]: any };
  region?: { page: number; boundingBox: number[] };
  score?: number;
}

export interface StructuralExtractionResult {
  schemaVersion: string;
  elements: StructuralExtractionElement[];
}

/** Unzips Foxit's result archive and parses StructureInfo.json.
 * result.elements is in document reading order (per Foxit's own docs)
 * — text/title/paragraph/head elements concatenate cleanly. */
export async function parseStructureInfoFromZip(zipBuffer: Buffer): Promise<StructuralExtractionResult> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const entryName = Object.keys(zip.files).find((name) => name.endsWith("StructureInfo.json"));
  if (!entryName) {
    throw new Error(`StructureInfo.json not found in extraction result ZIP. Entries present: ${Object.keys(zip.files).join(", ")}`);
  }
  const raw = await zip.files[entryName].async("string");
  const parsed = JSON.parse(raw);
  const analyzeResult = parsed?.analyzeResult;
  if (!analyzeResult) throw new Error("StructureInfo.json did not contain the expected analyzeResult wrapper");
  return {
    schemaVersion: analyzeResult.version?.schema ?? "unknown",
    elements: analyzeResult.elements ?? [],
  };
}

/** Concatenates every element with readable text, in document order —
 * the "what OCR/layout actually saw" side of the comparison. */
export function extractedTextOf(result: StructuralExtractionResult): string {
  return result.elements
    .map((el) => el.content?.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .join("\n");
}

export interface ConsistencyCheckResult {
  consistent: boolean;
  missingFacts: Array<{ key: string; expectedValue: string }>;
  schemaVersion: string;
  extractedTextPreview: string; // first ~1000 chars, for the demo/debugging — not the full text (could be large)
}

/** The actual check. expectedFacts should be the SAME key/value pairs
 * passed to Doctavian as template variables (buildWarrantVariables()'s
 * output, or a subset of it) — this deliberately does NOT re-derive
 * facts from the warrant object independently, so the comparison is
 * "does the rendered PDF still say what we told Doctavian to put in
 * it," not "does the PDF match some other computation of the truth." */
export function checkConsistency(result: StructuralExtractionResult, expectedFacts: Record<string, string>): ConsistencyCheckResult {
  const extractedText = extractedTextOf(result);
  // Case-insensitive substring match: OCR output frequently differs in
  // case/whitespace from the source text even when content is
  // genuinely correct (font rendering, line wraps) — an exact-string
  // comparison would produce false positives that erode trust in the
  // check. This does mean a sufficiently subtle tampering (e.g.
  // swapping two digits within an otherwise-matching context) could
  // slip past a substring check if the rest of the surrounding text
  // still matches elsewhere in the document — flagged here as a real
  // limitation, not silently assumed away.
  const normalizedExtracted = extractedText.toLowerCase();
  const missingFacts = Object.entries(expectedFacts)
    .filter(([, value]) => value && !normalizedExtracted.includes(String(value).toLowerCase()))
    .map(([key, expectedValue]) => ({ key, expectedValue: String(expectedValue) }));

  return {
    consistent: missingFacts.length === 0,
    missingFacts,
    schemaVersion: result.schemaVersion,
    extractedTextPreview: extractedText.slice(0, 1000),
  };
}

/** Runs the full pipeline: upload+extract+poll+download (Foxit PDF
 * Services), unzip, parse, compare. */
export async function runOcrConsistencyCheck(
  config: FoxitPdfServicesConfig,
  pdfBuffer: Buffer,
  fileName: string,
  expectedFacts: Record<string, string>,
  opts: { maxWaitMs?: number } = {}
): Promise<ConsistencyCheckResult> {
  const zipBuffer = await extractStructure(config, pdfBuffer, fileName, { maxWaitMs: opts.maxWaitMs });
  const structure = await parseStructureInfoFromZip(zipBuffer);
  return checkConsistency(structure, expectedFacts);
}

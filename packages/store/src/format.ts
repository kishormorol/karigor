import { ArtifactSchema, type Artifact } from "./schemas/index.js";

const FENCE = "---";

/** Serialize an artifact as JSON frontmatter between `---` fences, then the Markdown body. */
export function serializeArtifact(a: Artifact): string {
  const meta = JSON.stringify(a.meta, null, 2);
  return `${FENCE}\n${meta}\n${FENCE}\n${a.body}`;
}

export class ArtifactFormatError extends Error {
  override name = "ArtifactFormatError";
}

/** Parse the on-disk form back into a validated artifact. */
export function parseArtifact(text: string): Artifact {
  if (!text.startsWith(`${FENCE}\n`)) throw new ArtifactFormatError("missing opening frontmatter fence");
  const end = text.indexOf(`\n${FENCE}\n`, FENCE.length + 1);
  if (end === -1) throw new ArtifactFormatError("missing closing frontmatter fence");
  const metaText = text.slice(FENCE.length + 1, end);
  let meta: unknown;
  try {
    meta = JSON.parse(metaText);
  } catch (e) {
    throw new ArtifactFormatError(`frontmatter is not JSON: ${(e as Error).message}`);
  }
  const body = text.slice(end + FENCE.length + 2);
  const r = ArtifactSchema.safeParse({ meta, body });
  if (!r.success) throw new ArtifactFormatError(`invalid artifact: ${r.error.message}`);
  return r.data;
}

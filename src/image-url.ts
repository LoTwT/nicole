/** Custom scheme registered by Go for images of the open workspace. */
export const IMAGE_SCHEME = "nicole-image";

const IMAGE_ORIGIN = `${IMAGE_SCHEME}://localhost`;
const ABSOLUTE_URL = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
// Keep this list in step with imageContentTypes in protocol.go.
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

function imageExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  return IMAGE_EXTENSIONS.has(extension) ? extension : null;
}

/**
 * Turns an image URL from a Markdown document into something the editor can
 * display. Relative paths resolve against the document's folder and become a
 * generation-bound nicole-image URL; http(s) and image data URLs are left
 * alone. Anything else is not displayable, so the caller keeps the source.
 */
export function resolveImageUrl(
  src: string,
  docPath: string | null,
  generation: number,
): string | null {
  const trimmed = src.trim();
  if (trimmed === "") return null;

  const scheme = ABSOLUTE_URL.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    if (scheme === "http" || scheme === "https") return trimmed;
    if (scheme === "data" && /^data:image\//i.test(trimmed)) return trimmed;
    return null;
  }
  // A protocol-relative URL would inherit the custom scheme and name a
  // workspace file that the document did not choose.
  if (trimmed.startsWith("//")) return null;
  if (docPath === null || docPath === "" || generation <= 0) return null;
  if (trimmed.includes("\\") || trimmed.includes(":") || /[?#]/.test(trimmed)) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.includes(":")) return null;

  const segments = decoded.startsWith("/")
    ? []
    : docPath.split("/").slice(0, -1);
  const relative = decoded.startsWith("/") ? decoded.slice(1) : decoded;
  for (const part of relative.split("/")) {
    if (part === "") return null;
    if (part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(part);
  }

  // The Go handler refuses hidden folders and node_modules; returning null
  // here keeps the Markdown source visible instead of showing a broken image.
  for (let index = 0; index < segments.length - 1; index++) {
    const part = segments[index]!;
    if (part.startsWith(".") || part === "node_modules") return null;
  }
  const name = segments[segments.length - 1];
  if (name === undefined || imageExtension(name) === null) return null;

  return `${IMAGE_ORIGIN}/${generation}/${segments
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

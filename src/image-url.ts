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

type ImageSource =
  | { kind: "remote"; url: string }
  | { kind: "local"; path: string };

function resolveImageSource(
  src: string,
  docPath: string | null,
): ImageSource | null {
  const trimmed = src.trim();
  if (trimmed === "") return null;

  const scheme = ABSOLUTE_URL.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    if (scheme === "http" || scheme === "https") {
      return { kind: "remote", url: trimmed };
    }
    if (scheme === "data" && /^data:image\//i.test(trimmed)) {
      return { kind: "remote", url: trimmed };
    }
    return null;
  }
  // A protocol-relative URL would inherit the custom scheme and name a
  // workspace file that the document did not choose.
  if (trimmed.startsWith("//")) return null;
  if (docPath === null || docPath === "") return null;
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

  return { kind: "local", path: segments.join("/") };
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
  const source = resolveImageSource(src, docPath);
  if (source === null) return null;
  if (source.kind === "remote") return source.url;
  if (generation <= 0) return null;
  return `${IMAGE_ORIGIN}/${generation}/${source.path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

/**
 * Returns the workspace-relative path only for an image the current workspace
 * can resolve. Remote, data and document-less images return null; Go still
 * rechecks the path, type and generation before revealing it.
 */
export function resolveLocalImagePath(
  src: string,
  docPath: string | null,
): string | null {
  const source = resolveImageSource(src, docPath);
  return source?.kind === "local" ? source.path : null;
}

/**
 * Serializes a local image destination with one URL escape per path segment.
 * Existing escapes are decoded first, so `%20` is not doubled, while query and
 * fragment suffixes and absolute/remote URLs keep their original meaning.
 */
function encodePathSegment(part: string): string {
  // Match the path-segment escaping used for inserted images: parentheses,
  // quotes, ! and * would otherwise terminate or alter a Markdown destination.
  return encodeURIComponent(part).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function formatImageDestination(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.startsWith("//") || ABSOLUTE_URL.test(trimmed)) {
    return trimmed;
  }
  const suffixAt = trimmed.search(/[?#]/);
  const pathPart = suffixAt === -1 ? trimmed : trimmed.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? "" : trimmed.slice(suffixAt);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return trimmed;
  }
  return (
    decoded
      .split("/")
      .map((part) =>
        part === "" || part === "." || part === ".."
          ? part
          : encodePathSegment(part),
      )
      .join("/") + suffix
  );
}

export function leafName(path: string) {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

export function parentPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : "";
}

export function renamedPath(path: string, nextName: string) {
  const parent = parentPath(path);
  return parent ? `${parent}/${nextName}` : nextName;
}

export function replacePathPrefix(path: string, from: string, to: string) {
  if (path === from) {
    return to;
  }
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
}

export function relativeWorkspacePath(path: string, roots: string[]) {
  const normalizedPath = path.replace(/\\/g, "/");
  for (const root of roots) {
    const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalizedPath === normalizedRoot) {
      return leafName(normalizedPath);
    }
    if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
      return normalizedPath.slice(normalizedRoot.length + 1);
    }
  }
  return leafName(normalizedPath);
}

export function isSameOrDescendantPath(path: string, root: string) {
  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function extensionForLanguage(language?: string) {
  switch ((language ?? "").toLowerCase()) {
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "javascript":
    case "js":
    case "mjs":
      return "js";
    case "typescript":
    case "ts":
      return "ts";
    case "tsx":
      return "tsx";
    case "json":
      return "json";
    case "rust":
    case "rs":
      return "rs";
    case "python":
    case "py":
      return "py";
    case "markdown":
    case "md":
      return "md";
    default:
      return "txt";
  }
}

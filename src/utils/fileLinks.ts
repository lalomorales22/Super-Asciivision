/** Match file_path:line_number patterns in text */
const FILE_LINK_RE = /(?:^|\s)((?:\/|\.\/|[a-zA-Z]:\\)[\w./\\-]+(?::\d+)?)/g;

export interface FileLink {
  path: string;
  line?: number;
  start: number;
  end: number;
}

export function extractFileLinks(text: string): FileLink[] {
  const links: FileLink[] = [];
  let match: RegExpExecArray | null;
  FILE_LINK_RE.lastIndex = 0;
  while ((match = FILE_LINK_RE.exec(text)) !== null) {
    const raw = match[1];
    const colonIdx = raw.lastIndexOf(":");
    let path = raw;
    let line: number | undefined;
    if (colonIdx > 0) {
      const maybeNum = raw.slice(colonIdx + 1);
      const parsed = parseInt(maybeNum, 10);
      if (!isNaN(parsed)) {
        path = raw.slice(0, colonIdx);
        line = parsed;
      }
    }
    links.push({
      path,
      line,
      start: match.index + (match[0].length - match[1].length),
      end: match.index + match[0].length,
    });
  }
  return links;
}

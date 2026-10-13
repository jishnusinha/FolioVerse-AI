// Line-level markdown rewriting for the site sync: links/images and stray `<placeholder>` text outside code.

const LINK = /(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
const HTML_TAGS = new Set(['a', 'b', 'br', 'code', 'details', 'div', 'em', 'i', 'img', 'kbd', 'p', 'span', 'strong', 'sub', 'summary', 'sup']);

function codeSpans(line) {
  const spans = [];
  const re = /(`+)[^`]*?\1/g;
  let m;
  while ((m = re.exec(line))) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

/** Applies `fn` to every line outside fenced code blocks. */
function eachProseLine(body, fn) {
  let fence = false;
  return body
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fence = !fence;
        return line;
      }
      return fence ? line : fn(line);
    })
    .join('\n');
}

/**
 * Rewrites markdown links and images outside code.
 * @param {string} body
 * @param {(link: { image: boolean, text: string, href: string, title?: string, raw: string }) => string} fn
 */
export function mapLinks(body, fn) {
  return eachProseLine(body, (line) => {
    const spans = codeSpans(line);
    return line.replace(LINK, (raw, bang, text, href, title, offset) => {
      if (spans.some(([a, b]) => offset >= a && offset < b)) return raw;
      return fn({ image: bang === '!', text, href, title, raw });
    });
  });
}

/** Escapes `<name>` placeholders that are not HTML tags, so markdown does not swallow them as raw HTML. */
export function escapePlaceholders(body) {
  return eachProseLine(body, (line) => {
    const spans = codeSpans(line);
    return line.replace(/<([A-Za-z][\w.-]*)>/g, (raw, name, offset) => {
      if (HTML_TAGS.has(name.toLowerCase()) || spans.some(([a, b]) => offset >= a && offset < b)) return raw;
      return `&lt;${name}&gt;`;
    });
  });
}

/** Removes the first `# Title` line (Starlight renders the frontmatter title) and returns it. */
export function stripTitle(body) {
  const m = /^\s*# (.+)\n/.exec(body);
  return m ? { title: m[1].trim(), body: body.slice(m[0].length).replace(/^\n+/, '') } : { title: '', body };
}

/** YAML frontmatter; strings are JSON-quoted, which is valid YAML. */
export function frontmatter(data) {
  const lines = ['---'];
  const emit = (key, value, indent) => {
    if (value === undefined) return;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${indent}${key}:`);
      for (const [k, v] of Object.entries(value)) emit(k, v, `${indent}  `);
    } else {
      lines.push(`${indent}${key}: ${JSON.stringify(value)}`);
    }
  };
  for (const [k, v] of Object.entries(data)) emit(k, v, '');
  lines.push('---', '');
  return lines.join('\n');
}

export const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

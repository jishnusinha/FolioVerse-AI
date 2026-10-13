import { Link } from 'react-router';
import { joinPath, resolveLink, slugify } from './catalog.js';

/**
 * Markdown subset used by the guides: headings, paragraphs, flat lists (indented continuation lines),
 * GFM tables, fenced code, standalone images and blockquotes; inline code, links, bold and italics.
 * Rendered as React elements only, so page text can never inject markup.
 */

/**
 * @typedef {{ type: 'heading', level: number, text: string, id: string }
 *   | { type: 'paragraph', text: string }
 *   | { type: 'list', ordered: boolean, items: string[] }
 *   | { type: 'code', lang: string, text: string }
 *   | { type: 'table', head: string[], rows: string[][] }
 *   | { type: 'image', alt: string, src: string }
 *   | { type: 'quote', text: string }} Block
 */

const TABLE_SEP = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const LIST_ITEM = /^([-*]|\d+\.)\s+(.*)$/;
const BLOCK_START = /^(```|#{1,4}\s|\||[-*]\s|\d+\.\s|>|!\[)/;
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/;

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

/**
 * @param {string} body
 * @returns {Block[]}
 */
export function parseBlocks(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  /** @type {Block[]} */
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^```(\S*)/.exec(line);
    if (fence) {
      const buf = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) buf.push(lines[i]);
      i++;
      blocks.push({ type: 'code', lang: fence[1], text: buf.join('\n') });
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim(), id: slugify(heading[2]) });
      i++;
      continue;
    }
    const image = IMAGE_LINE.exec(line);
    if (image) {
      blocks.push({ type: 'image', alt: image[1], src: image[2] });
      i++;
      continue;
    }
    if (line.startsWith('|') && TABLE_SEP.test(lines[i + 1] ?? '')) {
      const head = splitRow(line);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(splitRow(lines[i]));
      blocks.push({ type: 'table', head, rows });
      continue;
    }
    const first = LIST_ITEM.exec(line);
    if (first) {
      const items = [];
      while (i < lines.length) {
        const item = LIST_ITEM.exec(lines[i]);
        if (item) items.push(item[2]);
        else if (/^\s{2,}\S/.test(lines[i])) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
        i++;
      }
      blocks.push({ type: 'list', ordered: /\d/.test(first[1]), items });
      continue;
    }
    if (line.startsWith('>')) {
      const buf = [];
      for (; i < lines.length && lines[i].startsWith('>'); i++) buf.push(lines[i].replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', text: buf.join(' ') });
      continue;
    }
    const buf = [line.trim()];
    for (i++; i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i]); i++) buf.push(lines[i].trim());
    blocks.push({ type: 'paragraph', text: buf.join(' ') });
  }
  return blocks;
}

const INLINE = /(`+)([\s\S]+?)\1|\*\*(.+?)\*\*|\[((?:[^[\]]|\[[^\]]*\])*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(^|[^\w*])\*([^*\s](?:[^*]*[^*\s])?)\*(?![\w*])/g;

/**
 * @typedef {{ fromFile: string, pages: import('./catalog.js').DocPage[], pageHref: (p: any) => string, repoUrl?: string,
 *   images: Record<string, string> }} RenderContext
 */

function DocLink({ href, text, ctx, children }) {
  const r = resolveLink(ctx.fromFile, href, ctx);
  if (r.kind === 'path') {
    return text.replace(/`/g, '').includes(r.href.replace(/#.*$/, '')) ? children : (
      <>
        {children} (<code>{r.href}</code>)
      </>
    );
  }
  if (r.href.startsWith('/app/')) return <Link to={r.href}>{children}</Link>;
  const external = r.kind === 'repo' || /^https?:/i.test(r.href);
  return (
    <a href={r.href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
      {children}
    </a>
  );
}

/**
 * @param {string} text
 * @param {RenderContext} ctx
 * @returns {import('react').ReactNode[]}
 */
export function renderInline(text, ctx, key = 'i') {
  const out = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const [whole, , code, bold, linkText, href, pre, em] = m;
    let start = m.index;
    if (em !== undefined) {
      start += pre.length;
      if (start > last) out.push(text.slice(last, start));
    } else if (start > last) out.push(text.slice(last, start));
    const k = `${key}.${n++}`;
    if (code !== undefined) out.push(<code key={k}>{code.trim()}</code>);
    else if (bold !== undefined) out.push(<strong key={k}>{renderInline(bold, ctx, k)}</strong>);
    else if (href !== undefined)
      out.push(
        <DocLink key={k} href={href} text={linkText} ctx={ctx}>
          {renderInline(linkText, ctx, k)}
        </DocLink>,
      );
    else out.push(<em key={k}>{renderInline(em, ctx, k)}</em>);
    last = m.index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Image({ alt, src, ctx }) {
  const path = joinPath(ctx.fromFile, src);
  const url = /^https?:/i.test(src) ? src : ctx.images[path];
  if (!url) {
    return (
      <p className="empty">
        Screenshot not captured yet (<code>{path}</code>). <code>pnpm docs:shots</code> records it from the running app.
      </p>
    );
  }
  return (
    <figure className="doc-figure">
      <img src={url} alt={alt} loading="lazy" />
      <figcaption>{alt}</figcaption>
    </figure>
  );
}

function Block({ block, ctx, k }) {
  switch (block.type) {
    case 'heading': {
      const H = block.level <= 2 ? 'h2' : block.level === 3 ? 'h3' : 'h4';
      return <H id={block.id}>{renderInline(block.text, ctx, k)}</H>;
    }
    case 'paragraph':
      return <p>{renderInline(block.text, ctx, k)}</p>;
    case 'list': {
      const L = block.ordered ? 'ol' : 'ul';
      return (
        <L>
          {block.items.map((item, j) => (
            <li key={j}>{renderInline(item, ctx, `${k}.${j}`)}</li>
          ))}
        </L>
      );
    }
    case 'code':
      return (
        <pre className="code" data-lang={block.lang || undefined}>
          <code>{block.text}</code>
        </pre>
      );
    case 'table':
      return (
        <div className="doc-table">
          <table className="table">
            <thead>
              <tr>
                {block.head.map((h, j) => (
                  <th key={j} scope="col">
                    {renderInline(h, ctx, `${k}.h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, j) => (
                    <td key={j}>{renderInline(c, ctx, `${k}.${r}.${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'image':
      return <Image alt={block.alt} src={block.src} ctx={ctx} />;
    case 'quote':
      return <blockquote className="callout">{renderInline(block.text, ctx, k)}</blockquote>;
    default:
      return null;
  }
}

/**
 * @param {{ body: string, ctx: RenderContext }} props
 */
export function Markdown({ body, ctx }) {
  return parseBlocks(body).map((block, i) => <Block key={i} block={block} ctx={ctx} k={`b${i}`} />);
}

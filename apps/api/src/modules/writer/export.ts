import { Document, FootnoteReferenceRun, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { blocksOf, type PMNode } from './doc';

export interface CompiledBlock {
  type: 'paragraph' | 'heading' | 'citation';
  text: string;
  /** 1-based footnote number for citation blocks. */
  footnote?: number;
}
export interface CompiledSection {
  kind: 'PART' | 'CHAPTER' | 'SCENE';
  title: string;
  blocks: CompiledBlock[];
}
export interface Compiled {
  title: string;
  sections: CompiledSection[];
  footnotes: string[];
  words: number;
}

interface NodeRow {
  id: string;
  parentId: string | null;
  kind: 'PART' | 'CHAPTER' | 'SCENE';
  title: string;
  position: number;
  wordCount: number;
}

/** Orders the outline depth-first and attaches scene blocks; citation blocks become numbered footnotes. */
export function compile(title: string, nodes: NodeRow[], docs: Map<string, PMNode>): Compiled {
  const children = new Map<string | null, NodeRow[]>();
  for (const n of nodes) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  for (const list of children.values()) list.sort((a, b) => a.position - b.position);
  const sections: CompiledSection[] = [];
  const footnotes: string[] = [];
  const visit = (parent: string | null) => {
    for (const n of children.get(parent) ?? []) {
      const blocks: CompiledBlock[] = [];
      const doc = n.kind === 'SCENE' ? docs.get(n.id) : undefined;
      for (const b of doc ? blocksOf(doc) : []) {
        if (b.type === 'citation') {
          footnotes.push(b.text);
          blocks.push({ type: 'citation', text: b.text, footnote: footnotes.length });
        } else if (b.text.trim()) {
          blocks.push({ type: b.type === 'heading' ? 'heading' : 'paragraph', text: b.text });
        }
      }
      sections.push({ kind: n.kind, title: n.title, blocks });
      visit(n.id);
    }
  };
  visit(null);
  return { title, sections, footnotes, words: nodes.filter((n) => n.kind === 'SCENE').reduce((a, n) => a + n.wordCount, 0) };
}

/** Markdown: parts `##`, chapters `###`, scene breaks `* * *`, footnotes `[^n]` attached to the preceding paragraph. */
export function toMarkdown(c: Compiled): string {
  const out: string[] = [`# ${c.title}`, ''];
  let scenesInChapter = 0;
  for (const s of c.sections) {
    if (s.kind === 'PART') out.push(`## ${s.title}`, '');
    if (s.kind === 'CHAPTER') {
      out.push(`### ${s.title}`, '');
      scenesInChapter = 0;
    }
    if (s.kind !== 'SCENE') continue;
    if (scenesInChapter++ > 0) out.push('* * *', '');
    for (const b of s.blocks) {
      if (b.type === 'citation') {
        const i = out.length - 2;
        if (i >= 0 && out[i] && !out[i].startsWith('#')) out[i] = `${out[i]}[^${b.footnote}]`;
        else out.push(`[^${b.footnote}]`, '');
        continue;
      }
      out.push(b.type === 'heading' ? `#### ${b.text}` : b.text.replace(/\n/g, '  \n'), '');
    }
  }
  if (c.footnotes.length) {
    out.push('---', '');
    c.footnotes.forEach((f, i) => out.push(`[^${i + 1}]: ${f}`));
    out.push('');
  }
  return out.join('\n');
}

export async function toDocx(c: Compiled): Promise<Buffer> {
  const children: Paragraph[] = [new Paragraph({ text: c.title, heading: HeadingLevel.TITLE })];
  let scenesInChapter = 0;
  let last: TextRun[] | null = null;
  const lastIndex = () => children.length - 1;
  for (const s of c.sections) {
    if (s.kind === 'PART') children.push(new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_1 }));
    if (s.kind === 'CHAPTER') {
      children.push(new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_2 }));
      scenesInChapter = 0;
    }
    if (s.kind !== 'SCENE') continue;
    if (scenesInChapter++ > 0) children.push(new Paragraph({ text: '* * *', alignment: 'center' }));
    last = null;
    for (const b of s.blocks) {
      if (b.type === 'citation') {
        const ref = new FootnoteReferenceRun(b.footnote!);
        if (last) children[lastIndex()] = new Paragraph({ children: [...last, ref] });
        else children.push(new Paragraph({ children: [ref] }));
        continue;
      }
      if (b.type === 'heading') {
        children.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_3 }));
        last = null;
        continue;
      }
      const runs = b.text.split('\n').map((t, i) => new TextRun({ text: t, break: i > 0 ? 1 : 0 }));
      children.push(new Paragraph({ children: runs }));
      last = runs;
    }
  }
  const footnotes = Object.fromEntries(c.footnotes.map((f, i) => [i + 1, { children: [new Paragraph(f)] }]));
  const doc = new Document({ creator: 'FolioVerse', title: c.title, footnotes, sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export const fileSlug = (title: string) =>
  title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60) || 'manuscript';

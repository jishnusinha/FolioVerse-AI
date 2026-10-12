import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import { PrismaService } from '../../infra/prisma.service';

/** A candidate record from a metadata provider; the reader confirms it before a book is created. */
export interface MetadataResult {
  provider: 'OPEN_LIBRARY' | 'GOOGLE_BOOKS';
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  publishedYear: number | null;
  isbn13: string | null;
  pageCount: number | null;
  subjects: string[];
  description: string | null;
  coverUrl: string | null;
  language: string | null;
  externalIds: Record<string, string>;
}

const CACHE_TTL_MS = 30 * 86_400_000;
const TIMEOUT_MS = 5000;
const year = (v: unknown) => {
  const m = String(v ?? '').match(/\d{4}/);
  return m ? Number(m[0]) : null;
};
const isbn13 = (list: unknown) => (Array.isArray(list) ? (list.map(String).find((s) => /^97[89]\d{10}$/.test(s)) ?? null) : null);

export function fromOpenLibrary(doc: any): MetadataResult {
  return {
    provider: 'OPEN_LIBRARY',
    title: String(doc.title ?? '').slice(0, 300),
    subtitle: doc.subtitle ?? null,
    authors: (doc.author_name ?? []).slice(0, 10),
    publisher: doc.publisher?.[0] ?? null,
    publishedYear: year(doc.first_publish_year),
    isbn13: isbn13(doc.isbn),
    pageCount: Number.isInteger(doc.number_of_pages_median) ? doc.number_of_pages_median : null,
    subjects: (doc.subject ?? []).slice(0, 12),
    description: null,
    coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${encodeURIComponent(doc.cover_i)}-M.jpg` : null,
    language: doc.language?.[0] ?? null,
    externalIds: doc.key ? { openLibrary: String(doc.key) } : {},
  };
}

export function fromGoogleBooks(v: any): MetadataResult {
  const i = v.volumeInfo ?? {};
  const ids = (i.industryIdentifiers ?? []).filter((x: any) => x.type === 'ISBN_13').map((x: any) => x.identifier);
  const cover = i.imageLinks?.thumbnail as string | undefined;
  return {
    provider: 'GOOGLE_BOOKS',
    title: String(i.title ?? '').slice(0, 300),
    subtitle: i.subtitle ?? null,
    authors: (i.authors ?? []).slice(0, 10),
    publisher: i.publisher ?? null,
    publishedYear: year(i.publishedDate),
    isbn13: isbn13(ids),
    pageCount: Number.isInteger(i.pageCount) ? i.pageCount : null,
    subjects: (i.categories ?? []).slice(0, 12),
    description: i.description ? String(i.description).replace(/<[^>]+>/g, ' ').slice(0, 4000) : null,
    coverUrl: cover ? cover.replace(/^http:/, 'https:') : null,
    language: i.language ?? null,
    externalIds: v.id ? { googleBooks: String(v.id) } : {},
  };
}

/**
 * Optional enrichment from Open Library and Google Books. Both are off unless their flag is set; responses are
 * cached for 30 days. Without a provider the Library falls back to manual entry. Failures return no results.
 */
@Injectable()
export class MetadataService {
  private readonly log = new Logger('Metadata');
  fetchImpl: typeof fetch = (...a) => fetch(...a);

  constructor(private readonly prisma: PrismaService) {}

  providers() {
    const e = env();
    return [...(e.FV_METADATA_OPEN_LIBRARY ? (['OPEN_LIBRARY'] as const) : []), ...(e.FV_METADATA_GOOGLE_BOOKS ? (['GOOGLE_BOOKS'] as const) : [])];
  }

  async search(query: string) {
    const providers = this.providers();
    const q = query.trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!providers.length || q.length < 2) return { enabled: providers.length > 0, providers, results: [] as MetadataResult[] };
    const isbn = q.replace(/-/g, '');
    const term = /^(97[89])?\d{9}[\dXx]$/.test(isbn) ? `isbn:${isbn}` : q;
    const results = (await Promise.all(providers.map((p) => this.cached(p, term)))).flat();
    return { enabled: true, providers, results };
  }

  private async cached(provider: 'OPEN_LIBRARY' | 'GOOGLE_BOOKS', term: string): Promise<MetadataResult[]> {
    const key = `${provider}:${term.toLowerCase()}`;
    const hit = await this.prisma.bookMetadataCache.findUnique({ where: { key } });
    if (hit && Date.now() - hit.fetchedAt.getTime() < CACHE_TTL_MS) return hit.payload as unknown as MetadataResult[];
    const results = await this.fetchProvider(provider, term);
    if (results === null) return [];
    await this.prisma.bookMetadataCache.upsert({
      where: { key },
      create: { key, provider, payload: results as any },
      update: { payload: results as any, fetchedAt: new Date() },
    });
    return results;
  }

  private async fetchProvider(provider: 'OPEN_LIBRARY' | 'GOOGLE_BOOKS', term: string): Promise<MetadataResult[] | null> {
    const url =
      provider === 'OPEN_LIBRARY'
        ? `https://openlibrary.org/search.json?limit=5&fields=key,title,subtitle,author_name,first_publish_year,publisher,isbn,number_of_pages_median,subject,cover_i,language&q=${encodeURIComponent(term)}`
        : `https://www.googleapis.com/books/v1/volumes?maxResults=5&q=${encodeURIComponent(term)}${env().GOOGLE_BOOKS_API_KEY ? `&key=${encodeURIComponent(env().GOOGLE_BOOKS_API_KEY!)}` : ''}`;
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
      if (!res.ok) {
        this.log.warn(`${provider} answered ${res.status}`);
        return null;
      }
      const body: any = await res.json();
      const rows = provider === 'OPEN_LIBRARY' ? (body.docs ?? []).map(fromOpenLibrary) : (body.items ?? []).map(fromGoogleBooks);
      return rows.filter((r: MetadataResult) => r.title);
    } catch (e) {
      this.log.warn(`${provider} unavailable: ${(e as Error).name}`);
      return null;
    }
  }
}

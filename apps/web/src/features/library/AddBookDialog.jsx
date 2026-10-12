import { useState } from 'react';
import { Button, Callout, Dialog, Field, Input, Select, Textarea } from '@/shared/ui/index.js';
import { STATUSES, useMetadataSearch } from './queries.js';

const EMPTY = { title: '', authors: '', isbn13: '', publishedYear: '', publisher: '', description: '' };
const PROVIDER = { OPEN_LIBRARY: 'Open Library', GOOGLE_BOOKS: 'Google Books' };

/** Turns the form (or a confirmed metadata result) into a `book` payload. */
export function bookPayload(form, picked) {
  const year = Number(form.publishedYear);
  return {
    title: form.title.trim(),
    ...(form.authors.trim() ? { authors: form.authors.split(',').map((a) => a.trim()).filter(Boolean).slice(0, 10) } : {}),
    ...(form.isbn13.trim() ? { isbn13: form.isbn13.replace(/[-\s]/g, '') } : {}),
    ...(Number.isInteger(year) && year > 0 ? { publishedYear: year } : {}),
    ...(form.publisher.trim() ? { publisher: form.publisher.trim() } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(picked
      ? {
          metadataSource: picked.provider,
          externalIds: picked.externalIds,
          ...(picked.coverUrl ? { coverUrl: picked.coverUrl } : {}),
          ...(picked.subjects?.length ? { subjects: picked.subjects } : {}),
          ...(picked.pageCount ? { pageCount: picked.pageCount } : {}),
          ...(picked.language ? { language: picked.language } : {}),
        }
      : {}),
  };
}

/**
 * Manual book entry. When a metadata provider is enabled on the server, a lookup fills the form; the reader
 * still confirms every field before the book is saved.
 */
export function AddBookDialog({ open, onOpenChange, workspaceId, onSubmit }) {
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState('TO_READ');
  const [lookup, setLookup] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const meta = useMetadataSearch(workspaceId, query);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function close(next) {
    if (!next) {
      setForm(EMPTY);
      setPicked(null);
      setQuery('');
      setLookup('');
      setError('');
    }
    onOpenChange(next);
  }

  function pick(r) {
    setPicked(r);
    setForm({
      title: r.title,
      authors: r.authors.join(', '),
      isbn13: r.isbn13 ?? '',
      publishedYear: r.publishedYear ? String(r.publishedYear) : '',
      publisher: r.publisher ?? '',
      description: r.description ?? '',
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) return setError('A title is required.');
    if (form.isbn13.trim() && !/^97[89]\d{10}$/.test(form.isbn13.replace(/[-\s]/g, ''))) return setError('ISBN-13 has 13 digits and starts with 978 or 979.');
    setBusy(true);
    try {
      await onSubmit({ book: bookPayload(form, picked), status });
      close(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const disabled = meta.data && !meta.data.enabled;
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Add a book"
      description="Track a book you are reading elsewhere. Upload an EPUB or PDF instead to read it here."
      footer={
        <>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-book" disabled={busy}>
            Add to library
          </Button>
        </>
      }
    >
      <form
        className="stack"
        style={{ gap: 8, marginBottom: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(lookup.trim());
        }}
      >
        <Field label="Look up by title or ISBN" hint="Optional. Uses Open Library or Google Books when an administrator has enabled them.">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="e.g. 9780000000019" />
            <Button type="submit" disabled={lookup.trim().length < 2}>
              Look up
            </Button>
          </div>
        </Field>
        {disabled && <Callout>Metadata lookup is not configured on this server. Enter the details yourself.</Callout>}
        {meta.isFetching && <p className="subtle">Searching…</p>}
        {meta.data?.enabled && !meta.isFetching && (
          <ul className="list" aria-label="Lookup results">
            {meta.data.results.length === 0 && <li className="li subtle">No matches. Enter the details yourself.</li>}
            {meta.data.results.map((r, i) => (
              <li key={`${r.provider}-${i}`} className="li">
                <div className="grow">
                  <b>{r.title}</b>
                  <p className="subtle" style={{ fontSize: 12 }}>
                    {[r.authors.join(', '), r.publishedYear, PROVIDER[r.provider]].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Button size="sm" aria-pressed={picked === r} onClick={() => pick(r)}>
                  Use
                </Button>
              </li>
            ))}
          </ul>
        )}
      </form>
      <form id="add-book" className="stack" style={{ gap: 12 }} onSubmit={submit}>
        <Field label="Title" error={error || undefined}>
          <Input value={form.title} onChange={set('title')} maxLength={300} />
        </Field>
        <Field label="Authors" hint="Separate several authors with commas.">
          <Input value={form.authors} onChange={set('authors')} />
        </Field>
        <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
          <Field label="ISBN-13" className="grow">
            <Input value={form.isbn13} onChange={set('isbn13')} inputMode="numeric" />
          </Field>
          <Field label="Year">
            <Input value={form.publishedYear} onChange={set('publishedYear')} inputMode="numeric" style={{ width: 90 }} />
          </Field>
        </div>
        <Field label="Publisher">
          <Input value={form.publisher} onChange={set('publisher')} />
        </Field>
        <Field label="Description">
          <Textarea value={form.description} onChange={set('description')} rows={3} />
        </Field>
        <Field label="Shelf">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={STATUSES.map(([value, label]) => ({ value, label }))} />
        </Field>
        {picked && <p className="subtle">Details from {PROVIDER[picked.provider]}. Check them before saving.</p>}
      </form>
    </Dialog>
  );
}

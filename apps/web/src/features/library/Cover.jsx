import { Link } from 'react-router';

function Waves({ tone }) {
  return (
    <svg viewBox="0 0 120 60" aria-hidden="true">
      {[0, 1, 2, 3].map((k) => (
        <path key={k} d={`M0 ${20 + k * 10} Q30 ${12 + k * 10} 60 ${20 + k * 10} T120 ${20 + k * 10}`} stroke="currentColor" strokeOpacity={0.45 - k * 0.09} fill="none" />
      ))}
      <circle cx={30 + ((tone * 13) % 60)} cy="12" r="7" fill="none" stroke="currentColor" strokeOpacity=".6" />
    </svg>
  );
}

/**
 * Book cover: the provider image when there is one, otherwise a generated cover in one of the six cover tones.
 * @param {{ book: { title: string, authors?: string[], coverUrl?: string | null, coverTone?: number }, to?: string, label?: string }} props
 */
export function Cover({ book, to, label }) {
  const tone = book.coverTone || 1;
  const aria = label ?? `${book.title}${book.authors?.length ? ` by ${book.authors.join(', ')}` : ''}`;
  const body = book.coverUrl ? (
    <img src={book.coverUrl} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
  ) : (
    <>
      <small>{book.authors?.[0] ?? ''}</small>
      <b>{book.title}</b>
      <Waves tone={tone} />
    </>
  );
  const style = { background: `var(--fv-cover-${tone})` };
  return to ? (
    <Link className="cover" to={to} style={style} aria-label={aria}>
      {body}
    </Link>
  ) : (
    <div className="cover" style={style} role="img" aria-label={aria}>
      {body}
    </div>
  );
}

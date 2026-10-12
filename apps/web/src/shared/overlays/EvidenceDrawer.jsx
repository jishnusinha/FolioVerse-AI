import { Sheet } from '../ui/Dialog.jsx';
import { StatusBadge } from '../StatusBadge.jsx';

/**
 * Evidence drawer for one citation marker.
 * @param {{ open: boolean, onOpenChange: (o: boolean) => void, onOpenSource?: () => void,
 *   citation: { marker: string, state: string, anchorState?: string, title: string, versionNumber?: number,
 *     currentVersionNumber?: number, locator?: string, quote?: string | null, claim?: string } | null }} props
 */
export function EvidenceDrawer({ open, onOpenChange, citation, onOpenSource }) {
  if (!citation) return null;
  const c = citation;
  const gone = c.state === 'PERMISSION_REVOKED' || c.state === 'SOURCE_PURGED';
  const versionDiffers = c.versionNumber != null && c.currentVersionNumber != null && c.versionNumber !== c.currentVersionNumber;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      label={`Evidence ${c.marker}`}
      title={
        <>
          Evidence <span className="mono">{c.marker}</span>
        </>
      }
    >
      <div className="row">
        <StatusBadge family="cite" value={c.state} />
        {c.anchorState && <StatusBadge family="anchor" value={c.anchorState} />}
      </div>
      <dl className="kv">
        <dt>Source</dt>
        <dd>{c.title}</dd>
        {c.versionNumber != null && (
          <>
            <dt>Version</dt>
            <dd>
              v{c.versionNumber}
              {c.currentVersionNumber != null && ` (current v${c.currentVersionNumber})`}
            </dd>
          </>
        )}
        {c.locator && (
          <>
            <dt>Location</dt>
            <dd>{c.locator}</dd>
          </>
        )}
      </dl>
      {versionDiffers && (
        <p className="vernote">
          Cited from v{c.versionNumber}. The document now has v{c.currentVersionNumber}; the quote is shown as it was cited.
        </p>
      )}
      {gone ? (
        <div className="callout">
          {c.state === 'PERMISSION_REVOKED'
            ? 'You no longer have access to this source, so the quoted text is hidden.'
            : 'This source was permanently deleted. The citation remains for the record without its text.'}
        </div>
      ) : c.quote ? (
        <blockquote className="quote" style={{ margin: 0 }}>
          <mark>{c.quote}</mark>
        </blockquote>
      ) : (
        <div className="callout bad">The quoted text could not be found in the stored version.</div>
      )}
      {c.state === 'UNRESOLVED' && c.quote && (
        <div className="callout bad">This quote was not found at the cited location. Treat the claim as unsupported.</div>
      )}
      {c.state === 'WEAK' && <div className="callout warn">The quote exists but supports the claim only weakly.</div>}
      {c.claim && (
        <section>
          <p className="eyebrow">Claim</p>
          <p>{c.claim}</p>
        </section>
      )}
      {onOpenSource && !gone && (
        <div className="row">
          <button type="button" className="btn primary" onClick={onOpenSource}>
            Open at location
          </button>
        </div>
      )}
    </Sheet>
  );
}

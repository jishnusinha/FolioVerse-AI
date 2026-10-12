import { Button, Dialog } from '@/shared/ui/index.js';
import { DocDiff } from './WordDiff.jsx';

/**
 * Shown when a save hits 409 REVISION_CONFLICT: the scene was saved elsewhere (another tab or device)
 * since this editor loaded it. Nothing is lost either way: both versions stay in History.
 * @param {{ conflict: { mine: any, theirs: { revision: number, content: any, updatedAt?: string } } | null,
 *   onKeepMine: () => void, onUseTheirs: () => void, onClose: () => void }} props
 */
export function MergeDialog({ conflict, onKeepMine, onUseTheirs, onClose }) {
  return (
    <Dialog
      open={Boolean(conflict)}
      onOpenChange={(o) => !o && onClose()}
      title="This scene changed somewhere else"
      description={conflict ? `Revision r${conflict.theirs.revision} was saved after you started editing. Compare and choose which version continues; the other stays in History.` : undefined}
      className="wide"
      footer={
        <>
          <Button onClick={onUseTheirs}>Use saved version (r{conflict?.theirs.revision})</Button>
          <Button variant="primary" onClick={onKeepMine}>
            Keep my version
          </Button>
        </>
      }
    >
      {conflict && (
        <>
          <p className="eyebrow">Saved version → your version</p>
          <DocDiff before={conflict.theirs.content} after={conflict.mine} empty="The text is the same; only formatting differs." />
        </>
      )}
    </Dialog>
  );
}

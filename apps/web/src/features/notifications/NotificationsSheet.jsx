import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet } from '@/shared/ui/Dialog.jsx';
import { Button, Skeleton, toast } from '@/shared/ui/index.js';
import { costApi, costKeys, useNotifications } from '@/features/costs/queries.js';

const when = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Number of unread notifications for the bell badge; the list is refreshed by workspace events. */
export function useUnreadCount(wid) {
  const q = useNotifications(wid);
  return (q.data ?? []).filter((n) => !n.readAt).length;
}

/** Notifications for the signed-in user in the current workspace (budget alerts, anomalies, ingestion results). */
export function NotificationsSheet({ wid, open, onOpenChange }) {
  const qc = useQueryClient();
  const q = useNotifications(wid, open);
  const items = q.data ?? [];
  const unread = items.filter((n) => !n.readAt).length;
  const readAll = async () => {
    try {
      await costApi.readAllNotifications(wid);
      qc.invalidateQueries({ queryKey: costKeys.notifications(wid) });
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Notifications">
      {q.isPending ? (
        <Skeleton height={80} />
      ) : !items.length ? (
        <p className="empty">No notifications yet. Ingestion results, budget alerts and proposed story facts will appear here.</p>
      ) : (
        <>
          <div className="row between" style={{ marginBottom: 8 }}>
            <span className="subtle">{unread ? `${unread} unread` : 'All read'}</span>
            <Button size="sm" variant="ghost" onClick={readAll} disabled={!unread}>
              Mark all read
            </Button>
          </div>
          <ul className="list" aria-label="Notifications">
            {items.map((n) => (
              <li key={n.id} className="li" style={{ display: 'block' }} data-unread={n.readAt ? undefined : 'true'}>
                <div className="row between">
                  <b style={{ fontWeight: n.readAt ? 500 : 650 }}>
                    {!n.readAt && <span className="sr">Unread: </span>}
                    {n.link ? (
                      <Link to={n.link} onClick={() => onOpenChange(false)}>
                        {n.title}
                      </Link>
                    ) : (
                      n.title
                    )}
                  </b>
                  <span className="subtle" style={{ fontSize: 11.5 }}>
                    {when(n.createdAt)}
                  </span>
                </div>
                {n.body && (
                  <p className="subtle" style={{ fontSize: 12.5, marginTop: 2 }}>
                    {n.body}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}

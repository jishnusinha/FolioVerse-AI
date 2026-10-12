import { useState } from 'react';
import * as DM from '@radix-ui/react-dropdown-menu';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { Button, Callout, Dialog, Field, Input } from '@/shared/ui/index.js';
import { Icon } from '@/shared/icons.jsx';
import { ME_KEY, useCurrentWorkspace, useMe, useWorkspaceStore } from '@/features/auth/session.js';

const ROLE_LABEL = { OWNER: 'Owner', ADMIN: 'Admin', EDITOR: 'Editor', VIEWER: 'Viewer' };

function CreateWorkspaceDialog({ open, onOpenChange }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api('/workspaces', { method: 'POST', body: { name: name.trim() } }),
    onSuccess: async (ws) => {
      useWorkspaceStore.getState().setWorkspaceId(ws.id);
      await qc.invalidateQueries({ queryKey: ME_KEY });
      setName('');
      onOpenChange(false);
      navigate('/app/knowledge');
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create a team workspace"
      description="Team workspaces have their own members, projects and budget. Your personal library stays private."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" type="submit" form="create-ws" disabled={!name.trim() || create.isPending}>
            Create workspace
          </Button>
        </>
      }
    >
      <form
        id="create-ws"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <Field label="Workspace name">
          <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {create.error && (
          <div style={{ marginTop: 12 }}>
            <Callout tone="bad" role="alert">
              {create.error.message}
            </Callout>
          </div>
        )}
      </form>
    </Dialog>
  );
}

/** Lists the user's workspaces; switching re-scopes every workspace query. */
export function WorkspaceSwitcher() {
  const me = useMe();
  const current = useCurrentWorkspace();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const list = me.data?.workspaces ?? [];

  return (
    <>
      <DM.Root>
        <DM.Trigger asChild>
          <button type="button" className="tnode" aria-label={`Workspace: ${current?.name ?? 'none'}. Switch workspace`}>
            <Icon name="folder" size={15} />
            <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {current?.name ?? 'No workspace'}
            </span>
            <Icon name="chev" size={13} />
          </button>
        </DM.Trigger>
        <DM.Portal>
          <DM.Content className="menu" align="start" sideOffset={6}>
            <DM.Label className="eyebrow" style={{ padding: '6px 10px' }}>
              Workspaces
            </DM.Label>
            <DM.RadioGroup
              value={current?.id}
              onValueChange={(id) => {
                useWorkspaceStore.getState().setWorkspaceId(id);
                navigate('/app/knowledge');
              }}
            >
              {list.map((w) => (
                <DM.RadioItem key={w.id} value={w.id} className="menu-item">
                  <span className="grow">{w.name}</span>
                  <span className="subtle" style={{ fontSize: 11 }}>
                    {w.kind === 'PERSONAL' ? 'Personal' : ROLE_LABEL[w.role]}
                  </span>
                  <DM.ItemIndicator aria-hidden="true">✓</DM.ItemIndicator>
                </DM.RadioItem>
              ))}
            </DM.RadioGroup>
            <DM.Separator className="menu-sep" />
            <DM.Item className="menu-item" onSelect={() => setCreating(true)}>
              Create team workspace…
            </DM.Item>
          </DM.Content>
        </DM.Portal>
      </DM.Root>
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

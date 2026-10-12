import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Callout, Dialog, Field, Input, Select, Textarea } from '@/shared/ui/index.js';

function FormDialog({ open, onOpenChange, title, description, submitLabel, onSubmit, children, canSubmit = true }) {
  const m = useMutation({ mutationFn: onSubmit, onSuccess: () => onOpenChange(false) });
  const formId = `form-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) m.reset();
        onOpenChange(o);
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!canSubmit || m.isPending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="stack"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) m.mutate();
        }}
      >
        {children}
        {m.error && (
          <Callout tone="bad" role="alert">
            {m.error.message}
          </Callout>
        )}
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, confirmLabel, onConfirm, children }) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={title} submitLabel={confirmLabel} onSubmit={onConfirm}>
      <p>{children}</p>
    </FormDialog>
  );
}

/** Single text field dialog (new folder, rename). Remount with a `key` to reset the initial value. */
export function NameDialog({ open, onOpenChange, title, label, initial = '', submitLabel = 'Save', onSubmit, children }) {
  const [name, setName] = useState(initial);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      submitLabel={submitLabel}
      canSubmit={Boolean(name.trim())}
      onSubmit={() => onSubmit(name.trim())}
    >
      <Field label={label}>
        <Input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      {children}
    </FormDialog>
  );
}

export function NewFolderDialog({ open, onOpenChange, folders, defaultParentId = '', onSubmit }) {
  const [parentId, setParentId] = useState(defaultParentId ?? '');
  return (
    <NameDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New folder"
      label="Folder name"
      submitLabel="Create folder"
      onSubmit={(name) => onSubmit({ name, parentId: parentId || undefined })}
    >
      {folders.length > 0 && (
        <Field label="Inside">
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Project root</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </NameDialog>
  );
}

export function MoveDialog({ open, onOpenChange, folders, count, onSubmit }) {
  const [folderId, setFolderId] = useState('');
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Move ${count} document${count === 1 ? '' : 's'}`}
      submitLabel="Move"
      onSubmit={() => onSubmit(folderId || null)}
    >
      <Field label="Destination">
        <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
          <option value="">Project root</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
      </Field>
    </FormDialog>
  );
}

export function NewProjectDialog({ open, onOpenChange, onSubmit }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New research project"
      submitLabel="Create project"
      canSubmit={Boolean(name.trim())}
      onSubmit={() => onSubmit({ name: name.trim(), description: description.trim() || undefined })}
    >
      <Field label="Project name">
        <Input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Description" hint="Optional. Helps collaborators understand the scope.">
        <Textarea rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

import { useId } from 'react';
import { DemoBadge } from '../StatusBadge.jsx';

/**
 * Model selector backed by the model registry (`GET /api/models`). `auto` lets the task profile choose.
 * Model ids are never hard-coded in the client; options come from the registry.
 * @param {{ options: { id: string, label: string, provider: string, isDemo?: boolean, priced?: boolean, capabilities?: string[] }[],
 *   value: string, onChange: (id: string) => void, label?: string, disabled?: boolean }} props
 */
export function ModelSelector({ options, value, onChange, label = 'Model', disabled }) {
  const id = useId();
  const selected = options.find((o) => o.id === value);
  return (
    <div className="fld" style={{ minWidth: 220 }}>
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="auto">Auto (task profile decides)</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.provider} · {o.label}
            {o.isDemo ? ' (DEMO)' : ''}
          </option>
        ))}
      </select>
      {selected && (
        <span className="row subtle" style={{ gap: 6 }}>
          {selected.isDemo && <DemoBadge />}
          {selected.priced === false && <span>No price entered — costs will be marked estimated.</span>}
        </span>
      )}
      {options.length === 0 && <span className="subtle">No models configured. An admin can add them in the registry.</span>}
    </div>
  );
}

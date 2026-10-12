import { cn } from '../cn.js';

/**
 * Data table with the prototype styling.
 * @param {{ columns: { key: string, label: import('react').ReactNode, numeric?: boolean, render?: (row: any) => import('react').ReactNode }[],
 *   rows: any[], rowKey?: (row: any) => string, selectedKey?: string, onRowClick?: (row: any) => void, caption?: string, empty?: import('react').ReactNode }} props
 */
export function Table({ columns, rows, rowKey = (r) => r.id, selectedKey, onRowClick, caption, empty }) {
  return (
    <table className="table">
      {caption && <caption className="sr">{caption}</caption>}
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" className={c.numeric ? 'num' : undefined}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && empty ? (
          <tr>
            <td colSpan={columns.length}>{empty}</td>
          </tr>
        ) : (
          rows.map((r) => {
            const k = rowKey(r);
            return (
              <tr
                key={k}
                className={cn(k === selectedKey && 'sel')}
                data-act={onRowClick ? 'row' : undefined}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                aria-selected={onRowClick ? k === selectedKey : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? 'num' : undefined}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

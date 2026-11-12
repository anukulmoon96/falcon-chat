import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { fmtCell, prettyColumn } from '../lib/format.js';

export default function DataTable({ table, limit = 200 }) {
  const [sort, setSort] = useState(null);
  const rows = useMemo(() => {
    if (!sort) return table.rows;
    const numeric = table.columns.find((c) => c.name === sort.column)?.kind === 'number';
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...table.rows].sort((a, b) => {
      const x = a[sort.column];
      const y = b[sort.column];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (numeric ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [table, sort]);

  const toggle = (column) => setSort((s) => {
    if (s?.column !== column) return { column, dir: 'desc' };
    return s.dir === 'desc' ? { column, dir: 'asc' } : null;
  });
  const total = table.rowCount ?? table.rows.length;
  const shown = Math.min(limit, rows.length);

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c.name} className={c.kind === 'number' ? 'num' : undefined} aria-sort={sort?.column === c.name ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => toggle(c.name)}>
                  {prettyColumn(c.name)}
                  {/* Unsorted columns show a hint on hover and focus, so sorting can be found */}
                  {sort?.column !== c.name ? <ArrowUpDown className="sort-hint" aria-hidden="true" />
                    : sort.dir === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((r, i) => (
            <tr key={i}>
              {table.columns.map((c) => <td key={c.name} className={c.kind === 'number' ? 'num' : undefined}>{fmtCell(r[c.name])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {(total > shown || table.truncated) && <p className="table-note">Showing {shown} of {total}{table.truncated ? '+' : ''} rows. Download the CSV for all of them.</p>}
    </div>
  );
}

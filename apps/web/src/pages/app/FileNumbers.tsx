import { FormEvent, useEffect, useMemo, useState } from 'react';
import { del, get, patch, post } from '../../api';
import { Shell } from '../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons, Field } from '../../components/ui';
import { MONTHS } from '../../dept';

type FileNumberRow = {
  _id: string;
  month: string;
  year: number;
  fileNumber: string;
};

const PAGE_SIZE = 10;

function yearOptions(rows: FileNumberRow[]) {
  const now = new Date().getFullYear();
  const have = new Set<number>();
  for (let y = now - 5; y <= now + 5; y++) have.add(y);
  for (const r of rows) {
    const y = Number(r.year);
    if (Number.isFinite(y)) have.add(y);
  }
  return [...have].sort((a, b) => b - a);
}

export function FileNumbersPage() {
  const [rows, setRows] = useState<FileNumberRow[]>([]);
  const [month, setMonth] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [fileNumber, setFileNumber] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FileNumberRow | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setRows(await get('/file-numbers'));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const years = useMemo(() => yearOptions(rows), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.month, String(r.year), r.fileNumber].some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const from = filtered.length ? start + 1 : 0;
  const to = Math.min(start + PAGE_SIZE, filtered.length);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await post('/file-numbers', { month, year: Number(year), fileNumber });
      setMonth('');
      setFileNumber('');
      await load();
      setPage(1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(row: FileNumberRow) {
    if (!editing) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await patch<{ updatedFiles: number }>(`/file-numbers/${row._id}`, { fileNumber: editing.value });
      setEditing(null);
      await load();
      setNotice(
        `File number for ${row.month} ${row.year} updated.` +
          (res.updatedFiles ? ` ${res.updatedFiles} thesis file${res.updatedFiles === 1 ? '' : 's'} moved to the new number.` : ''),
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setError(null);
    try {
      await del(`/file-numbers/${pendingDelete._id}`);
      setPendingDelete(null);
      await load();
    } catch (err: any) {
      setError(err.message);
      setPendingDelete(null);
    }
  }

  const exportCols = [
    { key: 'sr', label: 'Sr.No' },
    { key: 'month', label: 'Month Name' },
    { key: 'year', label: 'Year Name' },
    { key: 'fileNumber', label: 'File Number' },
  ];
  const exportRows = filtered.map((r, i) => ({
    sr: i + 1,
    month: r.month,
    year: r.year,
    fileNumber: r.fileNumber,
  }));

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Generate File Number</h1>
          <p>Register one exam file-number prefix per session month and year. This prefix will be used when numbering theses.</p>
        </div>
      </div>
      <form className="card file-number-form" onSubmit={add}>
        <ErrorBox error={error} />
        <Field label="Session Month" required>
          <select className="input" value={month} onChange={(e) => setMonth(e.target.value)} required>
            <option value="">-- Select Month --</option>
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Session Year" required>
          <select className="input" value={year} onChange={(e) => setYear(e.target.value)} required>
            <option value="">-- Select Year --</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
        <Field label="File Number" required>
          <div className="file-number-input-row">
            <input
              className="input"
              value={fileNumber}
              onChange={(e) => setFileNumber(e.target.value)}
              placeholder="e.g. No.F.11-13/April-2026/Exam.Sec."
              required
            />
            <button className="btn" type="submit" disabled={busy}>
              Add
            </button>
          </div>
        </Field>
      </form>
      <div className="card" style={{ marginTop: 14 }}>
        {notice ? <p style={{ color: 'var(--success, #15803d)', margin: '0 0 10px' }}>{notice}</p> : null}
        <div className="file-number-toolbar">
          <ExportButtons columns={exportCols} rows={exportRows} filename="file-numbers" title="Generate File Number" />
          <label className="field table-filter" style={{ margin: 0 }}>
            <span>Search</span>
            <input
              className="input"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Month, year or file number"
            />
          </label>
        </div>
        {pageRows.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Sr.No</th>
                  <th>Month Name</th>
                  <th>Year Name</th>
                  <th>File Number</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={r._id}>
                    <td>{start + i + 1}</td>
                    <td>{r.month}</td>
                    <td>{r.year}</td>
                    <td>
                      {editing?.id === r._id ? (
                        <input
                          className="input"
                          value={editing.value}
                          autoFocus
                          aria-label={`New file number for ${r.month} ${r.year}`}
                          onChange={(e) => setEditing({ id: r._id, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(r);
                            if (e.key === 'Escape') setEditing(null);
                          }}
                        />
                      ) : (
                        r.fileNumber
                      )}
                    </td>
                    <td>
                      {editing?.id === r._id ? (
                        <div className="row">
                          <button type="button" className="btn small" disabled={busy || !editing.value.trim()} onClick={() => saveEdit(r)}>
                            Save
                          </button>
                          <button type="button" className="btn small ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="row">
                          <button
                            type="button"
                            className="btn small secondary"
                            onClick={() => {
                              setNotice(null);
                              setEditing({ id: r._id, value: r.fileNumber });
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="icon-delete"
                            title="Delete"
                            aria-label={`Delete ${r.fileNumber}`}
                            onClick={() => setPendingDelete(r)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 24, margin: 0 }}>
            {search ? 'No matching file numbers.' : 'No file numbers yet. Add the first prefix above.'}
          </p>
        )}
        <div className="pager">
          <span className="pager-meta">
            Showing {from} to {to} of {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
          </span>
          <button type="button" className="btn small secondary" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
            Previous
          </button>
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" className={`btn small ${n === safePage ? '' : 'secondary'}`} onClick={() => setPage(n)}>
              {n}
            </button>
          ))}
          <button
            type="button"
            className="btn small secondary"
            disabled={safePage >= pageCount}
            onClick={() => setPage(safePage + 1)}
          >
            Next
          </button>
        </div>
      </div>
      {pendingDelete ? (
        <ConfirmDialog
          title="Delete file number?"
          message={`Remove the prefix for ${pendingDelete.month} ${pendingDelete.year} (${pendingDelete.fileNumber})? This cannot be undone.`}
          yesLabel="Delete"
          noLabel="Cancel"
          onYes={confirmDelete}
          onNo={() => setPendingDelete(null)}
        />
      ) : null}
    </Shell>
  );
}

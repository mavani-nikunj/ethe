import { useMemo, useState } from 'react';
import { Shell } from '../../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons, Field, ResultDialog } from '../../../components/ui';
import { patch, post } from '../../../api';
import { QuickAddDialog } from '../eligible/common';
import { addLookup, notifySupervisorSession, useSupervisorMeta } from './common';

/** Old "Select Session" page: Session Month (+) · Session Year (+) · File Number → Add / Reset; Active switch per row. */
export function SupervisorSessionPage() {
  const { meta, error: metaError, reload } = useSupervisorMeta();
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [fileNumber, setFileNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; run: () => Promise<void> } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState<'MONTH' | 'YEAR' | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const canEdit = !!meta?.can.edit;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (meta?.sessions || []).filter((s) => !q || `${s.month} ${s.year} ${s.fileNumber}`.toLowerCase().includes(q));
  }, [meta, search]);

  function add() {
    setError(null);
    if (!month) return setError('Please Select Month.');
    if (!year) return setError('Please Select Year');
    if (!fileNumber.trim()) return setError('Please Insert File Number');
    setConfirm({
      message: 'You want to Create Session.',
      run: async () => {
        await post('/supervisor/sessions', { month, year: Number(year), fileNumber: fileNumber.trim() });
        setMonth('');
        setYear('');
        setFileNumber('');
        setDone('Session Successfully Set!');
      },
    });
  }

  function activate(id: string, label: string) {
    setConfirm({
      message: `Make ${label} the active supervisor session? Other sessions will be switched off.`,
      run: async () => {
        await post(`/supervisor/sessions/${id}/activate`);
        setDone('Session Successfully Activate!');
      },
    });
  }

  async function saveFileNumber() {
    if (!editing) return;
    setError(null);
    if (!editing.value.trim()) return setError('Please Insert File Number');
    try {
      await patch(`/supervisor/sessions/${editing.id}`, { fileNumber: editing.value.trim() });
      setEditing(null);
      await reload();
      notifySupervisorSession();
      setDone('File Number Successfully Updated!');
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function run() {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    try {
      await c.run();
      await reload();
      notifySupervisorSession();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const exportCols = [
    { key: 'sr', label: 'Sr.No.' },
    { key: 'month', label: 'Exam Month' },
    { key: 'year', label: 'Exam Year' },
    { key: 'fileNumber', label: 'File Number' },
    { key: 'active', label: 'IsActive' },
  ];
  const exportRows = rows.map((s, i) => ({ sr: i + 1, month: s.month, year: s.year, fileNumber: s.fileNumber, active: s.active ? 'Active' : 'Deactive' }));

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Select Session</h1>
          <p>Supervisor Session</p>
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      {meta && canEdit ? (
        <div className="card practical-filters">
          <div className="grid cols-2">
            <Field
              label="Session Month"
              required
              extra={
                <button type="button" className="btn small secondary" title="Add Month" onClick={() => setQuickAdd('MONTH')}>
                  +
                </button>
              }
            >
              <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="">-- Select Month --</option>
                {meta.months.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Session Year"
              required
              extra={
                <button type="button" className="btn small secondary" title="Add Year" onClick={() => setQuickAdd('YEAR')}>
                  +
                </button>
              }
            >
              <select className="input" value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">-- Select Year --</option>
                {meta.years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </Field>
            <Field label="File Number" required>
              <input className="input" value={fileNumber} maxLength={120} placeholder="Enter File No." onChange={(e) => setFileNumber(e.target.value)} />
            </Field>
            <div className="practical-filter-actions">
              <button type="button" className="btn" onClick={add}>
                Add
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setMonth('');
                  setYear('');
                  setFileNumber('');
                  setError(null);
                }}
              >
                Reset
              </button>
            </div>
          </div>
          <p className="practical-muted">Adding a month and year that already exists makes it active again with the new file number.</p>
        </div>
      ) : null}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="file-number-toolbar">
          <ExportButtons columns={exportCols} rows={exportRows} filename="supervisor-sessions" title="Supervisor Session" />
          <label className="field table-filter" style={{ margin: 0 }}>
            <span>Search</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        {rows.length ? (
          <div className="table-scroll">
            <table className="table practical-table">
              <thead>
                <tr>
                  <th>Sr.No.</th>
                  <th>Exam Month</th>
                  <th>Exam Year</th>
                  <th>File Number</th>
                  <th>IsActive</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => (
                  <tr key={s._id}>
                    <td>{i + 1}</td>
                    <td>{s.month}</td>
                    <td>{s.year}</td>
                    <td>
                      {editing?.id === s._id ? (
                        <div className="row">
                          <input
                            className="input"
                            value={editing.value}
                            maxLength={120}
                            autoFocus
                            aria-label={`File number for ${s.month} ${s.year}`}
                            onChange={(e) => setEditing({ id: s._id, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveFileNumber();
                              if (e.key === 'Escape') setEditing(null);
                            }}
                          />
                          <button type="button" className="btn small" onClick={saveFileNumber}>
                            Save
                          </button>
                          <button type="button" className="btn small ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          {s.fileNumber}
                          {canEdit ? (
                            <button
                              type="button"
                              className="btn ghost small"
                              style={{ marginLeft: 6 }}
                              onClick={() => setEditing({ id: s._id, value: s.fileNumber })}
                            >
                              Edit
                            </button>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td>
                      {s.active ? (
                        <span className="pill ok">Active</span>
                      ) : canEdit ? (
                        <button type="button" className="btn small danger" onClick={() => activate(s._id, `${s.month} ${s.year}`)}>
                          Deactive
                        </button>
                      ) : (
                        <span className="pill bad">Deactive</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">{meta ? 'No supervisor session yet.' : 'Loading…'}</p>
        )}
      </div>
      {confirm ? <ConfirmDialog title="Are you sure?" message={confirm.message} onYes={run} onNo={() => setConfirm(null)} /> : null}
      {done ? <ResultDialog ok message={done} onClose={() => setDone(null)} /> : null}
      {quickAdd ? (
        <QuickAddDialog
          title={quickAdd === 'MONTH' ? 'Add Month' : 'Add Year'}
          label={quickAdd === 'MONTH' ? 'Month' : 'Year'}
          maxLength={quickAdd === 'MONTH' ? 60 : 4}
          onClose={() => setQuickAdd(null)}
          onSave={async (name) => {
            await addLookup(quickAdd, name);
            await reload();
            if (quickAdd === 'MONTH') setMonth(name);
            else setYear(name);
            setQuickAdd(null);
          }}
        />
      ) : null}
    </Shell>
  );
}

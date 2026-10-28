import { useEffect, useMemo, useState } from 'react';
import { Shell } from '../../../components/Shell';
import { ErrorBox, ExportButtons, Field } from '../../../components/ui';
import { get, post } from '../../../api';
import { LetterPrint, SessionFilterBar, useSessionChoice, useSupervisorMeta, type Appointment } from './common';

/** Old Letter Type options and the list each one reads (always filtered by session, old bug 12 fixed). */
const TYPES: Record<string, { label: string; view: string; button: string; title: string }> = {
  offer: { label: 'Offer Letter approved by ACE', view: 'approved,offer-pending,accepted,regretted', button: 'Download Approved Letter', title: 'Offer letter' },
  acceptance: { label: 'Acceptance', view: 'accepted', button: 'Download Acceptance Letter', title: 'Acceptance letter' },
  regret: { label: 'Regret', view: 'regretted', button: 'Download Regret Letter', title: 'Regret letter' },
};

/** Old "Download Letter/Acceptance": pick a letter type, tick supervisors, print one letter per page. */
export function SupervisorLettersPage() {
  const { meta, error: metaError } = useSupervisorMeta();
  const [sessionId, setSessionId] = useSessionChoice(meta);
  const [type, setType] = useState('');
  const [rows, setRows] = useState<Appointment[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [letters, setLetters] = useState<{ _id: string; name: string; body: string }[] | null>(null);
  const [search, setSearch] = useState('');

  async function load() {
    setRows([]);
    setSelected(new Set());
    if (!sessionId || !type) return;
    setError(null);
    try {
      const lists = await Promise.all(
        TYPES[type].view.split(',').map((v) => get<Appointment[]>(`/supervisor/appointments?sessionId=${sessionId}&view=${v}`)),
      );
      setRows(lists.flat().sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, [sessionId, type]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => !q || [r.name, r.email, r.mobile].join(' ').toLowerCase().includes(q));
  }, [rows, search]);
  const allChecked = shown.length > 0 && shown.every((r) => selected.has(r._id));

  async function download() {
    if (!selected.size) return setError('Please select atleast 1 data.');
    setError(null);
    try {
      setLetters(await post('/supervisor/letters', { kind: type, ids: [...selected] }));
    } catch (err: any) {
      setError(err.message);
    }
  }

  const cols = [
    { key: 'name', label: 'Name' },
    { key: 'designation', label: 'Designation' },
    { key: 'department', label: 'Department' },
    { key: 'instituteName', label: 'Institute' },
    { key: 'address', label: 'Address' },
    { key: 'mobile', label: 'MobileNo' },
    { key: 'email', label: 'EmailId' },
  ] as const;
  const exportCols = [{ key: 'sr', label: 'Sr.No.' }, ...cols];
  const exportRows = shown.map((r, i) => ({ sr: i + 1, ...Object.fromEntries(cols.map((c) => [c.key, r[c.key]])) }));

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Download Letter/Acceptance</h1>
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      {meta ? (
        <SessionFilterBar meta={meta} sessionId={sessionId} onChange={setSessionId} onSearch={load}>
          <Field label="Letter Type" required>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">-- Select --</option>
              {Object.entries(TYPES).map(([k, t]) => (
                <option key={k} value={k}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </SessionFilterBar>
      ) : null}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Supervisor <span className="practical-count">{shown.length}</span>
          </h3>
          {type ? (
            <button type="button" className="btn small" onClick={download}>
              {TYPES[type].button}
            </button>
          ) : null}
        </div>
        <div className="file-number-toolbar">
          <ExportButtons columns={exportCols} rows={exportRows} filename="supervisor-letters" title="Download Letter/Acceptance" />
          <label className="field table-filter" style={{ margin: 0 }}>
            <span>Search</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        {shown.length ? (
          <div className="table-scroll">
            <table className="table practical-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allChecked}
                      onChange={() => setSelected(allChecked ? new Set() : new Set(shown.map((r) => r._id)))}
                    />
                  </th>
                  <th>Sr.No.</th>
                  {cols.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r._id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.name}`}
                        checked={selected.has(r._id)}
                        onChange={() =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (n.has(r._id)) n.delete(r._id);
                            else n.add(r._id);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td>{i + 1}</td>
                    {cols.map((c) => (
                      <td key={c.key}>{r[c.key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">{type ? 'No supervisor has this letter in the session.' : 'Select the Letter Type.'}</p>
        )}
      </div>
      {letters ? <LetterPrint title={TYPES[type]?.title || 'Letters'} letters={letters} onClose={() => setLetters(null)} /> : null}
    </Shell>
  );
}

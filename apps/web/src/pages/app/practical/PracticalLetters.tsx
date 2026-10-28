import { useEffect, useState } from 'react';
import { LETTERHEAD_LOGO_SRC, withLetterheadLogo } from '@ethesis/shared';
import { get, post } from '../../../api';
import { Shell } from '../../../components/Shell';
import { ErrorBox, Field } from '../../../components/ui';
import { FilterBar, PracticalRow, QueueFilters, filterQuery, usePracticalMeta } from './common';

/** Old "Download Assigned/ Approved/Accepted Letter" report types. */
const REPORTS = [
  { key: 'assigned', label: 'Assigned (offer letter draft)', view: 'assigned', kind: 'offer' },
  { key: 'approved', label: 'Approved by Assoc. Dean (signed offer letter)', view: 'approved', kind: 'offer' },
  { key: 'acceptance', label: 'Acceptance letter', view: 'accepted-all', kind: 'accepted' },
  { key: 'regret', label: 'Regret letter', view: 'regret', kind: 'regretted' },
  { key: 'appointment', label: 'Appointment letter', view: 'portal', kind: 'appointment' },
  { key: 'practical', label: 'Practical date letter (Chairperson)', view: 'chairperson', kind: 'date-request' },
  { key: 'reminder', label: 'Practical date reminder', view: 'chairperson', kind: 'date-reminder' },
  { key: 'fixed', label: 'Practical date fixed', view: 'chairperson', kind: 'date-fixed' },
];

function printLetters(title: string, letters: { name: string; subject: string; body: string }[]) {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Allow pop-ups to print the letters');
  const logo = `${window.location.origin}${LETTERHEAD_LOGO_SRC}`;
  const pages = letters
    .map(
      (l, i) =>
        `<section style="${i ? 'page-break-before:always;' : ''}padding:24px 32px"><h3 style="font-size:15px">${l.subject}</h3>${withLetterheadLogo(l.body, logo)}</section>`,
    )
    .join('');
  win.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111}table{border-collapse:collapse}@media print{section{padding:0}}</style></head><body>${pages}</body></html>`,
  );
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

export function PracticalLettersPage() {
  const { meta, error: metaError } = usePracticalMeta();
  const [filters, setFilters] = useState<QueueFilters>({ sessionId: '', dealingId: '', courseId: '', specialityId: '' });
  const [report, setReport] = useState('');
  const [rows, setRows] = useState<PracticalRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const def = REPORTS.find((r) => r.key === report);

  useEffect(() => {
    if (meta && !filters.sessionId) setFilters((f) => ({ ...f, sessionId: meta.currentSessionId || meta.sessions[0]?._id || '' }));
  }, [meta]);

  async function search() {
    setError(null);
    if (!def) return setError('Select the Report Type');
    try {
      const data = await get<PracticalRow[]>(`/practical/examiners?${filterQuery(filters, { view: def.view })}`);
      setRows(data);
      setSelected(new Set(data.map((r) => r._id)));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function download() {
    if (!def || !selected.size) return setError('Select at least one examiner');
    setBusy(true);
    setError(null);
    try {
      const letters = await post<{ name: string; subject: string; body: string }[]>('/practical/letters/bulk', {
        kind: def.kind,
        ids: [...selected],
      });
      printLetters(def.label, letters);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const all = rows.length > 0 && rows.every((r) => selected.has(r._id));
  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Download Assigned/ Approved/Accepted Letter</h1>
          <p>Pick a report type, search, tick the examiners and print or save all their letters as one PDF.</p>
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      {meta ? (
        <>
          <FilterBar meta={meta} value={filters} onChange={setFilters} onSearch={search} />
          <div className="card" style={{ marginTop: 10 }}>
            <Field label="Report Type" required>
              <select className="input" value={report} onChange={(e) => setReport(e.target.value)}>
                <option value="">Select Type</option>
                {REPORTS.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </>
      ) : null}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Examiner <span className="practical-count">{rows.length}</span>
          </h3>
          <button type="button" className="btn small" disabled={busy || !selected.size} onClick={download}>
            {busy ? 'Preparing…' : `Download / Print ${selected.size || ''} letter${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
        {rows.length ? (
          <div className="table-scroll">
            <table className="table practical-nopin">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" checked={all} onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r._id)))} />
                  </th>
                  <th>Sr.No.</th>
                  <th>Course</th>
                  <th>Speciality</th>
                  <th>ExaminerType</th>
                  <th>ExaminerName</th>
                  <th>Designation</th>
                  <th>Department</th>
                  <th>Institute</th>
                  <th>MobileNo</th>
                  <th>EmailId</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r._id}>
                    <td>
                      <input
                        type="checkbox"
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
                    <td>{r.courseName}</td>
                    <td>{r.specialityName}</td>
                    <td>{r.typeLabel}</td>
                    <td>{r.name}</td>
                    <td>{r.designation}</td>
                    <td>{r.department}</td>
                    <td>{r.instituteName}</td>
                    <td>{r.mobile}</td>
                    <td>{r.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">Choose a report type and press Search.</p>
        )}
      </div>
    </Shell>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Shell } from '../../../components/Shell';
import { ErrorBox, ExportButtons } from '../../../components/ui';
import { get } from '../../../api';
import { StaffSessionBar, useStaffDutyMeta, useStaffSession, type Member } from './common';

/** Old "Duty Assigned" — Manage Assigned Staff Duty: session staff that have a role (docs/staff-duty-plan.md §5.2). */
export function DutyAssignedPage() {
  const { meta, error: metaError, reload } = useStaffDutyMeta();
  const [sessionId, setSessionId] = useStaffSession(meta);
  const [rows, setRows] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');

  async function load() {
    if (!sessionId) return;
    setError(null);
    try {
      setRows(await get<Member[]>(`/staff-duty/members?sessionId=${sessionId}&withRole=1`));
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, [sessionId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.role || ''] = (c[r.role || ''] || 0) + 1;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => (!role || r.role === role) && (!q || [r.code, r.name, r.designation, r.department].join(' ').toLowerCase().includes(q)));
  }, [rows, role, search]);

  const bank = !!meta?.can.seeBank;
  const exportCols = [
    { key: 'sr', label: 'Sr.No.' },
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    { key: 'designation', label: 'Designation' },
    { key: 'department', label: 'Department' },
    { key: 'salaryCode', label: 'SalaryCode' },
    ...(bank
      ? [
          { key: 'bankName', label: 'BankName' },
          { key: 'ifsc', label: 'IFSCCode' },
          { key: 'account', label: 'AccountNo' },
          { key: 'accountType', label: 'AccountType' },
        ]
      : []),
    { key: 'roleLabel', label: 'Role' },
  ];

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Manage Assigned Staff Duty</h1>
          <p>Staff who have a duty role in the session. Roles are set on Add Staff.</p>
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      {meta ? (
        <StaffSessionBar
          meta={meta}
          sessionId={sessionId}
          onChange={setSessionId}
          onSearch={load}
          onCreated={async (id) => {
            await reload();
            setSessionId(id);
          }}
        />
      ) : null}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Staff <span className="practical-count">{shown.length}</span>
          </h3>
        </div>
        <div className="sd-chips">
          <button type="button" className={`sd-chip${role === '' ? ' on' : ''}`} onClick={() => setRole('')}>
            All {rows.length}
          </button>
          {meta?.roles.map((r) => (
            <button key={r.key} type="button" className={`sd-chip${role === r.key ? ' on' : ''}`} onClick={() => setRole(r.key)}>
              {r.label} {counts[r.key] || 0}
            </button>
          ))}
        </div>
        {rows.length && meta?.roles.some((r) => !counts[r.key]) ? (
          <p className="practical-muted">
            No staff yet for: {meta.roles.filter((r) => !counts[r.key]).map((r) => r.label).join(', ')}. Exam duties can't ask for that role.
          </p>
        ) : null}
        <div className="file-number-toolbar">
          <ExportButtons columns={exportCols} rows={shown.map((r, i) => ({ sr: i + 1, ...r }))} filename="duty-assigned" title="Manage Assigned Staff Duty" />
          <label className="field table-filter" style={{ margin: 0 }}>
            <span>Search</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        {shown.length ? (
          <div className="table-scroll">
            <table className="table practical-table practical-nopin">
              <thead>
                <tr>
                  <th>Sr.No.</th>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Designation</th>
                  <th>Department</th>
                  <th>SalaryCode</th>
                  {bank ? (
                    <>
                      <th>BankName</th>
                      <th>IFSCCode</th>
                      <th>AccountNo</th>
                      <th>AccountType</th>
                    </>
                  ) : null}
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r._id}>
                    <td>{i + 1}</td>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td>{r.designation}</td>
                    <td>{r.department}</td>
                    <td>{r.salaryCode}</td>
                    {bank ? (
                      <>
                        <td>{r.bankName}</td>
                        <td>{r.ifsc}</td>
                        <td>{r.account}</td>
                        <td>{r.accountType}</td>
                      </>
                    ) : null}
                    <td>{r.roleLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">{sessionId ? 'No staff with a role in this session.' : ''}</p>
        )}
      </div>
    </Shell>
  );
}

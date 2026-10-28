import { useEffect, useMemo, useState } from 'react';
import { Shell } from '../../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons, ResultDialog } from '../../../components/ui';
import { get, patch, post } from '../../../api';
import { QuickAddDialog } from '../eligible/common';
import { PersonFields, addLookup, checkPerson, personOf, useSupervisorMeta, type PersonForm } from './common';

type Person = PersonForm & { _id: string };

const COLS: { key: keyof PersonForm; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'designation', label: 'Designation' },
  { key: 'department', label: 'Department' },
  { key: 'instituteName', label: 'Institute' },
  { key: 'address', label: 'Address' },
  { key: 'mobile', label: 'MobileNo' },
  { key: 'email', label: 'EmailId' },
];

/** Old "Edit All Supervisors": the registry of supervisors across all sessions. */
export function SupervisorPeoplePage() {
  const { meta, error: metaError, reload: reloadMeta } = useSupervisorMeta();
  const [rows, setRows] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; form: PersonForm } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; run: () => Promise<string> } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [addDesignation, setAddDesignation] = useState(false);

  async function load() {
    try {
      setRows(await get<Person[]>('/supervisor/people'));
      setSelected(new Set());
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => !q || COLS.map((c) => r[c.key]).join(' ').toLowerCase().includes(q));
  }, [rows, search]);
  const allChecked = shown.length > 0 && shown.every((r) => selected.has(r._id));

  function save() {
    if (!editing) return;
    const msg = checkPerson(editing.form);
    if (msg) return setFormError(msg);
    setConfirm({
      message: 'You want to Update Supervisor.',
      run: async () => {
        const r = await patch<{ draftsUpdated: number }>(`/supervisor/people/${editing.id}`, editing.form);
        setEditing(null);
        return r.draftsUpdated
          ? `Update Successfully. ${r.draftsUpdated} supervisor entry not yet sent to the Asstt. Controller was updated too.`
          : 'Update Successfully.';
      },
    });
  }

  function remove() {
    if (!selected.size) return setError('Please select atleast 1 data.');
    setConfirm({
      message: `You want to Delete ${selected.size} Supervisor(s). They are removed from the "Added Supervisor" list; their past appointments are kept.`,
      run: async () => {
        await post('/supervisor/people/delete', { ids: [...selected] });
        return 'Supervisor deleted Successfully.';
      },
    });
  }

  async function run() {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    try {
      setDone(await c.run());
      await load();
    } catch (err: any) {
      if (editing) setFormError(err.message);
      else setError(err.message);
    }
  }

  const exportCols = [{ key: 'sr', label: 'Sr.No.' }, ...COLS.map((c) => ({ key: c.key, label: c.label }))];
  const exportRows = shown.map((r, i) => ({ sr: i + 1, ...r }));

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Edit All Supervisors</h1>
          <p>Supervisors of every session. Picked from "Added Supervisor" on Add New Supervisor.</p>
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      <div className="card">
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Supervisor <span className="practical-count">{shown.length}</span>
          </h3>
          {meta?.can.edit ? (
            <button type="button" className="btn small danger" onClick={remove}>
              Delete
            </button>
          ) : null}
        </div>
        <div className="file-number-toolbar">
          <ExportButtons columns={exportCols} rows={exportRows} filename="all-supervisors" title="Edit All Supervisors" />
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
                  {COLS.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  {meta?.can.edit ? <th>Action</th> : null}
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
                    {COLS.map((c) => (
                      <td key={c.key}>{r[c.key]}</td>
                    ))}
                    {meta?.can.edit ? (
                      <td>
                        <button
                          type="button"
                          className="btn small secondary"
                          onClick={() => {
                            setEditing({ id: r._id, form: personOf(r) });
                            setFormError(null);
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">No supervisors yet. They are added from Add New Supervisor.</p>
        )}
      </div>
      {editing && meta ? (
        <div className="modal-overlay dialog-overlay" role="presentation">
          <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
            <h2>Edit Supervisor</h2>
            <ErrorBox error={formError} />
            <PersonFields
              meta={meta}
              value={editing.form}
              onChange={(form) => setEditing({ ...editing, form })}
              onAddDesignation={() => setAddDesignation(true)}
            />
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={save}>
                Submit
              </button>
              <button type="button" className="btn secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirm ? <ConfirmDialog title="Are you sure?" message={confirm.message} onYes={run} onNo={() => setConfirm(null)} /> : null}
      {done ? <ResultDialog ok message={done} onClose={() => setDone(null)} /> : null}
      {addDesignation ? (
        <QuickAddDialog
          title="Add Designation"
          label="Designation Name"
          onClose={() => setAddDesignation(false)}
          onSave={async (name) => {
            await addLookup('DESIGNATION', name);
            await reloadMeta();
            setEditing((e) => (e ? { ...e, form: { ...e.form, designation: name } } : e));
            setAddDesignation(false);
          }}
        />
      ) : null}
    </Shell>
  );
}


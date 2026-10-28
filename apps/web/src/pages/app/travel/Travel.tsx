import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { del, get, patch, post } from '../../../api';
import { Shell } from '../../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons, Field, Pill } from '../../../components/ui';
import { BookingTable, openAuthedFile } from '../practical/extras';

type Req = {
  _id: string;
  name: string;
  type: string;
  mobile: string;
  email: string;
  city?: string;
  instituteName?: string;
  courseName: string;
  specialityName: string;
  sessionLabel: string;
  booking: Record<string, any>;
  statusLabel: string;
  agentName: string;
};
type Agent = { _id: string; name: string; email: string; mobile?: string; active: boolean };

const TITLES: Record<string, string> = {
  requests: 'Ticket Requests',
  uploaded: 'Uploaded Tickets',
  cancelled: 'Canceled Tickets',
};
const PILL: Record<string, string> = {
  SENT_TO_TM: 'PENDING',
  SENT_TO_AGENT: 'IN_PROGRESS',
  TICKET_UPLOADED: 'APPROVED',
  TICKET_SENT: 'COMPLETED',
  CANCELLED: 'REJECTED',
};

/** Travel Manager (old TravalManager login): forward bookings to agents, upload and send tickets, cancel. */
export function TravelRequestsPage() {
  const { view = 'requests' } = useParams();
  const [rows, setRows] = useState<Req[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<Req | null>(null);
  const [agentPick, setAgentPick] = useState<Record<string, string>>({});
  const [cancelling, setCancelling] = useState<Req | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const [r, a] = await Promise.all([get<Req[]>(`/travel/requests?view=${view}`), get<Agent[]>('/travel/agents')]);
      setRows(r);
      setAgents(a.filter((x) => x.active));
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, [view]);

  async function act(id: string, label: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(label);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function uploadTicket(r: Req, file?: File | null) {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    act(r._id, `Ticket uploaded for ${r.name}`, () => post(`/travel/requests/${r._id}/ticket`, fd));
  }

  const cols = [
    { key: 'statusLabel', label: 'Status' },
    { key: 'name', label: 'Examiner' },
    { key: 'type', label: 'Type' },
    { key: 'courseName', label: 'Course' },
    { key: 'specialityName', label: 'Speciality' },
    { key: 'route', label: 'Route' },
    { key: 'dates', label: 'Onward / Return' },
    { key: 'agentName', label: 'Agent' },
  ];
  const exportRows = rows.map((r, i) => ({
    sr: i + 1,
    ...r,
    route: `${r.booking.fromPlace || ''} → ${r.booking.toPlace || ''}`,
    dates: `${r.booking.onwardDate || ''} / ${r.booking.returnDate || ''}`,
  }));

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>{TITLES[view] || TITLES.requests}</h1>
          <p>Air ticket requests from practical examiners, forwarded by the Dealing Assistant.</p>
        </div>
      </div>
      <ErrorBox error={error} />
      {notice ? <div className="practical-notice">{notice}</div> : null}
      {view === 'requests' && !agents.length ? (
        <div className="practical-task-note">Add a travel agent under "Travel Agents" before forwarding bookings.</div>
      ) : null}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total <span className="practical-count">{rows.length}</span>
          </h3>
          <ExportButtons columns={[{ key: 'sr', label: 'Sr.No.' }, ...cols]} rows={exportRows} filename={`travel-${view}`} />
        </div>
        {rows.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Sr.No.</th>
                  <th>Status</th>
                  <th>Examiner</th>
                  <th>Course / Speciality</th>
                  <th>Route</th>
                  <th>Onward / Return</th>
                  <th>Agent</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const s = r.booking.status;
                  return (
                    <tr key={r._id}>
                      <td>{i + 1}</td>
                      <td>
                        <span title={r.statusLabel}>
                          <Pill status={PILL[s] || s} />
                        </span>
                      </td>
                      <td>
                        {r.name}
                        <br />
                        <small className="practical-muted">
                          {r.type} · {r.mobile}
                        </small>
                      </td>
                      <td>
                        {r.courseName} / {r.specialityName}
                        <br />
                        <small className="practical-muted">{r.sessionLabel}</small>
                      </td>
                      <td>
                        {r.booking.fromPlace} → {r.booking.toPlace}
                      </td>
                      <td>
                        {r.booking.onwardDate} / {r.booking.returnDate}
                      </td>
                      <td>{r.agentName || '—'}</td>
                      <td>
                        <div className="row travel-actions">
                          <button type="button" className="btn small secondary" onClick={() => setOpen(r)}>
                            View
                          </button>
                          {['SENT_TO_TM', 'SENT_TO_AGENT'].includes(s) ? (
                            <>
                              <select
                                className="input travel-agent"
                                value={agentPick[r._id] || ''}
                                onChange={(e) => setAgentPick((p) => ({ ...p, [r._id]: e.target.value }))}
                              >
                                <option value="">-- Agent --</option>
                                {agents.map((a) => (
                                  <option key={a._id} value={a._id}>
                                    {a.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="btn small"
                                disabled={busy === r._id || !agentPick[r._id]}
                                onClick={() =>
                                  act(r._id, `Booking sent to agent for ${r.name}`, () =>
                                    post(`/travel/requests/${r._id}/send-agent`, { agentId: agentPick[r._id] }),
                                  )
                                }
                              >
                                {s === 'SENT_TO_AGENT' ? 'Re-send to Agent' : 'Send to Agent'}
                              </button>
                            </>
                          ) : null}
                          {['SENT_TO_TM', 'SENT_TO_AGENT', 'TICKET_UPLOADED'].includes(s) ? (
                            <label className="btn small secondary">
                              {s === 'TICKET_UPLOADED' ? 'Replace Ticket' : 'Upload Ticket'}
                              <input type="file" accept=".pdf,.png,.jpg,.jpeg" hidden onChange={(e) => uploadTicket(r, e.target.files?.[0])} />
                            </label>
                          ) : null}
                          {r.booking.hasTicket ? (
                            <button
                              type="button"
                              className="btn small secondary"
                              onClick={() => openAuthedFile(`/travel/requests/${r._id}/ticket`).catch((e) => setError(e.message))}
                            >
                              Ticket
                            </button>
                          ) : null}
                          {['TICKET_UPLOADED', 'TICKET_SENT'].includes(s) ? (
                            <button
                              type="button"
                              className="btn small"
                              disabled={busy === r._id}
                              onClick={() => act(r._id, `Ticket emailed to ${r.name}`, () => post(`/travel/requests/${r._id}/send-ticket`))}
                            >
                              {s === 'TICKET_SENT' ? 'Re-send Ticket' : 'Send Ticket to Examiner'}
                            </button>
                          ) : null}
                          {s !== 'CANCELLED' ? (
                            <button
                              type="button"
                              className="btn small danger"
                              onClick={() => {
                                setCancelReason('');
                                setCancelling(r);
                              }}
                            >
                              Cancel
                            </button>
                          ) : (
                            <small className="practical-muted">{r.booking.cancelReason}</small>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">Nothing here.</p>
        )}
      </div>
      {open ? (
        <div className="modal-overlay dialog-overlay" role="presentation" onClick={() => setOpen(null)}>
          <div className="modal-card dialog-card practical-letter-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Air booking — {open.name}</h2>
            <p className="practical-muted">
              {open.type} · {open.courseName} / {open.specialityName} · {open.mobile} · {open.email}
            </p>
            <BookingTable booking={open.booking} />
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => window.print()}>
                Print
              </button>
              <button type="button" className="btn secondary" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {cancelling ? (
        <div className="modal-overlay dialog-overlay" role="presentation">
          <div className="modal-card dialog-card" role="dialog" aria-modal="true">
            <h2>Cancel ticket — {cancelling.name}</h2>
            <p>{cancelling.agentName ? `The agent (${cancelling.agentName}) will be emailed to cancel the booking.` : 'No agent has been involved yet.'}</p>
            <Field label="Reason" required>
              <textarea className="input" rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            </Field>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn danger"
                disabled={!cancelReason.trim()}
                onClick={() => {
                  const r = cancelling;
                  setCancelling(null);
                  act(r._id, `Ticket cancelled for ${r.name}`, () => post(`/travel/requests/${r._id}/cancel`, { reason: cancelReason }));
                }}
              >
                Cancel ticket
              </button>
              <button type="button" className="btn secondary" onClick={() => setCancelling(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

/** Travel agents (old "Person Manager"). */
export function TravelAgentsPage() {
  const [rows, setRows] = useState<Agent[]>([]);
  const [form, setForm] = useState({ name: '', email: '', mobile: '' });
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Agent | null>(null);

  async function load() {
    try {
      setRows(await get<Agent[]>('/travel/agents'));
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editing) await patch(`/travel/agents/${editing}`, form);
      else await post('/travel/agents', form);
      setForm({ name: '', email: '', mobile: '' });
      setEditing(null);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Travel Agents</h1>
          <p>Booking requests are emailed to the agent you pick on each ticket request.</p>
        </div>
      </div>
      <ErrorBox error={error} />
      <form className="card" onSubmit={submit}>
        <div className="grid cols-3">
          <Field label="Agent / Agency name" required>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email" required>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Mobile">
            <input className="input" maxLength={10} value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, '') })} />
          </Field>
        </div>
        <div className="practical-actions-right">
          {editing ? (
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setEditing(null);
                setForm({ name: '', email: '', mobile: '' });
              }}
            >
              Cancel edit
            </button>
          ) : null}
          <button type="submit" className="btn">
            {editing ? 'Update' : 'Add Agent'}
          </button>
        </div>
      </form>
      <div className="card" style={{ marginTop: 14 }}>
        {rows.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Sr.No.</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Mobile</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a, i) => (
                  <tr key={a._id}>
                    <td>{i + 1}</td>
                    <td>{a.name}</td>
                    <td>{a.email}</td>
                    <td>{a.mobile}</td>
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          className="btn small secondary"
                          onClick={() => {
                            setEditing(a._id);
                            setForm({ name: a.name, email: a.email, mobile: a.mobile || '' });
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="btn small danger" onClick={() => setDeleting(a)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">No travel agents yet.</p>
        )}
      </div>
      {deleting ? (
        <ConfirmDialog
          title="Delete agent"
          message={`Delete ${deleting.name}?`}
          yesLabel="Delete"
          noLabel="Cancel"
          onYes={async () => {
            const a = deleting;
            setDeleting(null);
            try {
              await del(`/travel/agents/${a._id}`);
              await load();
            } catch (err: any) {
              setError(err.message);
            }
          }}
          onNo={() => setDeleting(null)}
        />
      ) : null}
    </Shell>
  );
}

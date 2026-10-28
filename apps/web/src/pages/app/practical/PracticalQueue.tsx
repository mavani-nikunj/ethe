import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { get, post } from '../../../api';
import { useAuth } from '../../../auth';
import { Shell } from '../../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons, MailBodyView, Pill } from '../../../components/ui';
import {
  BulkResult,
  BulkResultDialog,
  ExaminerEditDialog,
  FilterBar,
  PracticalRow,
  QueueFilters,
  ReasonDialog,
  filterQuery,
  usePracticalMeta,
} from './common';
import { PRACTICAL_MENU } from './menu';
import { PRACTICAL_AIR_STATUS_LABELS } from '@ethesis/shared';
import { BookingDialog, DeanSignatureCard, TemplatePickDialog } from './extras';

type Who = 'dealing' | 'dean';
type BulkAction = {
  label: string;
  who: Who;
  tone?: 'primary' | 'secondary' | 'danger';
  /** Not yet built: shown disabled so the screen matches the old menu. */
  phase?: string;
  confirm?: string;
  reason?: 'required' | 'optional';
  reasonLabel?: string;
  message?: string;
  /** Ask for a mail title (template) before running; it is passed as the second argument. */
  pickTemplate?: boolean;
  run?: (ids: string[], reason?: string) => Promise<BulkResult>;
};
type Column = { key: string; label: string; render?: (r: PracticalRow) => React.ReactNode };
type RowAction = 'reject' | 'edit' | 'editBank' | 'remarks' | 'delete' | 'letter' | 'appLetter' | 'dateLetters' | 'booking' | 'airRemarks';
/** Row actions everyone may use; the rest are Dealing-only. */
const VIEW_ONLY_ACTIONS: RowAction[] = ['letter', 'appLetter', 'dateLetters', 'booking'];

const base: Column[] = [
  { key: 'courseName', label: 'Course' },
  { key: 'specialityName', label: 'Speciality' },
  { key: 'typeLabel', label: 'ExaminerType' },
  { key: 'name', label: 'Name' },
  { key: 'designation', label: 'Designation' },
  { key: 'department', label: 'Department' },
  { key: 'instituteName', label: 'InstituteName' },
  { key: 'mobile', label: 'MobileNo' },
  { key: 'email', label: 'Email' },
];
const statusCol: Column = { key: 'statusLabel', label: 'Status', render: (r) => <Pill status={pillFor(r.status)} /> };
const approvedByCol: Column = { key: 'approvedByName', label: 'Approved By', render: (r) => r.approvedBy?.name || '' };
const offerSentCol: Column = {
  key: 'offerSent',
  label: 'Offer Sent',
  render: (r) => (r.offer?.sentAt ? new Date(r.offer.sentAt).toLocaleDateString('en-GB') : ''),
};
const appointedCol: Column = {
  key: 'appointedOn',
  label: 'Appointment Sent',
  render: (r) => (r.appointment?.sentAt ? new Date(r.appointment.sentAt).toLocaleDateString('en-GB') : ''),
};
const remarkCol: Column = { key: 'lastRemark', label: 'Remark' };
const addressCol: Column = { key: 'instituteAddress', label: 'InstituteAddress' };

function pillFor(status: string) {
  return (
    {
      PENDING: 'PENDING',
      WITH_DEAN: 'IN_PROGRESS',
      DEAN_HELD: 'HELD',
      DEAN_REJECTED: 'REJECTED',
      DEAN_APPROVED: 'APPROVED',
      OFFER_SENT: 'PENDING',
      REGRETTED: 'REGRETTED',
      ACCEPTED: 'ACCEPTED',
      APPOINTED: 'COMPLETED',
    }[status] || status
  );
}

const vet = (decision: string) => (ids: string[], remark?: string) =>
  post<BulkResult>('/practical/examiners/vet', { ids, decision, remark });

/** One entry per menu page. Old page headings kept as titles. */
const VIEWS: Record<string, { title: string; columns: Column[]; actions?: BulkAction[]; row?: RowAction[]; note?: string }> = {
  assigned: {
    title: 'Assign Examiner',
    columns: [statusCol, ...base],
    row: ['reject'],
    note: 'Every examiner entered for this session. Dealing can reject an examiner with a reason at any stage.',
  },
  edit: { title: 'Edit Practical Examiner', columns: [statusCol, ...base, addressCol], row: ['editBank'] },
  'to-dean': {
    title: 'Assign Examiner Send to Assoc. Dean',
    columns: base,
    row: ['letter', 'edit', 'delete'],
    actions: [
      {
        label: 'Send to Assoc. Dean',
        who: 'dealing',
        confirm: 'Send the selected examiners to the Associate Dean for approval?',
        run: (ids) => post('/practical/examiners/send-to-dean', { ids }),
      },
    ],
  },
  'with-dean': {
    title: 'Assigned Examiner Approval from Assoc. Dean',
    columns: base,
    row: ['letter'],
    actions: [
      { label: 'Approved and Send to Dealing', who: 'dean', reason: 'optional', run: vet('APPROVE') },
      { label: 'Hold', who: 'dean', tone: 'secondary', reason: 'optional', run: vet('HOLD') },
      { label: 'Rejected', who: 'dean', tone: 'danger', reason: 'required', run: vet('REJECT') },
    ],
  },
  held: {
    title: 'Hold practical examiner from Assoc. Dean',
    columns: [...base, remarkCol],
    actions: [
      { label: 'Approve', who: 'dean', reason: 'optional', run: vet('APPROVE') },
      { label: 'Rejected', who: 'dean', tone: 'danger', reason: 'required', run: vet('REJECT') },
    ],
  },
  'rejected-dean': {
    title: 'Rejected practical examiner from Assoc. Dean',
    columns: [...base, remarkCol],
    row: ['delete'],
    note: 'Dealing can delete a rejected examiner and add a replacement from Appointment of Examiner.',
    actions: [
      { label: 'Approve', who: 'dean', reason: 'optional', run: vet('APPROVE') },
      { label: 'Hold', who: 'dean', tone: 'secondary', reason: 'optional', run: vet('HOLD') },
    ],
  },
  approved: { title: 'Approved practical examiner from Assoc. Dean', columns: [statusCol, ...base, approvedByCol], row: ['letter'] },
  offer: {
    title: 'Approved Sent to Dealing and send Offer to Examiner',
    columns: [...base, approvedByCol],
    row: ['letter'],
    note: 'Offer mails carry a personal link. The examiner verifies an email passcode, then accepts (with bank details) or regrets.',
    actions: [
      {
        label: 'Send to Examiner with Regret',
        who: 'dealing',
        tone: 'secondary',
        reason: 'required',
        reasonLabel: 'Name of the examiner who regretted',
        message: 'Send the offer to the selected replacement examiner(s) and inform the rest of the board that this examiner regretted?',
        run: (ids, regrettedName) => post('/practical/examiners/offer/replacement', { ids, regrettedName }),
      },
      {
        label: 'Offer Send to Examiner',
        who: 'dealing',
        confirm: 'Email the offer letter to the selected examiners?',
        run: (ids) => post('/practical/examiners/offer', { ids }),
      },
    ],
  },
  'offer-pending': {
    title: 'Pending Offer Letter & Re-Send Offer Letter',
    columns: [...base, offerSentCol],
    row: ['letter'],
    actions: [
      {
        label: 'Re-Send to Examiner',
        who: 'dealing',
        confirm: 'Re-send the offer letter (same link) to the selected examiners?',
        run: (ids) => post('/practical/examiners/offer/resend', { ids }),
      },
    ],
  },
  regret: {
    title: 'Rejected from Practical Examiner',
    columns: [...base, addressCol, { key: 'whyRegret', label: 'Reason', render: (r) => r.regretReason || r.rejectReason || '' }],
    row: ['remarks'],
    actions: [
      {
        label: 'Delete Practical Examiner',
        who: 'dealing',
        tone: 'danger',
        confirm: 'Delete the selected examiners? Add their replacements from Appointment of Examiner.',
        run: (ids) => post('/practical/examiners/delete', { ids }),
      },
    ],
  },
  accepted: {
    title: 'Accepted from Practical Examiner',
    columns: [{ key: 'examinerCode', label: 'Examiner Code' }, ...base, { key: 'bank', label: 'Bank', render: (r) => (r.hasBank ? 'Received' : '—') }],
    row: ['appLetter'],
    actions: [
      {
        label: 'Appointment Letter Send to Examiner',
        who: 'dealing',
        confirm: 'Email the appointment letter (with the examiner portal link) to the selected examiners?',
        run: (ids) => post('/practical/examiners/appoint', { ids }),
      },
    ],
  },
  portal: {
    title: 'Pending Examiner and Re-send Examiner',
    columns: [{ key: 'examinerCode', label: 'Examiner Code' }, ...base, appointedCol],
    row: ['appLetter'],
    actions: [
      {
        label: 'Send Email',
        who: 'dealing',
        pickTemplate: true,
        run: (ids, purpose) => post('/practical/examiners/mail', { ids, purpose }),
      },
      {
        label: 'Re-Send',
        who: 'dealing',
        tone: 'secondary',
        confirm: 'Re-send the appointment letter (same portal link) to the selected examiners?',
        run: (ids) => post('/practical/examiners/appoint/resend', { ids }),
      },
    ],
  },
  passcodes: {
    title: 'Passcode Generate Examiner',
    columns: [
      ...base.slice(0, 3),
      { key: 'department', label: 'Examiner Department' },
      ...base.slice(3, 7),
      { key: 'city', label: 'CityName' },
      ...base.slice(7),
      { key: 'passcode', label: 'Passcode', render: (r) => (r.portal?.generatedAt ? `Generated ${fmtDate(r.portal.generatedAt)}` : 'Not yet') },
      { key: 'lastLogin', label: 'Last Login', render: (r) => (r.portal?.lastLoginAt ? fmtDateTime(r.portal.lastLoginAt) : '—') },
    ],
  },
  chairperson: {
    title: 'Chairperson Examiner',
    columns: [
      { key: 'dateMail', label: 'Mail Status', render: (r) => DATE_LABEL[r.dateMail?.state || 'PENDING'] },
      { key: 'practicalDate', label: 'Practical Date', render: (r) => r.practicalDate || 'Not fixed yet' },
      ...base,
    ],
    row: ['dateLetters'],
    note: 'The Chairperson / Exam Coordinator enters the practical date on the examiner portal. Then send "Practical Date Fixed" to the whole board.',
    actions: [
      {
        label: 'Practical Date Chairperson Reminder',
        who: 'dealing',
        tone: 'danger',
        confirm: 'Send the reminder to the selected Chairpersons who have not fixed the practical date?',
        run: (ids) => post('/practical/chairperson/date-reminder', { ids }),
      },
      {
        label: 'Practical Date Chairperson and All Examiner',
        who: 'dealing',
        tone: 'secondary',
        confirm: 'Ask the selected Chairpersons to fix the practical date, and inform the other board members?',
        run: (ids) => post('/practical/chairperson/date-request', { ids }),
      },
      {
        label: 'Practical Date Fixed',
        who: 'dealing',
        tone: 'secondary',
        confirm: 'Email the fixed practical date to every appointed member of the selected boards?',
        run: (ids) => post('/practical/chairperson/date-fixed', { ids }),
      },
    ],
  },
  air: {
    title: 'Air booking Examiner',
    note: 'Examiners appear here after they submit an Air Booking on their Practical Portal (sent with the appointment letter). Tick the Requested ones and send them to the Travel Manager.',
    columns: [
      { key: 'airStatus', label: 'Status', render: (r) => <Pill status={AIR_PILL[r.airBooking?.status || ''] || 'PENDING'} /> },
      { key: 'airStatusLabel', label: 'Booking', render: (r) => AIR_LABELS[r.airBooking?.status || ''] || '' },
      ...base,
      { key: 'route', label: 'Route', render: (r) => (r.airBooking ? `${r.airBooking.fromPlace || ''} → ${r.airBooking.toPlace || ''}` : '') },
      { key: 'dates', label: 'Onward / Return', render: (r) => (r.airBooking ? `${r.airBooking.onwardDate || ''} / ${r.airBooking.returnDate || ''}` : '') },
    ],
    row: ['booking', 'airRemarks'],
    actions: [
      {
        label: 'Ticket Request to Traval Manager',
        who: 'dealing',
        confirm: 'Forward the selected air bookings to the Travel Manager?',
        run: (ids) => post('/practical/air/ticket-request', { ids }),
      },
    ],
  },
};

const DATE_LABEL: Record<string, string> = { PENDING: 'Not requested', REQUESTED: 'Date requested', FIXED: 'Sent to board' };
const AIR_PILL: Record<string, string> = {
  REQUESTED: 'PENDING',
  SENT_TO_TM: 'IN_PROGRESS',
  SENT_TO_AGENT: 'IN_PROGRESS',
  TICKET_UPLOADED: 'APPROVED',
  TICKET_SENT: 'COMPLETED',
  CANCELLED: 'REJECTED',
};
const AIR_LABELS = PRACTICAL_AIR_STATUS_LABELS;

function fmtDate(v?: string) {
  return v ? new Date(v).toLocaleDateString('en-GB') : '';
}
function fmtDateTime(v?: string) {
  return v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '';
}

export function PracticalQueuePage() {
  const { view = '' } = useParams();
  const { user } = useAuth();
  const config = VIEWS[view];
  const menuLabel = PRACTICAL_MENU.find((m) => m.path === view)?.label;
  const { meta, error: metaError } = usePracticalMeta();
  const [filters, setFilters] = useState<QueueFilters>({ sessionId: '', dealingId: '', courseId: '', specialityId: '' });
  const [rows, setRows] = useState<PracticalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<BulkAction | null>(null);
  const [result, setResult] = useState<{ title: string; result: BulkResult } | null>(null);
  const [rejecting, setRejecting] = useState<PracticalRow | null>(null);
  const [deleting, setDeleting] = useState<PracticalRow | null>(null);
  const [editing, setEditing] = useState<{ id: string; bank: boolean } | null>(null);
  const [remarkDraft, setRemarkDraft] = useState<Record<string, string>>({});
  const [letter, setLetter] = useState<{ subject: string; body: string } | null>(null);
  const [booking, setBooking] = useState<PracticalRow | null>(null);

  useEffect(() => {
    if (meta && !filters.sessionId) setFilters((f) => ({ ...f, sessionId: meta.currentSessionId || meta.sessions[0]?._id || '' }));
  }, [meta]);

  async function load(f = filters) {
    if (!config || !f.sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await get<PracticalRow[]>(`/practical/examiners?${filterQuery(f, { view })}`);
      setRows(data);
      setSelected(new Set());
      setRemarkDraft(Object.fromEntries(data.map((r) => [r._id, (view === 'air' ? r.airBooking?.remarks : r.remarks) || ''])));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setRows([]);
    setSearch('');
    load();
  }, [view, filters.sessionId]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.email, r.mobile, r.courseName, r.specialityName, r.typeLabel, r.designation, r.department, r.instituteName]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  if (!config) return <Navigate to="/app/practical/assigned" replace />;

  const isDealing = !!meta?.can.edit;
  const isDean = !!meta?.can.vet;
  const myActions = (config.actions || []).filter((a) => (a.who === 'dealing' ? isDealing : isDean));
  // Letter preview is for everyone; the other row actions are Dealing-only.
  const rowActions = (config.row || []).filter((a) => VIEW_ONLY_ACTIONS.includes(a) || isDealing);
  const selectable = myActions.length > 0;
  const columns = config.columns;
  const exportCols = [{ key: 'sr', label: 'Sr.No.' }, ...columns.map((c) => ({ key: c.key, label: c.label }))];
  const cellText = (c: Column, r: PracticalRow) => {
    if (c.key === 'statusLabel') return r.statusLabel;
    const v = c.render ? c.render(r) : (r as any)[c.key];
    return typeof v === 'string' || typeof v === 'number' ? v : ((r as any)[c.key] ?? '');
  };
  const exportRows = shown.map((r, i) => ({
    sr: i + 1,
    ...Object.fromEntries(columns.map((c) => [c.key, cellText(c, r)])),
  }));
  const allChecked = shown.length > 0 && shown.every((r) => selected.has(r._id));

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function startAction(a: BulkAction) {
    if (!a.run) return;
    if (!selected.size) {
      setError('Select at least one examiner.');
      return;
    }
    setError(null);
    setPending(a);
  }

  async function runPending(reason?: string) {
    const a = pending;
    setPending(null);
    if (!a?.run) return;
    try {
      const res = await a.run([...selected], reason);
      setResult({ title: a.label, result: res });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function rejectRow(reason: string) {
    const r = rejecting;
    setRejecting(null);
    if (!r) return;
    try {
      await post(`/practical/examiners/${r._id}/reject`, { reason });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function deleteRow() {
    const r = deleting;
    setDeleting(null);
    if (!r) return;
    try {
      const res = await post<BulkResult>('/practical/examiners/delete', { ids: [r._id] });
      if (res.skipped.length) setError(res.skipped[0].reason);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function saveAirRemark(r: PracticalRow) {
    try {
      await post(`/practical/examiners/${r._id}/air-remarks`, { remarks: remarkDraft[r._id] ?? r.airBooking?.remarks ?? '' });
      setResult({ title: 'Save Remarks', result: { updated: 1, skipped: [] } });
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function openLetter(r: PracticalRow, kind = 'offer') {
    try {
      setLetter(await get(`/practical/examiners/${r._id}/letter/${kind}`));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function saveRemark(r: PracticalRow) {
    try {
      await post(`/practical/examiners/${r._id}/remarks`, { remarks: remarkDraft[r._id] || '' });
      setResult({ title: 'Save Remarks', result: { updated: 1, skipped: [] } });
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>{config.title}</h1>
          {menuLabel && menuLabel !== config.title ? <p>{menuLabel}</p> : null}
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      {meta ? (
        <FilterBar
          meta={meta}
          value={filters}
          onChange={setFilters}
          onSearch={() => load()}
        />
      ) : null}
      {meta?.can.vet && view === 'with-dean' ? <DeanSignatureCard /> : null}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Examiner <span className="practical-count">{shown.length}</span>
          </h3>
          <div className="row">
            {myActions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={`btn small${a.tone === 'secondary' ? ' secondary' : a.tone === 'danger' ? ' danger' : ''}`}
                disabled={!!a.phase || loading}
                title={a.phase ? `Coming in ${a.phase} of the build plan` : undefined}
                onClick={() => startAction(a)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
        {config.note ? <p className="practical-muted">{config.note}</p> : null}
        {config.actions?.length && !myActions.length ? (
          <p className="practical-muted">
            {config.actions[0].who === 'dealing'
              ? 'Only the Dealing Assistant can act on this list.'
              : 'Only the Associate Dean can act on this list.'}
            {isDean && view === 'to-dean' ? (
              <>
                {' '}
                Once sent, these examiners appear in{' '}
                <Link to="/app/practical/with-dean">Assigned Examiner Approval from Assoc. Dean</Link> for your approval.
              </>
            ) : null}
          </p>
        ) : null}
        <div className="file-number-toolbar">
          <ExportButtons columns={exportCols} rows={exportRows} filename={`practical-${view}`} title={config.title} />
          <label className="field table-filter" style={{ margin: 0 }}>
            <span>Search</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email, speciality…" />
          </label>
        </div>
        {loading ? (
          <p className="practical-empty">Loading…</p>
        ) : shown.length ? (
          <div className="table-scroll">
            <table className={`table practical-table${rowActions.length ? '' : ' practical-nopin'}`}>
              <thead>
                <tr>
                  {selectable ? (
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? new Set() : new Set(shown.map((r) => r._id)))}
                      />
                    </th>
                  ) : null}
                  <th>Sr.No.</th>
                  {columns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  {rowActions.length ? <th>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r._id}>
                    {selectable ? (
                      <td>
                        <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r._id)} onChange={() => toggle(r._id)} />
                      </td>
                    ) : null}
                    <td>{i + 1}</td>
                    {columns.map((c) => (
                      <td key={c.key}>{c.render ? c.render(r) : ((r as any)[c.key] ?? '')}</td>
                    ))}
                    {rowActions.length ? (
                      <td>
                        <div className="row">
                          {rowActions.includes('reject') && r.status !== 'REGRETTED' ? (
                            <button type="button" className="btn small danger" onClick={() => setRejecting(r)}>
                              Reject
                            </button>
                          ) : null}
                          {rowActions.includes('reject') && r.status === 'REGRETTED' ? (
                            <span className="practical-muted" title={r.rejectReason || r.lastRemark}>
                              Rejected
                            </span>
                          ) : null}
                          {rowActions.includes('letter') ? (
                            <button type="button" className="btn small secondary" onClick={() => openLetter(r)}>
                              Offer Letter
                            </button>
                          ) : null}
                          {rowActions.includes('edit') ? (
                            <button type="button" className="btn small secondary" onClick={() => setEditing({ id: r._id, bank: false })}>
                              Edit
                            </button>
                          ) : null}
                          {rowActions.includes('editBank') ? (
                            <button type="button" className="btn small secondary" onClick={() => setEditing({ id: r._id, bank: true })}>
                              Edit
                            </button>
                          ) : null}
                          {rowActions.includes('delete') ? (
                            <button type="button" className="btn small danger" onClick={() => setDeleting(r)}>
                              Delete
                            </button>
                          ) : null}
                          {rowActions.includes('appLetter') ? (
                            <button type="button" className="btn small secondary" onClick={() => openLetter(r, 'appointment')}>
                              Appointment Letter
                            </button>
                          ) : null}
                          {rowActions.includes('dateLetters') ? (
                            <>
                              <button type="button" className="btn small secondary" onClick={() => openLetter(r, 'date-request')}>
                                Request
                              </button>
                              <button type="button" className="btn small secondary" onClick={() => openLetter(r, 'date-reminder')}>
                                Reminder
                              </button>
                              <button type="button" className="btn small secondary" onClick={() => openLetter(r, 'date-fixed')}>
                                Date Fixed
                              </button>
                            </>
                          ) : null}
                          {rowActions.includes('booking') && r.airBooking ? (
                            <button type="button" className="btn small secondary" onClick={() => setBooking(r)}>
                              View Booking
                            </button>
                          ) : null}
                          {rowActions.includes('airRemarks') ? (
                            <>
                              <input
                                className="input practical-remark"
                                value={remarkDraft[r._id] ?? r.airBooking?.remarks ?? ''}
                                onChange={(e) => setRemarkDraft((d) => ({ ...d, [r._id]: e.target.value }))}
                                placeholder="Remarks"
                              />
                              <button type="button" className="btn small secondary" onClick={() => saveAirRemark(r)}>
                                Save Remarks
                              </button>
                            </>
                          ) : null}
                          {rowActions.includes('remarks') ? (
                            <>
                              <input
                                className="input practical-remark"
                                value={remarkDraft[r._id] || ''}
                                onChange={(e) => setRemarkDraft((d) => ({ ...d, [r._id]: e.target.value }))}
                                placeholder="Remarks"
                              />
                              <button type="button" className="btn small secondary" onClick={() => saveRemark(r)}>
                                Save Remarks
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">No examiners in this list.</p>
        )}
      </div>

      {pending && pending.pickTemplate ? (
        <TemplatePickDialog title={pending.label} count={selected.size} onYes={(purpose) => runPending(purpose)} onNo={() => setPending(null)} />
      ) : null}
      {pending && !pending.pickTemplate && pending.reason ? (
        <ReasonDialog
          title={pending.label}
          message={pending.message || `${pending.label} for ${selected.size} selected examiner${selected.size === 1 ? '' : 's'}?`}
          label={pending.reasonLabel || (pending.reason === 'required' ? 'Reason' : 'Remark (optional)')}
          required={pending.reason === 'required'}
          yesLabel={pending.label}
          onYes={runPending}
          onNo={() => setPending(null)}
        />
      ) : null}
      {pending && !pending.pickTemplate && !pending.reason ? (
        <ConfirmDialog
          title={pending.label}
          message={pending.confirm || `${pending.label} for ${selected.size} selected examiner(s)?`}
          yesLabel="Yes"
          noLabel="Cancel"
          onYes={() => runPending()}
          onNo={() => setPending(null)}
        />
      ) : null}
      {rejecting ? (
        <ReasonDialog
          title="Reject Examiner"
          message={`Reject ${rejecting.name} (${rejecting.typeLabel}, ${rejecting.specialityName})? The examiner moves to "Rejected from Practical Examiner" for replacement.`}
          required
          yesLabel="Reject"
          onYes={rejectRow}
          onNo={() => setRejecting(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete Examiner"
          message={`Delete ${deleting.name} from ${deleting.specialityName}? This cannot be undone.`}
          yesLabel="Delete"
          noLabel="Cancel"
          onYes={deleteRow}
          onNo={() => setDeleting(null)}
        />
      ) : null}
      {editing ? (
        <ExaminerEditDialog
          id={editing.id}
          withBank={editing.bank}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}
      {result ? <BulkResultDialog title={result.title} result={result.result} onClose={() => setResult(null)} /> : null}
      {booking ? <BookingDialog row={booking} onClose={() => setBooking(null)} /> : null}
      {letter ? (
        <div className="modal-overlay dialog-overlay" role="presentation" onClick={() => setLetter(null)}>
          <div className="modal-card dialog-card practical-letter-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>{letter.subject}</h2>
            <MailBodyView body={letter.body} />
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setLetter(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {user && !meta && !metaError ? <p className="practical-empty">Loading…</p> : null}
    </Shell>
  );
}

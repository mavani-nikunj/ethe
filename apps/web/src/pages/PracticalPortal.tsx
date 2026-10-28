import { FormEvent, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PRACTICAL_AIR_STATUS_LABELS, PRODUCT_NAME } from '@ethesis/shared';
import { api } from '../api';
import { BrandBar } from '../components/BrandBar';
import { ErrorBox, Field } from '../components/ui';
import { BookingTable } from './app/practical/extras';

/**
 * Examiner portal (old AppoinmentLogin): opened from the appointment letter. A passcode is emailed
 * on first open; after verifying, the examiner sees the board, documents and (Chairperson) the
 * practical date field, and can request air travel.
 */
type Peek = {
  name: string;
  email: string;
  passcodeRequested: boolean;
  portalBlocked?: string | null;
  institute: { name: string; logoUrl?: string } | null;
  course: string;
  speciality: string;
  session: string;
  examinerType: string;
};
type Doc = { _id: string; kind: string; uploadType?: number; label: string; originalName: string };
type Portal = Peek & {
  examinerCode?: string;
  isChair: boolean;
  examiner: Record<string, string>;
  practicalDate: string;
  practicalDateBy: string;
  tentativeSchedule: string;
  totalMarks: number | null;
  board: { type: string; name: string; designation?: string; instituteName?: string; city?: string; mobile?: string; email?: string }[];
  documents: Doc[];
  airBooking: Record<string, any> | null;
  airFields: [string, string][];
};

const MENU: { key: string; label: string; group?: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'guideline', label: 'Examination Guideline' },
  { key: 'paper', label: 'Previous Question Paper', group: 'Preparation of Question Paper' },
  { key: 'format', label: 'Format of New Question Paper', group: 'Preparation of Question Paper' },
  { key: 'remuneration', label: 'Remuneration', group: 'Remuneration and TA / DA' },
  { key: 'air', label: 'Air', group: 'Remuneration and TA / DA' },
  { key: 'rail', label: 'Rail', group: 'Remuneration and TA / DA' },
  { key: 'road', label: 'Road', group: 'Remuneration and TA / DA' },
  { key: 'boarding', label: 'Boarding and Lodging (DA)', group: 'Remuneration and TA / DA' },
  { key: 'booking', label: 'Air Booking' },
];
/** Menu key -> document upload type (see PRACTICAL_DOC_TYPES). */
const DOC_FOR: Record<string, number> = { guideline: 1, format: 2, remuneration: 3, air: 4, rail: 5, road: 6, boarding: 7 };

export function PracticalPortalPage() {
  const { token = '' } = useParams();
  const storeKey = `practical-portal:${token}`;
  const [peek, setPeek] = useState<Peek | null>(null);
  const [data, setData] = useState<Portal | null>(null);
  const [session, setSession] = useState(() => sessionStorage.getItem(storeKey) || '');
  const [otp, setOtp] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('dashboard');
  const [dateDraft, setDateDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [booking, setBooking] = useState<Record<string, any>>({});
  const autoSent = useRef(false);

  const headers = () => ({ 'x-practical-session': session });

  async function sendOtp(silent = false) {
    if (!silent) setError(null);
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/practical-tasks/${token}/otp`, { method: 'POST' });
      setHint(r.message);
      setPeek((p) => (p ? { ...p, passcodeRequested: true } : p));
    } catch (err: any) {
      if (!silent) setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    api<Peek>(`/practical-tasks/${token}`)
      .then((p) => {
        setPeek(p);
        if (p.passcodeRequested) setHint(`A passcode was sent to ${p.email}.`);
        // Old portal behaviour: the passcode is mailed as soon as the link is opened.
        if (!p.portalBlocked && !p.passcodeRequested && !session && !autoSent.current) {
          autoSent.current = true;
          sendOtp(true);
        }
      })
      .catch((err) => setError(err.message));
  }, [token]);

  async function loadPortal() {
    try {
      const d = await api<Portal>(`/practical-tasks/${token}/portal`, { headers: headers() });
      setData(d);
      setDateDraft(d.practicalDate || '');
      setBooking(d.airBooking || { passengerName: d.examiner?.name || '', toPlace: '' });
    } catch {
      sessionStorage.removeItem(storeKey);
      setSession('');
    }
  }

  useEffect(() => {
    if (session && peek && !peek.portalBlocked) loadPortal();
  }, [session, peek]);

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ session: string }>(`/practical-tasks/${token}/verify`, { method: 'POST', body: JSON.stringify({ otp: otp.trim() }) });
      sessionStorage.setItem(storeKey, r.session);
      setSession(r.session);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveDate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api(`/practical-tasks/${token}/portal/practical-date`, {
        method: 'POST',
        body: JSON.stringify({ practicalDate: dateDraft }),
        headers: headers(),
      });
      setNotice('Practical date saved. The Examination Section will inform all members of the Board of Examiners.');
      await loadPortal();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function saveBooking(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api(`/practical-tasks/${token}/portal/air-booking`, { method: 'POST', body: JSON.stringify(booking), headers: headers() });
      setNotice('Air booking request submitted to the Examination Section.');
      await loadPortal();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function logout() {
    sessionStorage.removeItem(storeKey);
    setSession('');
    setData(null);
  }

  const docLink = (d: Doc) => `/api/practical-tasks/${token}/portal/doc/${d._id}?s=${encodeURIComponent(session)}`;
  const docsOf = (key: string) =>
    !data ? [] : key === 'paper' ? data.documents.filter((d) => d.kind === 'QUESTION_PAPER') : data.documents.filter((d) => d.uploadType === DOC_FOR[key]);
  const info = data || peek;
  const bookingLocked = Boolean(data?.airBooking?.status && !['REQUESTED', 'CANCELLED'].includes(data.airBooking.status));

  return (
    <div className="guide-shell">
      <BrandBar
        logoUrl={info?.institute?.logoUrl}
        title={info?.institute?.name || PRODUCT_NAME}
        right={
          peek ? (
            <div>
              <div>{peek.name}</div>
              {data ? (
                <button type="button" className="btn small secondary" onClick={logout}>
                  Logout
                </button>
              ) : (
                <div>{peek.email}</div>
              )}
            </div>
          ) : null
        }
      />
      {!data ? (
        <div className="practical-task">
          <div className="guide-card">
            <div className="guide-kicker">Examination Section · Examiner portal</div>
            <h1 className="practical-task-title">Theory / Practical Examination portal</h1>
            {peek ? (
              <dl className="practical-task-facts">
                <div>
                  <dt>Examiner Name</dt>
                  <dd>{peek.name}</dd>
                </div>
                <div>
                  <dt>Course Name</dt>
                  <dd>{peek.course}</dd>
                </div>
                <div>
                  <dt>Speciality</dt>
                  <dd>{peek.speciality}</dd>
                </div>
              </dl>
            ) : null}
            <ErrorBox error={error || peek?.portalBlocked || null} />
            {!peek && !error ? <p>Loading…</p> : null}
            {peek && !peek.portalBlocked ? (
              <form onSubmit={verify}>
                {hint ? <div className="okbox">{hint}</div> : <p>A passcode will be emailed to {peek.email}.</p>}
                <Field label="Pass Code" required>
                  <input
                    className="input practical-task-code"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Enter Pass Code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  />
                </Field>
                <div className="row">
                  <button type="submit" className="btn" disabled={busy || otp.length !== 6}>
                    Verify
                  </button>
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => sendOtp(false)}>
                    Resend Pass Code
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="portal-layout">
          <nav className="portal-menu">
            {MENU.map((m, i) => (
              <div key={m.key}>
                {m.group && MENU[i - 1]?.group !== m.group ? <div className="portal-menu-group">{m.group}</div> : null}
                <button
                  type="button"
                  className={`${tab === m.key ? 'active' : ''}${m.group ? ' sub' : ''}`}
                  onClick={() => {
                    setTab(m.key);
                    setNotice(null);
                    setError(null);
                  }}
                >
                  {m.label}
                </button>
              </div>
            ))}
          </nav>
          <main className="portal-main">
            <ErrorBox error={error} />
            {notice ? <div className="practical-notice">{notice}</div> : null}
            {tab === 'dashboard' ? (
              <>
                <div className="guide-card">
                  <h2 className="portal-h">
                    Board of examiners of {data.course} in {data.speciality}
                  </h2>
                  <p className="practical-muted">
                    {data.session}
                    {data.tentativeSchedule ? ` · Tentative schedule: ${data.tentativeSchedule}` : ''}
                    {data.totalMarks ? ` · ${data.totalMarks} marks` : ''}
                  </p>
                  <div className="table-scroll">
                    <table className="table practical-nopin">
                      <thead>
                        <tr>
                          <th>Board Member</th>
                          <th>Name</th>
                          <th>Institute</th>
                          <th>Mobile</th>
                          <th>Email</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.board.map((b, i) => (
                          <tr key={i}>
                            <td>{b.type}</td>
                            <td>
                              {b.name}
                              {b.city ? ` (${b.city})` : ''}
                            </td>
                            <td>{b.instituteName}</td>
                            <td>{b.mobile}</td>
                            <td>{b.email}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="guide-card" style={{ marginTop: 14 }}>
                  <h2 className="portal-h">Examiner Detail</h2>
                  <dl className="practical-task-facts">
                    <div>
                      <dt>Examiner Name</dt>
                      <dd>
                        {data.examiner.name} — {data.examinerType}
                      </dd>
                    </div>
                    <div>
                      <dt>Examiner Code</dt>
                      <dd>{data.examinerCode || '—'}</dd>
                    </div>
                    <div>
                      <dt>Institute</dt>
                      <dd>{data.examiner.instituteName}</dd>
                    </div>
                    <div>
                      <dt>Mobile No</dt>
                      <dd>{data.examiner.mobile}</dd>
                    </div>
                    <div>
                      <dt>Institute Address</dt>
                      <dd>{data.examiner.instituteAddress}</dd>
                    </div>
                  </dl>
                  <h3 className="practical-subhead">Practical date</h3>
                  {data.isChair ? (
                    <form className="practical-inline" onSubmit={saveDate}>
                      <input
                        className="input"
                        value={dateDraft}
                        onChange={(e) => setDateDraft(e.target.value)}
                        placeholder="e.g. 18 Nov 2026 and 19 Nov 2026"
                      />
                      <button type="submit" className="btn">
                        Submit
                      </button>
                    </form>
                  ) : null}
                  <p className={data.practicalDate ? '' : 'practical-muted'}>
                    {data.practicalDate
                      ? `Fixed: ${data.practicalDate}${data.practicalDateBy ? ` (by ${data.practicalDateBy})` : ''}`
                      : data.isChair
                        ? 'Please fix the practical date(s) in consultation with the Board of Examiners and submit them here.'
                        : 'The Chairperson has not fixed the practical date yet.'}
                  </p>
                </div>
                <div className="guide-card" style={{ marginTop: 14 }}>
                  <h2 className="portal-h">Instruction</h2>
                  <ul className="portal-instructions">
                    <li>The Chairperson is the point of contact between the Examiners and the Examination Section.</li>
                    <li>Question papers are set by External and Internal Examiners and signed by the Internal Examiners and Chairperson.</li>
                    <li>External Examiners should submit their air travel itinerary under Air Booking as soon as the dates are fixed.</li>
                    <li>Guidelines, previous question paper, remuneration and TA/DA rules are in the menu on the left.</li>
                  </ul>
                </div>
              </>
            ) : null}
            {tab !== 'dashboard' && tab !== 'booking' ? (
              <div className="guide-card">
                <h2 className="portal-h">{MENU.find((m) => m.key === tab)?.label}</h2>
                {docsOf(tab).length ? (
                  <ul className="portal-docs">
                    {docsOf(tab).map((d) => (
                      <li key={d._id}>
                        <a href={docLink(d)} target="_blank" rel="noreferrer">
                          {d.originalName}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="practical-muted">The Examination Section has not uploaded this document yet.</p>
                )}
              </div>
            ) : null}
            {tab === 'booking' ? (
              <div className="guide-card">
                <h2 className="portal-h">Air Booking</h2>
                {data.airBooking?.status ? (
                  <p>
                    Status: <b>{PRACTICAL_AIR_STATUS_LABELS[data.airBooking.status] || data.airBooking.status}</b>
                    {data.airBooking.status === 'TICKET_SENT' ? (
                      <>
                        {' '}
                        —{' '}
                        <a href={`/api/practical-tasks/${token}/portal/ticket?s=${encodeURIComponent(session)}`} target="_blank" rel="noreferrer">
                          Download ticket
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
                {bookingLocked ? (
                  <BookingTable booking={data.airBooking || {}} />
                ) : (
                  <form onSubmit={saveBooking}>
                    <p className="practical-muted">Only economy class tickets are booked, as per Government of India guidelines.</p>
                    <div className="grid cols-2">
                      {data.airFields.map(([k, label]) =>
                        k === 'hotelNeeded' ? (
                          <Field key={k} label={label}>
                            <select className="input" value={booking[k] ? 'Yes' : 'No'} onChange={(e) => setBooking((b) => ({ ...b, [k]: e.target.value === 'Yes' }))}>
                              <option>No</option>
                              <option>Yes</option>
                            </select>
                          </Field>
                        ) : k === 'gender' ? (
                          <Field key={k} label={label} required>
                            <select className="input" value={booking[k] || ''} onChange={(e) => setBooking((b) => ({ ...b, [k]: e.target.value }))}>
                              <option value="">-- Select --</option>
                              <option>Male</option>
                              <option>Female</option>
                              <option>Other</option>
                            </select>
                          </Field>
                        ) : (
                          <Field key={k} label={label} required={['passengerName', 'fromPlace', 'toPlace', 'onwardDate', 'returnDate'].includes(k)}>
                            <input
                              className="input"
                              type={k === 'onwardDate' || k === 'returnDate' ? 'date' : 'text'}
                              value={booking[k] || ''}
                              onChange={(e) => setBooking((b) => ({ ...b, [k]: e.target.value }))}
                            />
                          </Field>
                        ),
                      )}
                    </div>
                    <div className="practical-actions-right">
                      <button type="submit" className="btn">
                        {data.airBooking?.status ? 'Update request' : 'Submit request'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ) : null}
          </main>
        </div>
      )}
    </div>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PRODUCT_NAME, withLetterheadLogo } from '@ethesis/shared';
import { api } from '../api';
import { BrandBar } from '../components/BrandBar';
import { ErrorBox, Field } from '../components/ui';

/**
 * Supervisor offer link (old SupervisorAcceptance page "Acceptance for Supervisor"): verify an email
 * passcode, then accept with details + bank + cancelled cheque, or reject with a reason.
 */
type DutyRow = { examName: string; date: string; reportingTime: string; shift: string };
type Peek = {
  name: string;
  email: string;
  passcodeRequested: boolean;
  responded: 'ACCEPTED' | 'REGRETTED' | 'WITHDRAWN' | null;
  institute: { name: string; logoUrl?: string } | null;
  session: string;
  duties: DutyRow[];
};
type Detail = Peek & {
  supervisor: Record<string, string>;
  designations: string[];
  departments: string[];
  letter: { subject: string; body: string } | null;
};

const SESSION_HEADER = 'x-supervisor-session';

export function SupervisorTaskPage() {
  const { token = '' } = useParams();
  const storeKey = `supervisor-session:${token}`;
  const [peek, setPeek] = useState<Peek | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [session, setSession] = useState(() => sessionStorage.getItem(storeKey) || '');
  const [otp, setOtp] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<'accept' | 'reject' | ''>('');
  const [form, setForm] = useState<Record<string, string>>({});
  const [declare, setDeclare] = useState({ noRelative: false, available: false });
  const [cheque, setCheque] = useState<File | null>(null);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const headers = () => ({ [SESSION_HEADER]: session });

  async function loadDetail() {
    const d = await api<Detail>(`/supervisor-tasks/${token}/detail`, { headers: headers() });
    setDetail(d);
    const s = d.supervisor || {};
    setForm({
      name: s.name || '',
      designation: s.designation || '',
      department: s.department || '',
      instituteName: s.instituteName || '',
      address: s.address || '',
      salaryCode: s.salaryCode || '',
      mobile: s.mobile || '',
      email: s.email || '',
      holderName: s.name || '',
      bankName: '',
      branch: '',
      ifsc: '',
      accountType: '',
      account: '',
    });
  }

  useEffect(() => {
    api<Peek>(`/supervisor-tasks/${token}`)
      .then((p) => {
        setPeek(p);
        if (p.passcodeRequested) setHint(`A passcode was sent to ${p.email}.`);
      })
      .catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => {
    if (!session || !peek || peek.responded === 'WITHDRAWN') return;
    loadDetail().catch(() => {
      sessionStorage.removeItem(storeKey);
      setSession('');
    });
  }, [session, peek]);

  async function sendOtp() {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/supervisor-tasks/${token}/otp`, { method: 'POST' });
      setHint(r.message);
      setPeek((p) => (p ? { ...p, passcodeRequested: true } : p));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ session: string }>(`/supervisor-tasks/${token}/verify`, { method: 'POST', body: JSON.stringify({ otp: otp.trim() }) });
      sessionStorage.setItem(storeKey, r.session);
      setSession(r.session);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitAccept(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!declare.noRelative || !declare.available) return setError('Please tick both declarations to accept the duty.');
    if (!cheque) return setError('Please upload cancelled cheque in JPEG, JPG, PNG or PDF file.');
    setBusy(true);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(form)) fd.append(k, v);
      fd.append('noRelative', 'true');
      fd.append('available', 'true');
      fd.append('cheque', cheque);
      const r = await api<{ message: string }>(`/supervisor-tasks/${token}/accept`, { method: 'POST', body: fd, headers: headers() });
      setDone(r.message);
      await loadDetail();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitReject(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) return setError('Please Enter Reason');
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/supervisor-tasks/${token}/regret`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
        headers: headers(),
      });
      setDone(r.message);
      await loadDetail();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const info = detail || peek;
  const answered = detail?.responded || peek?.responded;

  return (
    <div className="guide-shell">
      <BrandBar
        logoUrl={info?.institute?.logoUrl}
        title={info?.institute?.name || PRODUCT_NAME}
        right={
          peek ? (
            <div>
              <div>{peek.name}</div>
              <div>{peek.email}</div>
            </div>
          ) : null
        }
      />
      <div className="practical-task">
        <div className="guide-card">
          <div className="guide-kicker">Examination Section · Supervisory Duty</div>
          <h1 className="practical-task-title">Acceptance for Supervisor</h1>
          {info ? (
            <>
              <p>
                Professional Theory Examination for PG / UG students, <b>{info.session}</b>.
              </p>
              <div className="table-scroll">
                <table className="table practical-table">
                  <thead>
                    <tr>
                      <th>Sr.No.</th>
                      <th>Name of Examination</th>
                      <th>Date</th>
                      <th>Reporting Time</th>
                      <th>Shift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.duties.map((d, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{d.examName}</td>
                        <td className="nowrap">{d.date}</td>
                        <td>{d.reportingTime}</td>
                        <td>{d.shift}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          <ErrorBox error={error} />
          {done ? <div className="okbox">{done}</div> : null}
          {!peek && !error ? <p>Loading…</p> : null}

          {answered === 'WITHDRAWN' ? (
            <div className="practical-task-note">This offer is no longer open. Please contact the Examination Section if you think this is a mistake.</div>
          ) : null}

          {peek && answered !== 'WITHDRAWN' && !detail ? (
            <form className="practical-task-otp" onSubmit={verify}>
              <p>
                {answered
                  ? 'You have already answered. Verify your email to see your letter.'
                  : 'To protect your bank details, we email a 6-digit passcode before you respond.'}{' '}
                It goes to <b>{peek.email}</b>.
              </p>
              {hint ? <div className="okbox">{hint}</div> : null}
              <div className="row">
                <button type="button" className={`btn${peek.passcodeRequested ? ' secondary' : ''}`} disabled={busy} onClick={sendOtp}>
                  {peek.passcodeRequested ? 'Resend passcode' : 'Send passcode'}
                </button>
              </div>
              {peek.passcodeRequested ? (
                <div className="row" style={{ marginTop: 12 }}>
                  <input
                    className="input practical-task-code"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Enter Pass Code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  />
                  <button type="submit" className="btn" disabled={busy || otp.length !== 6}>
                    Verify
                  </button>
                </div>
              ) : null}
            </form>
          ) : null}

          {detail?.letter ? (
            <div className="letter-print-area" style={{ marginTop: 12 }}>
              <div className="row no-print">
                <button type="button" className="btn small" onClick={() => window.print()}>
                  Print
                </button>
              </div>
              <article className="letter-print-sheet" dangerouslySetInnerHTML={{ __html: withLetterheadLogo(detail.letter.body) }} />
            </div>
          ) : null}

          {detail && !detail.responded ? (
            <>
              <div className="practical-task-choice">
                <label>
                  <input type="radio" name="choice" checked={choice === 'accept'} onChange={() => setChoice('accept')} /> <b>Accept</b>
                </label>
                <label>
                  <input type="radio" name="choice" checked={choice === 'reject'} onChange={() => setChoice('reject')} /> <b>Reject</b>
                </label>
              </div>

              {choice === 'accept' ? (
                <form onSubmit={submitAccept}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <input type="checkbox" checked={declare.noRelative} onChange={(e) => setDeclare((d) => ({ ...d, noRelative: e.target.checked }))} />
                    <span>I certify that none of my close relations or dependents are appearing in the examination being conducted on above date.</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 6 }}>
                    <input type="checkbox" checked={declare.available} onChange={(e) => setDeclare((d) => ({ ...d, available: e.target.checked }))} />
                    <span>I SHALL BE AVAILABLE for the duty assigned to me.</span>
                  </label>
                  <p className="practical-muted">If there is any change in your name, address, mobile number and Email id please edit and submit.</p>
                  <div className="grid cols-2">
                    <Field label="Name" required>
                      <input className="input" value={form.name} onChange={set('name')} />
                    </Field>
                    <Field label="Designation" required>
                      <input className="input" list="sv-designations" value={form.designation} onChange={set('designation')} />
                    </Field>
                    <Field label="Department" required>
                      <input className="input" list="sv-departments" value={form.department} onChange={set('department')} />
                    </Field>
                    <Field label="Institute Name" required>
                      <input className="input" value={form.instituteName} onChange={set('instituteName')} />
                    </Field>
                    <Field label="Institute Address" required>
                      <input className="input" value={form.address} onChange={set('address')} />
                    </Field>
                    <Field label="Salary Code / Employee Code" required>
                      <input className="input" value={form.salaryCode} onChange={set('salaryCode')} />
                    </Field>
                    <Field label="Mobile No. (for SMS)" required>
                      <input className="input" maxLength={10} inputMode="numeric" value={form.mobile} onChange={set('mobile')} />
                    </Field>
                    <Field label="Email" required>
                      <input className="input" type="email" value={form.email} onChange={set('email')} />
                    </Field>
                  </div>
                  <datalist id="sv-designations">
                    {detail.designations.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                  <datalist id="sv-departments">
                    {detail.departments.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                  <h3 className="practical-subhead">Bank Details for Remuneration</h3>
                  <div className="grid cols-2">
                    <Field label="Name of Examiner (as provided in Bank)" required>
                      <input className="input" value={form.holderName} onChange={set('holderName')} />
                    </Field>
                    <Field label="Bank Name" required>
                      <input className="input" value={form.bankName} onChange={set('bankName')} />
                    </Field>
                    <Field label="Branch Name with Bank Address" required>
                      <input className="input" value={form.branch} onChange={set('branch')} />
                    </Field>
                    <Field label="IFSC Code" required>
                      <input className="input" maxLength={11} value={form.ifsc} onChange={(e) => setForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase() }))} />
                    </Field>
                    <Field label="Account Type" required>
                      <select className="input" value={form.accountType} onChange={set('accountType')}>
                        <option value="">Select</option>
                        <option>Saving</option>
                        <option>Current</option>
                      </select>
                    </Field>
                    <Field label="Account Number" required>
                      <input
                        className="input"
                        inputMode="numeric"
                        value={form.account}
                        onChange={(e) => setForm((f) => ({ ...f, account: e.target.value.replace(/\D/g, '') }))}
                      />
                    </Field>
                    <Field label="Upload cancelled cheque (JPG, PNG or PDF, max 10 MB)" required>
                      <input className="input" type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setCheque(e.target.files?.[0] || null)} />
                    </Field>
                  </div>
                  <p className="practical-muted">
                    Bank Name, Bank Address, Account Number, IFSC Code and Holder Name should be clear in the cancelled cheque. Please check before
                    submitting.
                  </p>
                  <div className="practical-actions-right">
                    <button type="submit" className="btn" disabled={busy}>
                      {busy ? 'Submitting…' : 'Submit'}
                    </button>
                  </div>
                </form>
              ) : null}

              {choice === 'reject' ? (
                <form onSubmit={submitReject}>
                  <Field label="Reason for reject" required>
                    <textarea className="input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </Field>
                  <div className="practical-actions-right">
                    <button type="submit" className="btn danger" disabled={busy}>
                      {busy ? 'Submitting…' : 'Submit'}
                    </button>
                  </div>
                </form>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PRODUCT_NAME } from '@ethesis/shared';
import { api } from '../api';
import { BrandBar } from '../components/BrandBar';
import { ErrorBox, Field } from '../components/ui';

/**
 * Practical examiner offer link (old AppoinmentAcceptance page): verify an email passcode, then
 * accept with personal + bank details, or regret with a reason.
 */
type Peek = {
  purpose: string;
  name: string;
  email: string;
  passcodeRequested: boolean;
  responded: 'ACCEPTED' | 'REGRETTED' | 'WITHDRAWN' | null;
  examinerCode?: string;
  institute: { name: string; logoUrl?: string } | null;
  course: string;
  speciality: string;
  session: string;
  examinerType: string;
  tentativeSchedule: string;
  examName: string;
};

type Detail = Peek & {
  examiner: Record<string, any>;
  designations: string[];
  departments: string[];
};

const ACCOUNT_TYPES = ['Savings', 'Current'];

export function PracticalTaskPage() {
  const { token = '' } = useParams();
  const storeKey = `practical-session:${token}`;
  const [peek, setPeek] = useState<Peek | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [session, setSession] = useState<string>(() => sessionStorage.getItem(storeKey) || '');
  const [otp, setOtp] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<'accept' | 'regret' | ''>('');
  const [form, setForm] = useState<Record<string, string>>({});
  const [cheque, setCheque] = useState<File | null>(null);
  const [regretType, setRegretType] = useState<'PRIOR_COMMITMENT' | 'OTHER'>('PRIOR_COMMITMENT');
  const [regretReason, setRegretReason] = useState('');
  const [done, setDone] = useState<{ kind: 'accepted' | 'regretted'; code?: string } | null>(null);

  const headers = () => ({ 'x-practical-session': session });

  useEffect(() => {
    api<Peek>(`/practical-tasks/${token}`)
      .then((p) => {
        setPeek(p);
        if (p.passcodeRequested) setHint(`A passcode was sent to ${p.email}.`);
      })
      .catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => {
    if (!session || !peek || peek.responded) return;
    api<Detail>(`/practical-tasks/${token}/detail`, { headers: headers() })
      .then((d) => {
        setDetail(d);
        const e = d.examiner || {};
        const b = e.bank || {};
        setForm({
          name: e.name || '',
          designation: e.designation || '',
          department: e.department || '',
          instituteName: e.instituteName || '',
          instituteAddress: e.instituteAddress || '',
          city: e.city || '',
          salaryCode: e.salaryCode || '',
          mobile: e.mobile || '',
          email: e.email || '',
          alternateMobile: e.alternateMobile || '',
          alternateEmail: e.alternateEmail || '',
          holderName: b.holderName || e.name || '',
          bankName: b.bankName || '',
          branch: b.branch || '',
          ifsc: b.ifsc || '',
          accountType: b.accountType || '',
          account: b.account || '',
          pan: b.pan || '',
        });
      })
      .catch(() => {
        sessionStorage.removeItem(storeKey);
        setSession('');
      });
  }, [session, peek]);

  async function sendOtp() {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/practical-tasks/${token}/otp`, { method: 'POST' });
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
      const r = await api<{ session: string }>(`/practical-tasks/${token}/verify`, {
        method: 'POST',
        body: JSON.stringify({ otp: otp.trim() }),
      });
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
    if (!cheque && !detail?.examiner?.bank?.hasCheque) {
      setError('Upload a scan of a cancelled cheque');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(form)) fd.append(k, v);
      if (cheque) fd.append('cheque', cheque);
      const r = await api<{ examinerCode: string }>(`/practical-tasks/${token}/accept`, { method: 'POST', body: fd, headers: headers() });
      setDone({ kind: 'accepted', code: r.examinerCode });
      sessionStorage.removeItem(storeKey);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitRegret(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(`/practical-tasks/${token}/regret`, {
        method: 'POST',
        body: JSON.stringify({ reasonType: regretType, reason: regretReason }),
        headers: headers(),
      });
      setDone({ kind: 'regretted' });
      sessionStorage.removeItem(storeKey);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const info = detail || peek;
  const finalState = done?.kind === 'accepted' ? 'ACCEPTED' : done?.kind === 'regretted' ? 'REGRETTED' : peek?.responded;

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
          <div className="guide-kicker">Examination Section · Offer of Examinership</div>
          <h1 className="practical-task-title">Acceptance / Refusal for Conduct of Examination</h1>
          {info ? (
            <dl className="practical-task-facts">
              <div>
                <dt>Examiner</dt>
                <dd>
                  {info.name} — {info.examinerType}
                </dd>
              </div>
              <div>
                <dt>Course / Speciality</dt>
                <dd>
                  {info.course} in {info.speciality}
                </dd>
              </div>
              <div>
                <dt>Examination</dt>
                <dd>
                  {info.session}
                  {info.examName ? ` · ${info.examName}` : ''}
                </dd>
              </div>
              {info.tentativeSchedule ? (
                <div>
                  <dt>Tentative schedule</dt>
                  <dd>{info.tentativeSchedule}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <ErrorBox error={error} />

          {!peek && !error ? <p>Loading…</p> : null}

          {peek && finalState ? (
            <div className={finalState === 'ACCEPTED' ? 'okbox' : 'practical-task-note'}>
              {finalState === 'ACCEPTED' ? (
                <>
                  Thank you for accepting the offer. Your examiner code is <b>{done?.code || peek.examinerCode}</b>. A formal appointment letter with
                  the examiner portal link will be emailed to you.
                </>
              ) : finalState === 'REGRETTED' ? (
                'You have declined this offer. Thank you for letting us know.'
              ) : (
                'This offer is no longer open. Please contact the Examination Section if you think this is a mistake.'
              )}
            </div>
          ) : null}

          {peek && !finalState && !detail ? (
            <form className="practical-task-otp" onSubmit={verify}>
              <p>
                To protect your bank details, we email a 6-digit passcode to <b>{peek.email}</b> before you respond.
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

          {detail && !finalState ? (
            <>
              <div className="practical-task-choice">
                <label>
                  <input type="radio" name="choice" checked={choice === 'accept'} onChange={() => setChoice('accept')} /> I <b>accept</b> the
                  examinership
                </label>
                <label>
                  <input type="radio" name="choice" checked={choice === 'regret'} onChange={() => setChoice('regret')} /> I <b>regret</b> (cannot
                  accept)
                </label>
              </div>

              {choice === 'accept' ? (
                <form onSubmit={submitAccept}>
                  <h3 className="practical-subhead">Your details</h3>
                  <div className="grid cols-2">
                    <Field label="Name" required>
                      <input className="input" value={form.name} onChange={set('name')} />
                    </Field>
                    <Field label="Designation" required>
                      <input className="input" list="pt-designations" value={form.designation} onChange={set('designation')} />
                    </Field>
                    <Field label="Department" required>
                      <input className="input" list="pt-departments" value={form.department} onChange={set('department')} />
                    </Field>
                    <Field label="Institute Name" required>
                      <input className="input" value={form.instituteName} onChange={set('instituteName')} />
                    </Field>
                    <Field label="Institute Address" required>
                      <input className="input" value={form.instituteAddress} onChange={set('instituteAddress')} />
                    </Field>
                    <Field label="City">
                      <input className="input" value={form.city} onChange={set('city')} />
                    </Field>
                    <Field label="Salary Code">
                      <input className="input" value={form.salaryCode} onChange={set('salaryCode')} />
                    </Field>
                    <Field label="Mobile No. (for SMS)" required>
                      <input className="input" maxLength={10} inputMode="numeric" value={form.mobile} onChange={set('mobile')} />
                    </Field>
                    <Field label="Email" required>
                      <input className="input" type="email" value={form.email} onChange={set('email')} />
                    </Field>
                    <Field label="Alternate Mobile">
                      <input className="input" maxLength={10} inputMode="numeric" value={form.alternateMobile} onChange={set('alternateMobile')} />
                    </Field>
                    <Field label="Alternate Email ID">
                      <input className="input" type="email" value={form.alternateEmail} onChange={set('alternateEmail')} />
                    </Field>
                  </div>
                  <datalist id="pt-designations">
                    {detail.designations.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                  <datalist id="pt-departments">
                    {detail.departments.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                  <h3 className="practical-subhead">Bank details (for remuneration)</h3>
                  <div className="grid cols-2">
                    <Field label="Account Holder Name" required>
                      <input className="input" value={form.holderName} onChange={set('holderName')} />
                    </Field>
                    <Field label="Bank Name" required>
                      <input className="input" value={form.bankName} onChange={set('bankName')} />
                    </Field>
                    <Field label="Branch Address" required>
                      <input className="input" value={form.branch} onChange={set('branch')} />
                    </Field>
                    <Field label="IFSC Code" required>
                      <input className="input" maxLength={11} value={form.ifsc} onChange={(e) => setForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase() }))} />
                    </Field>
                    <Field label="Account Type" required>
                      <select className="input" value={form.accountType} onChange={set('accountType')}>
                        <option value="">-- Select --</option>
                        {ACCOUNT_TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Account Number" required>
                      <input className="input" inputMode="numeric" value={form.account} onChange={set('account')} />
                    </Field>
                    <Field label="PAN" required>
                      <input className="input" maxLength={10} value={form.pan} onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase() }))} />
                    </Field>
                    <Field label="Cancelled cheque (JPG, PNG or PDF, max 5 MB)" required={!detail.examiner?.bank?.hasCheque}>
                      <input className="input" type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setCheque(e.target.files?.[0] || null)} />
                    </Field>
                  </div>
                  <div className="practical-actions-right">
                    <button type="submit" className="btn" disabled={busy}>
                      {busy ? 'Submitting…' : 'Submit acceptance'}
                    </button>
                  </div>
                </form>
              ) : null}

              {choice === 'regret' ? (
                <form onSubmit={submitRegret}>
                  <h3 className="practical-subhead">Reason for refusal</h3>
                  <div className="practical-task-choice">
                    <label>
                      <input type="radio" name="why" checked={regretType === 'PRIOR_COMMITMENT'} onChange={() => setRegretType('PRIOR_COMMITMENT')} /> Due to
                      prior commitment
                    </label>
                    <label>
                      <input type="radio" name="why" checked={regretType === 'OTHER'} onChange={() => setRegretType('OTHER')} /> Other reason
                    </label>
                  </div>
                  <Field label="Reason" required={regretType === 'OTHER'}>
                    <textarea className="input" rows={3} value={regretReason} onChange={(e) => setRegretReason(e.target.value)} />
                  </Field>
                  <div className="practical-actions-right">
                    <button type="submit" className="btn danger" disabled={busy}>
                      {busy ? 'Submitting…' : 'Submit regret'}
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

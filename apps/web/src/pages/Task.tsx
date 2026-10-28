import { FormEvent, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ApiError, get, patch, post, postWithProgress, type UploadProgress } from '../api';
import { progressLabel, thesisFileProblem, uploadFailureMessage } from '../upload';
import { reportClientError } from '../errorReporter';
import { formatBytes, shrinkImage } from '../imageShrink';
import { ConfirmDialog, ErrorBox, Field, PageLoader, Pill } from '../components/ui';
import { emptyEvaluation, evaluationError, EvaluationForm, evaluationVerdictLabel, thesisByVersion, toEvaluationValue, type EvaluationValue } from '../components/EvaluationForm';
import { ExaminerPicker, emptyExaminerDraft, validateExaminerDraft } from '../components/ExaminerPicker';
import { ProtectedPdfViewer } from '../components/ProtectedPdfViewer';
import { BrandBar } from '../components/BrandBar';
import { PRODUCT_NAME, isValidEmail, isValidMobile, cleanMobile, normalizeIndianMobile } from '@ethesis/shared';

const CHEQUE_MAX_BYTES = 10 * 1024 * 1024;
const CHEQUE_TYPES = /^(image\/(jpeg|jpg|png)|application\/pdf)$/i;
const CHEQUE_EXT = /\.(jpe?g|png|pdf)$/i;

/** A stored number like "+91 98765 43210" becomes "9876543210"; anything else is shown as it was saved. */
function prefillMobile(value?: string) {
  const n = normalizeIndianMobile(value || '');
  return isValidMobile(n) ? n : value || '';
}

/** Digits only, at most 12 so a pasted +91 number fits, then +91 / 0 dropped. */
function typedMobile(value: string) {
  return normalizeIndianMobile(value.replace(/\D/g, '').slice(0, 12));
}

/** What went wrong on the cheque the examiner picked, or null if it is fine. */
function chequeProblem(file: File): string | null {
  if (!file.size) return 'This file could not be read. Please choose the file again.';
  const typeOk = CHEQUE_TYPES.test(file.type || '') || CHEQUE_EXT.test(file.name || '');
  if (!typeOk) {
    const kind = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || file.type.split('/')[1] || 'this').toUpperCase();
    return `This file is a ${kind} file. Please upload the cancelled cheque as a JPG, PNG or PDF.`;
  }
  if (file.size > CHEQUE_MAX_BYTES) {
    return `This file is ${formatBytes(file.size)}. The cancelled cheque must be 10 MB or smaller. Please crop the photo or upload a smaller file.`;
  }
  return null;
}

/** Message for a failed consent submission; never raw server text for crashes or proxy errors. */
function consentFailure(err: any): string {
  const status = err instanceof ApiError ? err.status : -1;
  const ref = err instanceof ApiError && err.ref ? ` Reference: ${err.ref}` : '';
  if (status === 0) return 'Could not reach the server. Check your internet connection and try again.';
  if (status === 413) return 'The file you uploaded is too large. The cancelled cheque must be 10 MB or smaller.';
  if (status === 401 || status === 404) return 'This link is invalid or has expired.';
  if (status >= 500 && status < 502) return `Something went wrong while saving your details. Please try again.${ref}`;
  if (status >= 502) return `The server is temporarily unavailable. Please try again in a few minutes.${ref}`;
  return err?.message || 'Could not submit. Please try again.';
}

function purposeLabel(purpose?: string) {
  const map: Record<string, string> = {
    PANEL_BUILD: 'Build examiner panel',
    CONSENT: 'Examiner consent',
    EVALUATE: 'Evaluation',
    VIVA_DATE: 'Fix viva date',
    REVISION: 'Upload revised thesis',
  };
  return map[purpose || ''] || (purpose || '').replaceAll('_', ' ');
}

function consentDecided(status?: string) {
  return status === 'ACCEPTED' || status === 'REGRETTED';
}

export function TaskPage() {
  const { token } = useParams();
  const nav = useNavigate();
  const [peek, setPeek] = useState<any>(null);
  const [otp, setOtp] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'work' | 'thesis' | 'log'>('work');
  const [evalForm, setEval] = useState<EvaluationValue>(emptyEvaluation());
  const [logIndex, setLogIndex] = useState(0);
  const [confirmEval, setConfirmEval] = useState(false);
  const [evalLoading, setEvalLoading] = useState(false);
  const evalLock = useRef(false);
  const [member, setMember] = useState(emptyExaminerDraft());
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState(emptyExaminerDraft());
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ email: string; message?: string; fields?: Record<string, string> } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<any | null>(null);
  const [knownExaminers, setKnownExaminers] = useState<any[]>([]);
  const [consent, setConsent] = useState<{
    accept: boolean | null;
    name: string;
    designation: string;
    department: string;
    institute: string;
    address: string;
    mobile: string;
    alternateMobile: string;
    email: string;
    alternateEmail: string;
    holderName: string;
    bankName: string;
    branchAddress: string;
    ifsc: string;
    accountType: string;
    account: string;
    pan: string;
    refusalReason: string;
    refusalText: string;
  }>({
    accept: null,
    name: '',
    designation: '',
    department: '',
    institute: '',
    address: '',
    mobile: '',
    alternateMobile: '',
    email: '',
    alternateEmail: '',
    holderName: '',
    bankName: '',
    branchAddress: '',
    ifsc: '',
    accountType: 'Saving',
    account: '',
    pan: '',
    refusalReason: 'PRIOR_COMMITMENTS',
    refusalText: '',
  });
  const [cheque, setCheque] = useState<File | null>(null);
  const [chequeNote, setChequeNote] = useState('');
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentProgress, setConsentProgress] = useState<number | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const consentErrorRef = useRef<HTMLDivElement | null>(null);
  const [vivaDate, setVivaDate] = useState('');
  const [vivaTime, setVivaTime] = useState('');
  const [vivaVenue, setVivaVenue] = useState('');
  const [revFile, setRevFile] = useState<File | null>(null);
  const [revUpload, setRevUpload] = useState<UploadProgress | null>(null);
  const [revError, setRevError] = useState<string | null>(null);
  const [done, setDone] = useState('');
  const [otpHint, setOtpHint] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [passcodeRequested, setPasscodeRequested] = useState(false);

  useEffect(() => {
    setPeek(null);
    setDetail(null);
    setError(null);
    setDone('');
    setTab('work');
    setOtp('');
    setOtpHint('');
    setMember(emptyExaminerDraft());
    setKnownExaminers([]);
    get(`/tasks/${token}`)
      .then(async (p) => {
        setPeek(p);
        setPasscodeRequested(Boolean(p.passcodeRequested));
        const isExaminer = Boolean(p.isExaminer ?? (p.purpose === 'CONSENT' || (p.purpose === 'EVALUATE' && !p.asChiefGuide)));
        if (p.verified || isExaminer) {
          try {
            setDetail(await get(`/tasks/${token}/detail`));
          } catch {
            /* passcode must be entered again */
          }
        }
      })
      .catch((e) => setError(e.message));
  }, [token]);

  async function requestPasscode() {
    try {
      setOtpBusy(true);
      setError(null);
      const r: any = await post(`/tasks/${token}/otp`, {});
      setPasscodeRequested(true);
      setOtpHint(r.hint || 'A passcode was sent to your email.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setOtpBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    try {
      setDetail(await post(`/tasks/${token}/verify`, { otp }));
      setError(null);
      setTab(peek?.purpose === 'EVALUATE' ? 'thesis' : 'work');
    } catch (err: any) {
      setError(err.message);
    }
  }

  /** Show a consent problem under its field (or above Submit) and bring it into view. */
  function showConsentProblem(message: string, field?: string) {
    if (field) {
      setFieldErrors({ [field]: message });
      setConsentError(null);
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-consent-field="${field}"]`);
        (el?.closest<HTMLElement>('.field') || el)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.focus({ preventScroll: true });
      });
    } else {
      setFieldErrors({});
      setConsentError(message);
      requestAnimationFrame(() => consentErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  }

  function clearFieldError(field: string) {
    if (fieldErrors[field]) setFieldErrors(({ [field]: _gone, ...rest }) => rest);
  }

  async function pickCheque(file: File | null) {
    setChequeNote('');
    clearFieldError('cheque');
    if (!file) {
      setCheque(null);
      return;
    }
    // Large photos are shrunk first, so a 14 MB camera photo still fits the 10 MB limit.
    const ready = await shrinkImage(file);
    const problem = chequeProblem(ready);
    if (problem) {
      setCheque(null);
      reportClientError({ kind: 'form', message: `Cheque rejected before upload: ${problem} (${file.type || 'unknown type'}, ${formatBytes(file.size)})` });
      showConsentProblem(problem, 'cheque');
      return;
    }
    setCheque(ready);
    if (ready !== file) setChequeNote(`Photo optimised for upload: ${formatBytes(file.size)} → ${formatBytes(ready.size)}.`);
  }

  useEffect(() => {
    if (detail?.purpose === 'EVALUATE' && tab === 'work') setTab('thesis');
  }, [detail, tab]);

  useEffect(() => {
    if (detail?.purpose !== 'EVALUATE') return;
    const blockKeys = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!(e.ctrlKey || e.metaKey)) return;
      if (key === 'p' || key === 's') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const blockClipboard = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('textarea, input, [contenteditable="true"]')) return;
      e.preventDefault();
    };
    window.addEventListener('keydown', blockKeys, true);
    window.addEventListener('copy', blockClipboard, true);
    window.addEventListener('cut', blockClipboard, true);
    window.addEventListener('paste', blockClipboard, true);
    return () => {
      window.removeEventListener('keydown', blockKeys, true);
      window.removeEventListener('copy', blockClipboard, true);
      window.removeEventListener('cut', blockClipboard, true);
      window.removeEventListener('paste', blockClipboard, true);
    };
  }, [detail?.purpose]);

  useEffect(() => {
    if (!detail || detail.purpose !== 'CONSENT') return;
    const p = detail.file?.panel?.[detail.panelIndex ?? 0] || {};
    setConsent((c) => ({
      ...c,
      name: p.name || detail.name || '',
      designation: p.designation || '',
      department: p.department || '',
      institute: p.affiliation || '',
      address: p.address || [p.city, p.country].filter(Boolean).join(', '),
      mobile: prefillMobile(p.mobile),
      alternateMobile: prefillMobile(p.alternateMobile),
      email: p.email || detail.email || '',
      alternateEmail: p.alternateEmail || '',
      holderName: p.bank?.holderName || p.name || detail.name || '',
      bankName: p.bank?.bankName || '',
      branchAddress: p.bank?.branchAddress || '',
      ifsc: p.bank?.ifsc || '',
      accountType: p.bank?.accountType || 'Saving',
      account: p.bank?.account || '',
      pan: p.bank?.pan || '',
    }));
  }, [detail]);

  useEffect(() => {
    if (detail?.purpose !== 'PANEL_BUILD') return;
    if (Array.isArray(detail.knownExaminers)) {
      setKnownExaminers(detail.knownExaminers);
      return;
    }
    if (!token) return;
    get(`/tasks/${token}/examiners`)
      .then((rows) => setKnownExaminers(Array.isArray(rows) ? rows : []))
      .catch((e) => setError(e.message || 'Could not load saved examiners.'));
  }, [token, detail]);

  async function refreshDetail() {
    setDetail(await get(`/tasks/${token}/detail`));
  }

  /** Which form field a validateExaminerDraft message belongs to. */
  function draftField(message: string) {
    if (/name/i.test(message)) return 'name';
    if (/email/i.test(message)) return 'email';
    if (/mobile/i.test(message)) return 'mobile';
    return 'bucketCode';
  }

  /** Show why an edit/remove failed on that examiner's row; refresh when the panel changed underneath. */
  function panelFailure(email: string, err: any) {
    const status = err instanceof ApiError ? err.status : -1;
    const ref = err instanceof ApiError && err.ref ? ` Reference: ${err.ref}` : '';
    if (status === 400 && err.field) {
      setRowError({ email, fields: { [err.field]: err.message } });
      return;
    }
    if (status === 400 && /already been submitted/i.test(err.message || '')) {
      nav(`/task/${token}/submitted`, { replace: true });
      return;
    }
    if (status === 404) {
      setEditingEmail(null);
      setRowError({ email, message: 'This examiner is no longer on the panel. The list has been refreshed.' });
      refreshDetail().catch(() => undefined);
      return;
    }
    if (status === 409) {
      setEditingEmail(null);
      setRowError({ email, message: err.message });
      refreshDetail().catch(() => undefined);
      return;
    }
    if (status === 0) {
      setRowError({ email, message: 'Could not reach the server. Check your internet connection and try again.' });
      return;
    }
    if (status >= 500) {
      setRowError({ email, message: `Something went wrong. Please try again.${ref}` });
      return;
    }
    setRowError({ email, message: err?.message || 'Could not save. Please try again.' });
  }

  function startEdit(p: any) {
    setRowError(null);
    setEditingEmail(p.email);
    setEditDraft({
      ...emptyExaminerDraft(),
      name: p.name || '',
      email: p.email || '',
      bucketCode: p.bucketCode || '',
      affiliation: p.affiliation || '',
      mobile: p.mobile || '',
      designation: p.designation || '',
      department: p.department || '',
      address: p.address || '',
      city: p.city || '',
      country: p.country || '',
    });
  }

  async function saveEdit(p: any) {
    if (rowBusy) return;
    const problem = validateExaminerDraft(editDraft);
    if (problem) {
      setRowError({ email: p.email, fields: { [draftField(problem)]: problem } });
      return;
    }
    setRowError(null);
    setRowBusy(p.email);
    try {
      const next = await patch(`/tasks/${token}/panel/members/${encodeURIComponent(p.email)}`, editDraft);
      setEditingEmail(null);
      if (next?.file) setDetail(next);
      else await refreshDetail();
    } catch (err) {
      panelFailure(p.email, err);
    } finally {
      setRowBusy(null);
    }
  }

  async function removeExaminer(p: any) {
    setConfirmRemove(null);
    if (rowBusy) return;
    setRowError(null);
    setRowBusy(p.email);
    try {
      const next = await post(`/tasks/${token}/panel/members/${encodeURIComponent(p.email)}/remove`, {});
      if (editingEmail === p.email) setEditingEmail(null);
      if (next?.file) setDetail(next);
      else await refreshDetail();
    } catch (err) {
      panelFailure(p.email, err);
    } finally {
      setRowBusy(null);
    }
  }

  if (!peek) {
    return (
      <div className="guide-shell">
        <div className="guide-card">Loading secure link…</div>
      </div>
    );
  }

  if (peek.purpose === 'CONSENT' && consentDecided(peek.consentStatus)) {
    return <Navigate to={`/task/${token}/submitted`} replace />;
  }
  if (peek.purpose === 'EVALUATE' && peek.evaluationSubmitted) {
    return <Navigate to={`/task/${token}/submitted`} replace />;
  }
  if (peek.purpose === 'PANEL_BUILD' && peek.panelSubmitted) {
    return <Navigate to={`/task/${token}/submitted`} replace />;
  }
  const memberConsent =
    detail?.purpose === 'CONSENT' ? detail.file?.panel?.[detail.panelIndex ?? 0]?.consentStatus : undefined;
  if (consentDecided(memberConsent)) {
    return <Navigate to={`/task/${token}/submitted`} replace />;
  }
  const memberEval =
    detail?.purpose === 'EVALUATE'
      ? Number.isInteger(detail.panelIndex)
        ? detail.file?.panel?.[detail.panelIndex]?.evaluation
        : detail.file?.panel?.find((p: any) => p.isChiefGuide)?.evaluation
      : undefined;
  if (memberEval?.verdict) {
    return <Navigate to={`/task/${token}/submitted`} replace />;
  }

  const buckets: any[] = detail?.panelRule?.buckets || [];
  const evaluationHistory: any[] = detail?.purpose === 'EVALUATE' ? detail.evaluationHistory || [] : [];
  const panel: any[] = detail?.file?.panel || [];
  const canEditPanel = ['panel_build', 'additional_panel'].includes(String(detail?.file?.currentStageCode || ''));
  if (detail?.purpose === 'PANEL_BUILD' && !canEditPanel) {
    return <Navigate to={`/task/${token}/submitted`} replace />;
  }

  function bucketFill(code: string) {
    const rule = buckets.find((b) => b.code === code);
    const have = panel.filter((p) => p.bucketCode === code && !p.extra).length;
    return { have, need: rule?.count || 0, label: rule?.label || code };
  }

  return (
    <div className="guide-shell">
      <BrandBar
        logoUrl={peek.institute?.logoUrl || detail?.institute?.logoUrl}
        title={peek.institute?.name || detail?.institute?.name || PRODUCT_NAME}
        right={
          <div>
            <div>{peek.name || 'Chief Guide'}</div>
            <div>{peek.email}</div>
          </div>
        }
      />
      <header className="guide-top">
        <div>
          <div className="guide-kicker">
            {PRODUCT_NAME} · {peek.purpose === 'CONSENT' || peek.purpose === 'EVALUATE' ? 'Examiner' : 'Chief Guide'}
          </div>
          <strong>{peek.name || 'Chief Guide'}</strong>
          <div className="guide-top-sub">{peek.email}</div>
        </div>
        <div className="guide-top-right">
          <Pill status={detail ? 'ACTIVE' : 'PENDING'} />
        </div>
      </header>

      {!detail ? (
        (peek.isExaminer ?? (peek.purpose === 'CONSENT' || (peek.purpose === 'EVALUATE' && !peek.asChiefGuide))) && !error ? (
          <div className="guide-shell">
            <div className="guide-card">Loading task…</div>
          </div>
        ) : (
          <div className="guide-auth">
            <div className="guide-card guide-auth-card">
              <div className="guide-kicker">Secure task</div>
              <h1>{purposeLabel(peek.purpose)}</h1>
              <p className="guide-lead">
                {peek.candidate?.name} · {peek.title}
              </p>
              <ErrorBox error={error} />
              {otpHint && <div className="okbox">{otpHint}</div>}
              {!passcodeRequested ? (
                <div className="grid">
                  <button className="btn" type="button" disabled={otpBusy} onClick={requestPasscode}>
                    {otpBusy ? 'Sending…' : 'Get passcode'}
                  </button>
                  <p className="guide-hint">A one-time passcode will be emailed to you. Check inbox and spam.</p>
                </div>
              ) : (
                <form onSubmit={verify} className="grid">
                  <Field label="Passcode" required>
                    <input className="input" value={otp} onChange={(e) => setOtp(e.target.value)} autoFocus />
                  </Field>
                  <div className="row">
                    <button className="btn" type="submit">
                      Verify and open
                    </button>
                    <button type="button" className="btn secondary" disabled={otpBusy} onClick={requestPasscode}>
                      {otpBusy ? 'Sending…' : 'Send passcode'}
                    </button>
                  </div>
                  <p className="guide-hint">The passcode is emailed to you separately. Check inbox and spam.</p>
                </form>
              )}
            </div>
          </div>
        )
      ) : (
        <div className="guide-body">
          <aside className="guide-side">
            {detail.purpose === 'EVALUATE' ? (
              <>
                <button className={`guide-tab ${tab === 'thesis' ? 'on' : ''}`} type="button" onClick={() => setTab('thesis')}>
                  Evaluate thesis
                </button>
                {evaluationHistory.length > 0 && (
                  <button className={`guide-tab ${tab === 'log' ? 'on' : ''}`} type="button" onClick={() => setTab('log')}>
                    Previous evaluation log
                    <span className="guide-count">{evaluationHistory.length}</span>
                  </button>
                )}
              </>
            ) : (
              <button className={`guide-tab ${tab === 'work' ? 'on' : ''}`} type="button" onClick={() => setTab('work')}>
                Current task
              </button>
            )}
          </aside>
          <main className="guide-main">
            <ErrorBox error={error} />
            {done && <div className="okbox">{done}</div>}

            {(tab === 'work' || tab === 'thesis' || tab === 'log') && (
              <>
                <div className="guide-hero">
                  <div>
                    <div className="guide-kicker">{purposeLabel(detail.purpose)}</div>
                    <h1>{detail.file?.candidate?.name}</h1>
                    <p className="guide-lead">{detail.file?.title}</p>
                    {detail.purpose === 'PANEL_BUILD' ? (
                      <p className="guide-hint" style={{ marginTop: 8 }}>
                        This mail link is only for this candidate. Other candidates use the separate link sent for that file.
                      </p>
                    ) : null}
                  </div>
                  <div className="guide-hero-meta">
                    <span>Enrollment {detail.file?.candidate?.enrollmentNo || '—'}</span>
                    <span>File {detail.file?.fileNo || '—'}</span>
                    <span>Thesis {detail.file?.thesisNumber || '—'}</span>
                  </div>
                </div>

                {detail.purpose === 'PANEL_BUILD' && (
                  <div className="guide-grid">
                    <div className="guide-card">
                      <h3>Quota</h3>
                      <div className="guide-buckets">
                        {buckets.map((b: any) => {
                          const fill = bucketFill(b.code);
                          const pct = fill.need ? Math.min(100, (fill.have / fill.need) * 100) : 0;
                          return (
                            <div key={b.code} className="guide-bucket">
                              <div className="row" style={{ justifyContent: 'space-between' }}>
                                <b>{b.label}</b>
                                <span>
                                  {fill.have} / {fill.need}
                                </span>
                              </div>
                              <div className="guide-meter">
                                <i style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {canEditPanel ? (
                        <>
                          <h3 style={{ marginTop: 18 }}>Add examiner</h3>
                          <ExaminerPicker
                            examiners={knownExaminers}
                            member={member}
                            buckets={buckets}
                            onChange={setMember}
                          />
                          <div className="row" style={{ marginTop: 14 }}>
                            <button
                              className="btn secondary"
                              type="button"
                              onClick={() => {
                                setError(null);
                                const err = validateExaminerDraft(member);
                                if (err) {
                                  setError(err);
                                  return;
                                }
                                post(`/tasks/${token}/panel/members`, member)
                                  .then((next) => {
                                    setMember({ ...emptyExaminerDraft(), bucketCode: member.bucketCode });
                                    if (next?.file) setDetail(next);
                                    else return refreshDetail();
                                  })
                                  .catch((e) => setError(e.message));
                              }}
                            >
                              Add to panel
                            </button>
                            <button
                              className="btn ghost"
                              type="button"
                              disabled={Object.values(member).every((v) => !String(v || '').trim())}
                              onClick={() => {
                                setError(null);
                                setMember(emptyExaminerDraft());
                              }}
                            >
                              Clear
                            </button>
                            <button
                              className="btn"
                              type="button"
                              onClick={() => {
                                setError(null);
                                post(`/tasks/${token}/panel/submit`, {})
                                  .then(() => {
                                    nav(`/task/${token}/submitted`, { replace: true });
                                  })
                                  .catch((e) => setError(e.message));
                              }}
                            >
                              Submit panel to examination
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="guide-hint" style={{ marginTop: 18 }}>
                          This candidate is not at the panel-build stage. You can view this file’s examiners here; add and submit stay on that candidate’s own panel-build link.
                        </p>
                      )}
                    </div>
                    <div className="guide-card">
                      <h3>Panel so far</h3>
                      {panel.length ? (
                        <ul className="guide-people">
                          {panel.map((p: any, i: number) => {
                            const editing = editingEmail === p.email;
                            const busy = rowBusy === p.email;
                            const err = rowError?.email === p.email ? rowError : null;
                            if (editing) {
                              return (
                                <li key={p.email || i} style={{ display: 'block' }}>
                                  <b>Edit examiner</b>
                                  <ExaminerPicker
                                    examiners={knownExaminers}
                                    member={editDraft}
                                    buckets={buckets}
                                    onChange={(next) => {
                                      setEditDraft(next);
                                      if (err?.fields) setRowError(null);
                                    }}
                                    errors={err?.fields}
                                    hideExisting
                                  />
                                  {err?.message && <ErrorBox error={err.message} />}
                                  <div className="row" style={{ marginTop: 10 }}>
                                    <button className="btn small" type="button" disabled={busy} onClick={() => saveEdit(p)}>
                                      {busy ? 'Saving…' : 'Save changes'}
                                    </button>
                                    <button
                                      className="btn secondary small"
                                      type="button"
                                      disabled={busy}
                                      onClick={() => {
                                        setEditingEmail(null);
                                        setRowError(null);
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </li>
                              );
                            }
                            return (
                            <li key={p.email || i} style={{ flexWrap: 'wrap' }}>
                              <div>
                                <b>{p.name}</b>
                                {(p.designation || p.department) && (
                                  <div className="guide-muted" style={{ fontSize: 13 }}>
                                    {[p.designation, p.department].filter(Boolean).join(', ')}
                                  </div>
                                )}
                                {p.affiliation && <div className="guide-muted" style={{ fontSize: 13 }}>{p.affiliation}</div>}
                                <div className="guide-muted" style={{ fontSize: 12 }}>
                                  {[p.email, p.mobile].filter(Boolean).join(' · ')}
                                </div>
                                {p.address && <div className="guide-muted" style={{ fontSize: 11 }}>{p.address}</div>}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                                <Pill status={p.bucketCode} />
                                {p.lockReason ? (
                                  <span className="guide-muted" style={{ fontSize: 12, maxWidth: 220, textAlign: 'right' }} title={p.lockReason}>
                                    🔒 Locked: {p.lockReason}
                                  </span>
                                ) : (
                                  <div className="row" style={{ gap: 6 }}>
                                    <button className="btn secondary small" type="button" disabled={Boolean(rowBusy)} onClick={() => startEdit(p)}>
                                      Edit
                                    </button>
                                    <button className="btn secondary small" type="button" disabled={Boolean(rowBusy)} onClick={() => setConfirmRemove(p)}>
                                      {busy ? 'Removing…' : 'Remove'}
                                    </button>
                                  </div>
                                )}
                              </div>
                              {err?.message && (
                                <div style={{ flexBasis: '100%' }}>
                                  <ErrorBox error={err.message} />
                                </div>
                              )}
                            </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="guide-muted">No examiners added yet. Fill each bucket, then submit.</p>
                      )}
                      {!!detail.file?.documents?.length && (
                        <div style={{ marginTop: 16 }}>
                          <h3>Thesis document</h3>
                          {detail.file.documents.map((d: any, i: number) => (
                            <a key={i} className="btn secondary small" href={`/api/uploads/${d.path}`} target="_blank" rel="noreferrer" style={{ marginTop: 8 }}>
                              View v{d.version} {d.originalName}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {detail.purpose === 'CONSENT' && (
                  <div className="guide-card">
                    <p className="guide-lead">
                      I acknowledge receipt of the offer of Examinership for evaluation of the thesis{' '}
                      <b>{detail.file?.title}</b> submitted by <b>{detail.file?.candidate?.name}</b>
                      {detail.file?.fileNo ? ` (file ${detail.file.fileNo})` : ''}.
                    </p>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (consentBusy) return;
                        if (consent.accept === null) {
                          showConsentProblem('Please select whether you accept or are unable to accept');
                          return;
                        }
                        setError(null);
                        setConsentError(null);
                        setFieldErrors({});
                        if (consent.accept) {
                          const problem: [string, string] | null = !isValidEmail(consent.email)
                            ? ['email', 'Please enter a valid email address']
                            : consent.alternateEmail && consent.alternateEmail.trim() !== '' && !isValidEmail(consent.alternateEmail)
                            ? ['alternateEmail', 'Please enter a valid alternate email address']
                            : !isValidMobile(cleanMobile(consent.mobile))
                            ? ['mobile', 'Mobile must be a valid 10-digit Indian number starting with 6-9']
                            : consent.alternateMobile && consent.alternateMobile.trim() !== '' && !isValidMobile(cleanMobile(consent.alternateMobile))
                            ? ['alternateMobile', 'Alternate mobile must be a valid 10-digit Indian number starting with 6-9']
                            : consent.pan.replace(/\s+/g, '').length !== 10
                            ? ['pan', 'PAN must be 10 characters']
                            : !cheque
                            ? ['cheque', 'Please upload your cancelled cheque (JPG, PNG or PDF).']
                            : null;
                          if (problem) {
                            showConsentProblem(problem[1], problem[0]);
                            return;
                          }
                        }
                        setConsentBusy(true);
                        try {
                          if (consent.accept && cheque) {
                            const fd = new FormData();
                            fd.append('accept', 'true');
                            (
                              [
                                'name',
                                'designation',
                                'department',
                                'institute',
                                'address',
                                'mobile',
                                'alternateMobile',
                                'email',
                                'alternateEmail',
                                'holderName',
                                'bankName',
                                'branchAddress',
                                'ifsc',
                                'accountType',
                                'account',
                                'pan',
                              ] as const
                            ).forEach((k) => fd.append(k, consent[k]));
                            fd.append('cheque', cheque);
                            setConsentProgress(0);
                            await postWithProgress(`/tasks/${token}/consent`, fd, (p) => setConsentProgress(p.percent));
                            nav(`/task/${token}/submitted`, { replace: true });
                          } else {
                            await post(`/tasks/${token}/consent`, {
                              accept: false,
                              refusalReason: consent.refusalReason,
                              refusalText: consent.refusalText,
                            });
                            nav(`/task/${token}/submitted`, { replace: true });
                          }
                        } catch (err: any) {
                          const field = err instanceof ApiError && err.status === 400 ? err.field : undefined;
                          showConsentProblem(consentFailure(err), field);
                        } finally {
                          setConsentBusy(false);
                          setConsentProgress(null);
                        }
                      }}
                    >
                      <label className="field">
                        <span>
                          <input
                            type="radio"
                            checked={consent.accept === true}
                            onChange={() => {
                              setConsentError(null);
                              setConsent({ ...consent, accept: true });
                            }}
                          />{' '}
                          I ACCEPT this examinership and shall evaluate the thesis within time period
                        </span>
                      </label>
                      <label className="field">
                        <span>
                          <input
                            type="radio"
                            checked={consent.accept === false}
                            onChange={() => {
                              setConsentError(null);
                              setConsent({ ...consent, accept: false });
                            }}
                          />{' '}
                          I AM UNABLE TO ACCEPT
                        </span>
                      </label>

                      {consent.accept === true && (
                        <>
                          <p className="guide-muted" style={{ marginTop: 8 }}>
                            If there is any change in your name, address, mobile number and email, please edit and submit.
                          </p>
                          <div className="grid cols-2" style={{ marginTop: 12 }}>
                            <Field label="Name" required error={fieldErrors.name}>
                              <input className="input" data-consent-field="name" value={consent.name} onChange={(e) => { clearFieldError('name'); setConsent({ ...consent, name: e.target.value }); }} required />
                            </Field>
                            <Field label="Designation" required error={fieldErrors.designation}>
                              <input className="input" data-consent-field="designation" value={consent.designation} onChange={(e) => { clearFieldError('designation'); setConsent({ ...consent, designation: e.target.value }); }} required />
                            </Field>
                            <Field label="Department" required error={fieldErrors.department}>
                              <input className="input" data-consent-field="department" value={consent.department} onChange={(e) => { clearFieldError('department'); setConsent({ ...consent, department: e.target.value }); }} required />
                            </Field>
                            <Field label="Institute" required error={fieldErrors.institute}>
                              <input className="input" data-consent-field="institute" value={consent.institute} onChange={(e) => { clearFieldError('institute'); setConsent({ ...consent, institute: e.target.value }); }} required />
                            </Field>
                            <Field label="Address" required error={fieldErrors.address}>
                              <input className="input" data-consent-field="address" value={consent.address} onChange={(e) => { clearFieldError('address'); setConsent({ ...consent, address: e.target.value }); }} required />
                            </Field>
                            <Field label="Mobile no. (for SMS)" required error={fieldErrors.mobile}>
                              <input
                                className="input"
                                data-consent-field="mobile"
                                inputMode="numeric"
                                value={consent.mobile}
                                maxLength={16}
                                placeholder="10-digit mobile"
                                onChange={(e) => {
                                  clearFieldError('mobile');
                                  setConsent({ ...consent, mobile: typedMobile(e.target.value) });
                                }}
                                required
                              />
                              {!fieldErrors.mobile && consent.mobile && !isValidMobile(consent.mobile) && (
                                <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                                  Must be 10 digits starting with 6, 7, 8, or 9
                                </span>
                              )}
                            </Field>
                            <Field label="Alternate mobile" error={fieldErrors.alternateMobile}>
                              <input
                                className="input"
                                data-consent-field="alternateMobile"
                                inputMode="numeric"
                                value={consent.alternateMobile}
                                maxLength={16}
                                placeholder="10-digit mobile"
                                onChange={(e) => {
                                  clearFieldError('alternateMobile');
                                  setConsent({ ...consent, alternateMobile: typedMobile(e.target.value) });
                                }}
                              />
                              {!fieldErrors.alternateMobile && consent.alternateMobile && !isValidMobile(consent.alternateMobile) && (
                                <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                                  Must be 10 digits starting with 6, 7, 8, or 9
                                </span>
                              )}
                            </Field>
                            <Field label="Email" required error={fieldErrors.email}>
                              <input
                                className="input"
                                data-consent-field="email"
                                type="email"
                                value={consent.email}
                                onChange={(e) => {
                                  clearFieldError('email');
                                  setConsent({ ...consent, email: e.target.value });
                                }}
                                required
                              />
                              {!fieldErrors.email && consent.email && !isValidEmail(consent.email) && (
                                <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                                  Please enter a valid email address
                                </span>
                              )}
                            </Field>
                            <Field label="Alternate email" error={fieldErrors.alternateEmail}>
                              <input
                                className="input"
                                data-consent-field="alternateEmail"
                                type="email"
                                value={consent.alternateEmail}
                                onChange={(e) => {
                                  clearFieldError('alternateEmail');
                                  setConsent({ ...consent, alternateEmail: e.target.value });
                                }}
                              />
                              {!fieldErrors.alternateEmail && consent.alternateEmail && !isValidEmail(consent.alternateEmail) && (
                                <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                                  Please enter a valid alternate email address
                                </span>
                              )}
                            </Field>
                          </div>

                          <h3 style={{ marginTop: 20 }}>Upload cancelled cheque</h3>
                          <Field label="Cancelled cheque (JPG, PNG or PDF, max 10 MB)" required error={fieldErrors.cheque}>
                            <input
                              className="input"
                              data-consent-field="cheque"
                              type="file"
                              accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
                              disabled={consentBusy}
                              onChange={(e) => void pickCheque(e.target.files?.[0] || null)}
                            />
                          </Field>
                          {chequeNote && <p className="guide-muted">{chequeNote}</p>}
                          <p className="guide-muted">Bank name, bank address, account number, IFSC and holder name should be clear on the cheque.</p>

                          <h3 style={{ marginTop: 20 }}>Bank details for remuneration</h3>
                          <div className="grid cols-2">
                            <Field label="Name of examiner (as provided in bank)" required error={fieldErrors.holderName}>
                              <input className="input" data-consent-field="holderName" value={consent.holderName} onChange={(e) => { clearFieldError('holderName'); setConsent({ ...consent, holderName: e.target.value }); }} required />
                            </Field>
                            <Field label="Bank name" required error={fieldErrors.bankName}>
                              <input className="input" data-consent-field="bankName" value={consent.bankName} onChange={(e) => { clearFieldError('bankName'); setConsent({ ...consent, bankName: e.target.value }); }} required />
                            </Field>
                            <Field label="Branch name with bank address" required error={fieldErrors.branchAddress}>
                              <input className="input" data-consent-field="branchAddress" value={consent.branchAddress} onChange={(e) => { clearFieldError('branchAddress'); setConsent({ ...consent, branchAddress: e.target.value }); }} required />
                            </Field>
                            <Field label="IFSC code" required error={fieldErrors.ifsc}>
                              <input className="input" data-consent-field="ifsc" value={consent.ifsc} onChange={(e) => { clearFieldError('ifsc'); setConsent({ ...consent, ifsc: e.target.value }); }} required />
                            </Field>
                            <Field label="Account type" required error={fieldErrors.accountType}>
                              <select data-consent-field="accountType" value={consent.accountType} onChange={(e) => { clearFieldError('accountType'); setConsent({ ...consent, accountType: e.target.value }); }}>
                                <option value="Saving">Saving</option>
                                <option value="Current">Current</option>
                              </select>
                            </Field>
                            <Field label="Account number" required error={fieldErrors.account}>
                              <input className="input" data-consent-field="account" value={consent.account} onChange={(e) => { clearFieldError('account'); setConsent({ ...consent, account: e.target.value }); }} required />
                            </Field>
                            <Field label="PAN number" required error={fieldErrors.pan}>
                              <input className="input" data-consent-field="pan" value={consent.pan} maxLength={10} onChange={(e) => { clearFieldError('pan'); setConsent({ ...consent, pan: e.target.value.toUpperCase() }); }} required />
                            </Field>
                          </div>
                        </>
                      )}

                      {consent.accept === false && (
                        <div style={{ marginTop: 12 }}>
                          <h3>Reason for refusal</h3>
                          <label className="field">
                            <span>
                              <input
                                type="radio"
                                checked={consent.refusalReason === 'PRIOR_COMMITMENTS'}
                                onChange={() => setConsent({ ...consent, refusalReason: 'PRIOR_COMMITMENTS' })}
                              />{' '}
                              Prior commitments during the same period
                            </span>
                          </label>
                          <label className="field">
                            <span>
                              <input
                                type="radio"
                                checked={consent.refusalReason === 'OTHER'}
                                onChange={() => setConsent({ ...consent, refusalReason: 'OTHER' })}
                              />{' '}
                              Other
                            </span>
                          </label>
                          {consent.refusalReason === 'OTHER' && (
                            <Field label="Reason" required>
                              <textarea className="input" rows={3} value={consent.refusalText} onChange={(e) => setConsent({ ...consent, refusalText: e.target.value })} required />
                            </Field>
                          )}
                        </div>
                      )}

                      <div ref={consentErrorRef} style={{ marginTop: 12 }}>
                        <ErrorBox error={consentError} />
                      </div>
                      <button className="btn" style={{ marginTop: 12 }} type="submit" disabled={consentBusy}>
                        {!consentBusy
                          ? 'Submit'
                          : consent.accept && consentProgress !== null && consentProgress < 100
                          ? `Uploading cheque… ${consentProgress}%`
                          : 'Saving…'}
                      </button>
                    </form>
                  </div>
                )}

                {detail.purpose === 'VIVA_DATE' && (
                  <div className="guide-card">
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        await post(`/tasks/${token}/viva-date`, { vivaDate, vivaTime, vivaVenue });
                        setDone('Viva-voce date, time and venue submitted.');
                      }}
                    >
                      <Field label="Viva / practical date" required>
                        <input className="input" type="date" value={vivaDate} onChange={(e) => setVivaDate(e.target.value)} />
                      </Field>
                      <Field label="Time">
                        <input className="input" type="time" value={vivaTime} onChange={(e) => setVivaTime(e.target.value)} />
                      </Field>
                      <Field label="Venue">
                        <input className="input" value={vivaVenue} onChange={(e) => setVivaVenue(e.target.value)} />
                      </Field>
                      <button className="btn" type="submit" style={{ marginTop: 12 }}>
                        Submit date
                      </button>
                    </form>
                  </div>
                )}

                {detail.purpose === 'REVISION' && (
                  <div className="guide-card">
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (revUpload) return;
                        setRevError(null);
                        if (!revFile) {
                          setRevError('Choose the revised PDF first');
                          return;
                        }
                        const problem = thesisFileProblem(revFile);
                        if (problem) {
                          setRevError(problem);
                          return;
                        }
                        const fd = new FormData();
                        fd.append('thesis', revFile);
                        setRevUpload({ loaded: 0, total: revFile.size, percent: 0 });
                        try {
                          await postWithProgress(`/tasks/${token}/revision`, fd, setRevUpload);
                          setDone('Revised thesis uploaded.');
                        } catch (err) {
                          setRevError(uploadFailureMessage(err));
                        } finally {
                          setRevUpload(null);
                        }
                      }}
                    >
                      <p>Upload the revised thesis PDF after the modification letter.</p>
                      <Field label="Revised thesis PDF" required>
                        <input className="input" type="file" accept="application/pdf" onChange={(e) => setRevFile(e.target.files?.[0] || null)} />
                      </Field>
                      {revUpload && <p className="guide-muted">{progressLabel(revUpload)}</p>}
                      <ErrorBox error={revError} />
                      <button className="btn" type="submit" style={{ marginTop: 12 }} disabled={Boolean(revUpload)}>
                        Upload revision
                      </button>
                    </form>
                  </div>
                )}

                {detail.purpose === 'EVALUATE' && tab === 'thesis' && (
                  <>
                    <div className="guide-card">
                      <h3>View Thesis</h3>
                      <p className="guide-muted">View the thesis below or download the PDF to read offline.</p>
                      {(() => {
                        const docs: any[] = detail.file?.documents || [];
                        const theses = docs.filter((d) => !d.kind || d.kind === 'THESIS');
                        const latest = theses.length
                          ? theses.reduce((a, b) => (Number(a.version || 0) >= Number(b.version || 0) ? a : b))
                          : null;
                        if (!latest) {
                          return <p className="guide-muted">No thesis PDF is attached to this file yet.</p>;
                        }
                        return (
                          <div style={{ marginTop: 12 }}>
                            <div className="row" style={{ marginBottom: 8 }}>
                              <span>
                                v{latest.version} {latest.originalName}
                              </span>
                              <a
                                className="btn small secondary"
                                href={`/api/uploads/${latest.path}`}
                                download={latest.originalName || 'thesis.pdf'}
                              >
                                Download thesis
                              </a>
                            </div>
                            <ProtectedPdfViewer src={`/api/uploads/${latest.path}`} title="Thesis PDF" />
                          </div>
                        );
                      })()}
                    </div>
                    <div id="evaluation-report" style={{ marginTop: 16 }}>
                      <EvaluationForm
                        meta={{
                          candidateName: detail.file?.candidate?.name,
                          title: detail.file?.title,
                          fileNo: detail.file?.fileNo,
                          thesisNumber: detail.file?.thesisNumber,
                          courseName: detail.file?.courseName,
                          courseTypeName: detail.file?.courseTypeName,
                          specialityName: detail.file?.specialityName,
                        }}
                        value={evalForm}
                        onChange={setEval}
                        disabled={evalLoading}
                        allowReject={!detail.hideEvaluationReject}
                        onSubmit={() => {
                          const err = evaluationError(evalForm, !detail.hideEvaluationReject);
                          if (err) {
                            setError(err);
                            return;
                          }
                          setError(null);
                          setConfirmEval(true);
                        }}
                      />
                    </div>
                  </>
                )}

                {detail.purpose === 'EVALUATE' && tab === 'log' && (
                  <div className="guide-card">
                    <h3>Previous evaluation log</h3>
                    <p className="guide-lead">Your earlier rejected or revision reports and the thesis version you evaluated.</p>
                    {evaluationHistory.length ? (
                      <>
                        <div className="eval-rounds">
                          {evaluationHistory.map((h: any, i: number) => (
                            <button
                              key={i}
                              type="button"
                              className={logIndex === i ? 'btn small' : 'btn secondary small'}
                              onClick={() => setLogIndex(i)}
                            >
                              {evaluationVerdictLabel(h.verdict)}
                              {h.documentVersion ? ` · v${h.documentVersion}` : ''}
                              {h.submittedAt ? ` · ${new Date(h.submittedAt).toLocaleDateString()}` : ''}
                            </button>
                          ))}
                        </div>
                        {(() => {
                          const selected = evaluationHistory[Math.min(logIndex, evaluationHistory.length - 1)];
                          const oldThesis = thesisByVersion(detail.file?.documents, selected?.documentVersion);
                          return (
                            <>
                              {oldThesis ? (
                                <div style={{ marginTop: 12 }}>
                                  <div className="row" style={{ marginBottom: 8 }}>
                                    <span>
                                      v{oldThesis.version} {oldThesis.originalName}
                                    </span>
                                  </div>
                                  <ProtectedPdfViewer src={`/api/uploads/${oldThesis.path}`} title="Previous thesis PDF" compact />
                                </div>
                              ) : (
                                <p className="guide-muted">The previous thesis PDF is not available.</p>
                              )}
                              <div style={{ marginTop: 16 }}>
                                <EvaluationForm
                                  meta={{
                                    candidateName: detail.file?.candidate?.name,
                                    title: detail.file?.title,
                                    fileNo: detail.file?.fileNo,
                                    thesisNumber: detail.file?.thesisNumber,
                                    courseName: detail.file?.courseName,
                                    courseTypeName: detail.file?.courseTypeName,
                                    specialityName: detail.file?.specialityName,
                                  }}
                                  value={toEvaluationValue(selected)}
                                  readOnly
                                  allowReject={!detail.hideEvaluationReject}
                                />
                              </div>
                            </>
                          );
                        })()}
                      </>
                    ) : (
                      <p className="guide-muted">No previous evaluations.</p>
                    )}
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      )}
      {confirmRemove && (
        <ConfirmDialog
          title="Remove examiner?"
          message={`Remove ${confirmRemove.name} (${confirmRemove.bucketCode}) from the panel? If this leaves the bucket short, you will need to add another examiner before submitting.`}
          yesLabel="Remove"
          noLabel="Cancel"
          onYes={() => removeExaminer(confirmRemove)}
          onNo={() => setConfirmRemove(null)}
        />
      )}
      {confirmEval && (
        <ConfirmDialog
          title="Submit evaluation report?"
          message="Your General Report will be sent to the Examination Section. Continue?"
          onYes={async () => {
            if (evalLock.current) return;
            evalLock.current = true;
            setConfirmEval(false);
            setEvalLoading(true);
            setError(null);
            try {
              await post(`/tasks/${token}/evaluate`, { ...evalForm, asChiefGuide: Boolean(detail?.asChiefGuide) });
              nav(`/task/${token}/submitted`, { replace: true });
            } catch (err: any) {
              setError(err.message);
            } finally {
              setEvalLoading(false);
              evalLock.current = false;
            }
          }}
          onNo={() => setConfirmEval(false)}
        />
      )}
      {evalLoading && <PageLoader message="Submitting evaluation report…" />}
    </div>
  );
}

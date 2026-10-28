import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post, patch, postWithProgress, type UploadProgress } from '../../api';
import { progressLabel, thesisFileProblem, uploadFailureMessage } from '../../upload';
import { Shell } from '../../components/Shell';
import { Metro } from '../../components/Metro';
import { ConfirmDialog, ErrorBox, Field, MailBodyView, PageLoader, Pill, ResultDialog } from '../../components/ui';
import { EvaluationForm, evaluationVerdictLabel, thesisByVersion, toEvaluationValue } from '../../components/EvaluationForm';
import { ExaminerPicker, emptyExaminerDraft, validateExaminerDraft } from '../../components/ExaminerPicker';
import { RevisionLetterPrint, type RevisionLetterDoc } from '../../components/RevisionLetterPrint';
import { useAuth } from '../../auth';
import { isCourseRole, isValidEmail, isValidMobile, cleanMobile } from '@ethesis/shared';

export function File360Page() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [remark, setRemark] = useState('');
  const [fileNo, setFileNo] = useState('');
  const [thesisNumber, setNumber] = useState('');
  const [fileNoEdit, setFileNoEdit] = useState<string | null>(null);
  const [fileNoBusy, setFileNoBusy] = useState(false);
  const [vivaDate, setVivaDate] = useState('');
  const [vivaTime, setVivaTime] = useState('');
  const [vivaVenue, setVivaVenue] = useState('');
  const [practicalRole, setPracticalRole] = useState('CHAIRPERSON');
  const [closeKind, setCloseKind] = useState('AWARD_SHEET');
  const [closeFile, setCloseFile] = useState<File | null>(null);
  const [hall, setHall] = useState('');
  const [supervisors, setSupervisors] = useState('');
  const [staffDuty, setStaffDuty] = useState('');
  const [eligibleCount, setEligibleCount] = useState('');
  const [member, setMember] = useState(emptyExaminerDraft());
  const [knownExaminers, setKnownExaminers] = useState<any[]>([]);
  const [guideId, setGuideId] = useState('');
  const [faculty, setFaculty] = useState<any[]>([]);
  const [revFile, setRevFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [examinerViewer, setExaminerViewer] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [travel, setTravel] = useState<Record<number, any>>({});
  const [confirmMail, setConfirmMail] = useState<{
    title: string;
    message: string;
    detail?: string;
    label: string;
    run: () => Promise<string>;
  } | null>(null);
  const [mailLoading, setMailLoading] = useState<string | null>(null);
  const [mailResult, setMailResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [reportViewer, setReportViewer] = useState<{ memberIndex: number; roundIndex: number } | null>(null);
  const [outbound, setOutbound] = useState<any[]>([]);
  const [mailView, setMailView] = useState<any>(null);
  const [revisionPrint, setRevisionPrint] = useState<RevisionLetterDoc[] | null>(null);
  const sendingLock = useRef(false);

  const canMail = () => {
    const role = user?.role;
    return role === 'DEALING' || role === 'INSTITUTE_ADMIN';
  };

  async function load() {
    const next = await get(`/files/${id}`);
    setData(next);
    setFileNo(next.file?.fileNo || '');
    setNumber(next.file?.thesisNumber || '');
    setVivaDate(next.file?.vivaDate || '');
    setVivaTime(next.file?.vivaTime || '');
    setVivaVenue(next.file?.vivaVenue || '');
    setHall(next.file?.examAdmin?.hall || '');
    setSupervisors(next.file?.examAdmin?.supervisors || '');
    setStaffDuty(next.file?.examAdmin?.staffDuty || '');
    setEligibleCount(next.file?.examAdmin?.eligibleCount || '');
    get(`/comms/outbound?fileId=${id}`)
      .then((rows) => setOutbound(Array.isArray(rows) ? rows : []))
      .catch(() => setOutbound([]));
    get(`/files/${id}/audit`)
      .then((rows) => setAudit(Array.isArray(rows) ? rows : []))
      .catch(() => setAudit([]));
  }
  useEffect(() => {
    load();
    get('/masters/faculty').then(setFaculty).catch(() => setFaculty([]));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    if (user?.role !== 'GUIDE' && !(user?.role === 'DEALING' || user?.role === 'INSTITUTE_ADMIN')) return;
    get(`/files/${id}/panel/known`)
      .then((rows) => setKnownExaminers(Array.isArray(rows) ? rows : []))
      .catch(() => setKnownExaminers([]));
  }, [id, user?.role, data?.file?.panel?.length]);

  /** Thesis-size upload with a progress line; failures come back as a readable message. */
  async function uploadWithProgress(path: string, fd: FormData, file: File) {
    const problem = thesisFileProblem(file);
    if (problem) throw new Error(problem);
    setUpload({ loaded: 0, total: file.size, percent: 0 });
    try {
      return await postWithProgress(path, fd, setUpload);
    } catch (err) {
      throw new Error(uploadFailureMessage(err));
    } finally {
      setUpload(null);
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async function act(action: string, extra: any = {}) {
    setError(null);
    try {
      if (action === 'REQUEST_PANEL' || action === 'RESEND_PANEL') await post(`/files/${id}/panel/request`, { resend: action === 'RESEND_PANEL' });
      else if (action === 'REQUEST_ADDITIONAL_PANEL') await post(`/files/${id}/panel/additional`, {});
      else if (action === 'SEND_OFFER') await post(`/files/${id}/panel/offers`, {});
      else if (action === 'DISPATCH') {
        const kind = data.currentStage?.letterKind;
        if (kind && kind !== 'THESIS' && kind !== 'OFFER') {
          await post(`/files/${id}/act`, { action: 'SEND_LETTER', remark, vivaDate, vivaTime, vivaVenue });
        } else {
          await post(`/files/${id}/panel/dispatch`, {});
        }
      } else if (action === 'SEND_LETTER') {
        await post(`/files/${id}/act`, { action: 'SEND_LETTER', remark, vivaDate, vivaTime, vivaVenue });
      }
      else if (action === 'REMUNERATE') await post(`/comms/remunerate/${id}`, {});
      else if (action === 'UPLOAD_REVISION') {
        if (!revFile) throw new Error('Choose the revised PDF first');
        const fd = new FormData();
        fd.append('thesis', revFile);
        await uploadWithProgress(`/files/${id}/evaluation/revision`, fd, revFile);
      } else await post(`/files/${id}/act`, { action, remark, fileNo, thesisNumber, vivaDate, vivaTime, vivaVenue, hall, supervisors, staffDuty, eligibleCount, ...extra });
      await load();
    } catch (e: any) {
      setError(e.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async function runMailJob(label: string, fn: () => Promise<string>) {
    if (sendingLock.current) return;
    sendingLock.current = true;
    setConfirmMail(null);
    setMailResult(null);
    setError(null);
    setMailLoading(label);
    try {
      const message = await fn();
      await load();
      setMailResult({ ok: true, message });
    } catch (e: any) {
      setMailResult({ ok: false, message: e.message || 'Mail could not be sent.' });
    } finally {
      setMailLoading(null);
      sendingLock.current = false;
    }
  }

  async function saveFileNo() {
    if (fileNoEdit === null) return;
    setError(null);
    setFileNoBusy(true);
    try {
      await patch(`/files/${id}/file-no`, { fileNo: fileNoEdit });
      setFileNoEdit(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFileNoBusy(false);
    }
  }

  if (!data) return <Shell mode="app">Loading…</Shell>;
  const file = data.file;
  const actions: string[] = data.actions || [];
  const buckets = data.blueprint?.panelRule?.buckets || [];
  const canEditFile = isCourseRole(user?.role) && data.currentStage?.type === 'INITIATE';
  const canEditFileNo = user?.role === 'DEALING' || user?.role === 'INSTITUTE_ADMIN' || user?.role === 'SUPER_ADMIN';
  const canRequestGuide = isCourseRole(user?.role) || user?.role === 'ACADEMIC';
  const coGuides: any[] = data.coGuides || [];
  const stageCode = data.currentStage?.code;
  const goesTo = stageGoesTo(data, file);
  const stageType = data.currentStage?.type;
  const waitingForGuidePanel = stageType === 'PANEL_BUILD' || stageType === 'ADDITIONAL_PANEL';
  const canAssignPanel =
    !waitingForGuidePanel &&
    (user?.role === 'DEALING' || user?.role === 'INSTITUTE_ADMIN' || user?.role === 'AUTHORITY');
  const canViewReports = user?.role === 'DEALING' || user?.role === 'INSTITUTE_ADMIN';
  const canBuildPanel = user?.role === 'GUIDE';
  const pendingVet = (file.panel || []).filter((p: any) => {
    const practical = String(stageCode || '').startsWith('practical');
    if (practical ? !p.isPractical : p.isPractical) return false;
    return p.assigned && (!p.vetStatus || p.vetStatus === 'PENDING');
  });
  const hasExaminerVet = (data.blueprint?.stages || []).some((s: any) => {
    if (s.type !== 'PANEL_VET') return false;
    return stageCode === 'practical_offer' || stageCode === 'practical_vet'
      ? s.code === 'practical_vet'
      : s.code !== 'practical_vet';
  });
  const revisionNames = (file.panel || [])
    .filter((p: any) => p.evaluation?.verdict === 'REVISION' || p.evaluation?.verdict === 'REJECT')
    .map((p: any) => p.name?.trim())
    .filter(Boolean)
    .join(', ');

  function actionLabel(action: string) {
    if (action === 'APPROVE' && stageCode === 'ace_review') return 'Send to Dealing';
    if (action === 'APPROVE' && stageCode === 'cg_approval') return 'Approve Chief Guide';
    if (action === 'APPROVE' && stageCode === 'practical_vet') return 'Approve practical examiner and send to Dealing';
    if (action === 'APPROVE' && stageType === 'PANEL_VET') return 'Continue after vetting';
    if (action === 'REJECT' && stageType === 'CONSENT_ROUTE') return 'Return to Dealing';
    if (action === 'REJECT' && stageCode === 'cg_approval') return 'Return to Dealing';
    if (action === 'HOLD' && stageType === 'PANEL_VET') return 'Hold file';
    if (action === 'REJECT' && stageType === 'PANEL_VET') return 'Return file';
    if (action === 'ASSIGN_NUMBER') return 'Save numbers and send to Assoc Dean';
    if (action === 'SEND_TO_EXAM') return 'Send to Examination Section (starts blueprint workflow)';
    if (action === 'RESEND_PANEL') return `Resend panel request to ${file.chiefGuideName || 'Chief Guide'}`;
    if (action === 'SEND_OFFER') return stageCode === 'practical_offer' ? 'Send practical offer letters' : 'Send examiner offer letters';
    if (action === 'DISPATCH') return 'Send thesis / evaluation letters';
    if (action === 'SEND_LETTER') {
      const kind = data.currentStage?.letterKind;
      if (kind === 'REVISION') return file.revisionLetterSentAt ? 'Resend revision letter' : 'Send revision letter';
      if (kind === 'CG_EVAL') return 'Send Chief Guide evaluation letter';
      if (kind === 'VIVA') return 'Send viva letter to Chief Guide';
      if (kind === 'BOARD') return 'Send letter to Board of Examiners';
      return 'Send letter';
    }
    if (action === 'NOTIFY_CHAIR') return 'Email practical date link to Chairperson';
    if (action === 'SAVE_VIVA_DETAILS') return 'Save viva details';
    if (action === 'SAVE_EXAM_ADMIN') return 'Save exam administration';
    if (action === 'ACKNOWLEDGE_RESULT') return 'Acknowledge result';
    if (action === 'SEND_REMINDER') {
      const next = (file.reminderLevel || 0) + 1;
      return `Send reminder ${next}`;
    }
    if (action === 'APPROVE' && (stageCode === 'revision_dean' || data.currentStage?.letterKind === 'REVISION')) {
      return 'Approve modification and send to Dealing';
    }
    if (action === 'HOLD') return 'Hold';
    if (action === 'REQUEST_ADDITIONAL_PANEL') return 'Request additional examiners from Chief Guide';
    if (action === 'NOTIFY_GUIDE') {
      return stageType === 'VIVA_DATE'
        ? `Email viva date link to ${file.chiefGuideName || 'Chief Guide'}`
        : stageType === 'EVALUATE'
          ? `Email evaluation link to ${file.chiefGuideName || 'Chief Guide'}`
          : `Email revision link to ${file.chiefGuideName || 'Chief Guide'}`;
    }
    return action.replaceAll('_', ' ');
  }

  function lastSentMail(email: string, purpose: string) {
    const want = String(email || '').trim().toLowerCase();
    return outbound
      .filter(
        (m) =>
          m.status === 'SENT' &&
          String(m.to || '').trim().toLowerCase() === want &&
          m.purpose === purpose,
      )
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
  }

  function chiefGuidePerson() {
    return { email: file.chiefGuideEmail, name: file.chiefGuideName };
  }

  async function fetchPreview(purpose: string, channel: string, examinerName?: string) {
    const params = new URLSearchParams({ fileId: String(id), purpose, channel });
    if (examinerName) params.set('examinerName', examinerName);
    return get(`/comms/preview?${params.toString()}`);
  }

  function previewDetail(preview: any, to?: string, toName?: string) {
    const who = [toName, to ? `<${to}>` : ''].filter(Boolean).join(' ');
    return [
      who ? `To: ${who}` : '',
      preview?.subject ? `Subject: ${preview.subject}` : '',
      preview?.body || '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  async function confirmWithPreview(opts: {
    title: string;
    message: string;
    label: string;
    purpose: string;
    channel: string;
    examinerName?: string;
    to?: string;
    toName?: string;
    run: () => Promise<string>;
  }) {
    setError(null);
    setMailLoading('Loading letter…');
    try {
      const preview = await fetchPreview(opts.purpose, opts.channel, opts.examinerName);
      setMailLoading(null);
      setConfirmMail({
        title: opts.title,
        message: opts.message,
        detail: previewDetail(preview, opts.to, opts.toName || opts.examinerName),
        label: opts.label,
        run: opts.run,
      });
    } catch (e: any) {
      setMailLoading(null);
      setError(e.message);
    }
  }

  async function openMailView(p: any, purpose: string, channel: string) {
    setError(null);
    const sent = lastSentMail(p.email, purpose);
    if (sent) {
      setMailView(sent);
      return;
    }
    setMailLoading('Loading letter…');
    try {
      const preview = await fetchPreview(purpose, channel, p.name);
      setMailView({
        subject: preview?.subject,
        body: preview?.body,
        to: p.email,
        toName: p.name,
        status: 'PREVIEW',
        purpose,
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setMailLoading(null);
    }
  }

  async function printApprovedRevision(kind: 'CG' | 'EXAMINER') {
    setError(null);
    const examiners = (data?.file?.panel || [])
      .map((p: any, i: number) => ({ ...p, panelIndex: p.panelIndex ?? i }))
      .filter((p: any) => {
        if (p.isPractical || p.isChiefGuide) return false;
        if (p.evaluation?.verdict === 'REVISION' || p.evaluation?.verdict === 'REJECT') return true;
        return (p.evaluationHistory || []).some(
          (h: any) => h.verdict === 'REVISION' || h.verdict === 'REJECT',
        );
      });
    if (!examiners.length) {
      setError('No examiner asked for revision / modification on this file');
      return;
    }
    setMailLoading(kind === 'EXAMINER' ? 'Loading examiner letter…' : 'Loading Chief Guide letter…');
    try {
      const letters = await Promise.all(
        examiners.map((p: any) =>
          get(`/files/${id}/letters/revision?kind=${kind}&panelIndex=${p.panelIndex}`),
        ),
      );
      setRevisionPrint(letters);
    } catch (e: any) {
      setError(e.message || 'Could not load the approved letter');
    } finally {
      setMailLoading(null);
    }
  }

  async function openFileLetter() {
    setError(null);
    const letters = outbound
      .filter((m) => String(m.channel || '').toUpperCase() === 'LETTER' || m.body)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    if (letters[0]) {
      setMailView(letters[0]);
      return;
    }
    const purpose = data.currentStage?.letterKind || 'OFFER';
    setMailLoading('Loading letter…');
    try {
      const preview = await fetchPreview(purpose, 'LETTER');
      setMailView({
        subject: preview?.subject,
        body: preview?.body,
        status: 'PREVIEW',
        purpose,
      });
    } catch (e: any) {
      setError(e.message || 'No letter is available for this file yet.');
    } finally {
      setMailLoading(null);
    }
  }

  return (
    <Shell mode="app">
      <div className="file360">
      <div className="page-title">
        <div>
          <h1>{file.candidate?.name}</h1>
          <p>
            {file.title} · {file.candidate?.enrollmentNo} · {data.department?.name || '—'}
            {' · '}Chief Guide {file.chiefGuideName}
            {coGuides.length ? ` · Co-guides ${coGuides.map((g) => g.name).join(', ')}` : ''}
            {data.lane ? ` · ${(data.lane as string).replaceAll('_', ' ')}` : ''}
          </p>
        </div>
        <div className="row">
          {canEditFile && !file.thesisNumber && (
            <Link className="btn secondary small" to={`/app/files/${id}/edit`}>
              Edit thesis
            </Link>
          )}
          <Pill status={file.status} />
        </div>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <Metro
          items={file.metro || []}
          hrefForStage={(stageCode) => {
            const params = new URLSearchParams();
            params.set('stage', stageCode);
            const courseTypeId = String(file.courseTypeId || data.courseType?._id || '');
            if (courseTypeId) params.set('courseTypeId', courseTypeId);
            const month = data.session?.month;
            const year = data.session?.year;
            if (month) params.set('month', String(month));
            if (year) params.set('year', String(year));
            return `/app/files?${params.toString()}`;
          }}
        />
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          {fileNoEdit !== null ? (
            <span className="row" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              File no.
              <input
                className="input"
                style={{ width: 320, padding: '4px 8px' }}
                value={fileNoEdit}
                autoFocus
                aria-label="Exam file no."
                onChange={(e) => setFileNoEdit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveFileNo();
                  if (e.key === 'Escape') setFileNoEdit(null);
                }}
              />
              <button type="button" className="btn small" disabled={fileNoBusy || !fileNoEdit.trim()} onClick={saveFileNo}>
                Save
              </button>
              <button type="button" className="btn small ghost" onClick={() => setFileNoEdit(null)}>
                Cancel
              </button>
            </span>
          ) : (
            <>
              File no. {file.fileNo || '—'}
              {canEditFileNo && file.fileNo ? (
                <button
                  type="button"
                  className="btn ghost small"
                  style={{ marginLeft: 6, padding: '0 6px' }}
                  onClick={() => setFileNoEdit(file.fileNo || '')}
                >
                  Edit
                </button>
              ) : null}
            </>
          )}
          {' · '}Thesis no. {file.thesisNumber || '—'}
          <br />
          Current: <b>{data.currentStage?.name}</b>
          {goesTo ? ` — ${goesTo}` : ''}
          {data.currentStage?.letterKind ? ` · ${data.currentStage.letterKind} letter` : ''}
        </div>
      </div>
      <ErrorBox error={error} />
      {file.guideChangeRequest?.status === 'PENDING' && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3>Chief Guide change requested</h3>
          <p>
            {file.guideChangeRequest.chiefGuideName} — {file.guideChangeRequest.reason || 'No reason'}
          </p>
          {(user?.role === 'DEALING' || user?.role === 'AUTHORITY' || user?.role === 'INSTITUTE_ADMIN') && (
            <div className="row">
              <button className="btn small" onClick={() => post(`/files/${id}/guide-change/resolve`, { approve: true }).then(load)}>
                Approve change
              </button>
              <button className="btn secondary small" onClick={() => post(`/files/${id}/guide-change/resolve`, { approve: false }).then(load)}>
                Reject
              </button>
            </div>
          )}
        </div>
      )}
      <div className="file360-body">
        <div className="card">
          <h3>Stage action</h3>
          <div style={{ marginBottom: 16 }}>
            <h3>Documents</h3>
            {file.documents?.length ? (
              file.documents.map((d: any, i: number) => (
                <div key={i} className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
                  <span>
                    v{d.version} {d.originalName}
                  </span>
                  <div className="row" style={{ gap: 8 }}>
                    {i === 0 && (
                      <button type="button" className="btn small" onClick={() => setInfoOpen(true)}>
                        View candidate info
                      </button>
                    )}
                    <a className="btn small" href={`/api/uploads/${d.path}`} target="_blank" rel="noreferrer">
                      View thesis
                    </a>
                    <button type="button" className="btn secondary small" onClick={openFileLetter}>
                      View letter
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
                <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>No document uploaded yet.</p>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn small" onClick={() => setInfoOpen(true)}>
                    View candidate info
                  </button>
                  <button type="button" className="btn secondary small" onClick={openFileLetter}>
                    View letter
                  </button>
                </div>
              </div>
            )}
          </div>
          <Field label="Remark">
            <input className="input" value={remark} onChange={(e) => setRemark(e.target.value)} />
          </Field>
          {actions.includes('ASSIGN_NUMBER') && (
            <>
              <Field label="Exam file no." required>
                <input className="input" value={fileNo} onChange={(e) => setFileNo(e.target.value)} required />
              </Field>
              <Field label="Thesis number" required>
                <input className="input" value={thesisNumber} onChange={(e) => setNumber(e.target.value)} required />
              </Field>
            </>
          )}
          {actions.includes('SET_VIVA_DATE') && (
            <>
              <Field label="Viva / practical date">
                <input className="input" type="date" value={vivaDate} onChange={(e) => setVivaDate(e.target.value)} />
              </Field>
              <Field label="Time">
                <input className="input" type="time" value={vivaTime} onChange={(e) => setVivaTime(e.target.value)} />
              </Field>
              <Field label="Venue">
                <input className="input" value={vivaVenue} onChange={(e) => setVivaVenue(e.target.value)} />
              </Field>
            </>
          )}
          {(actions.includes('SAVE_VIVA_DETAILS') || stageType === 'VIVA') && (
            <>
              <Field label="Proposed time">
                <input className="input" type="time" value={vivaTime} onChange={(e) => setVivaTime(e.target.value)} />
              </Field>
              <Field label="Proposed venue">
                <input className="input" value={vivaVenue} onChange={(e) => setVivaVenue(e.target.value)} />
              </Field>
            </>
          )}
          {actions.includes('UPLOAD_REVISION') && (
            <Field label="Revised thesis PDF">
              <input className="input" type="file" accept="application/pdf" onChange={(e) => setRevFile(e.target.files?.[0] || null)} />
              {upload && <small className="muted" style={{ display: 'block', marginTop: 4 }}>{progressLabel(upload)}</small>}
            </Field>
          )}
          {(stageType === 'CLOSE' || stageType === 'PRACTICAL' || stageCode === 'practical_date') && canMail() && (
            <>
              <Field label="Hall / seat">
                <input className="input" value={hall} onChange={(e) => setHall(e.target.value)} />
              </Field>
              <Field label="Supervisors">
                <input className="input" value={supervisors} onChange={(e) => setSupervisors(e.target.value)} />
              </Field>
              <Field label="Staff duty">
                <input className="input" value={staffDuty} onChange={(e) => setStaffDuty(e.target.value)} />
              </Field>
              <Field label="Eligible candidates">
                <input className="input" value={eligibleCount} onChange={(e) => setEligibleCount(e.target.value)} />
              </Field>
              <Field label="Close-out document">
                <select className="input" value={closeKind} onChange={(e) => setCloseKind(e.target.value)}>
                  <option value="AWARD_SHEET">Award sheet</option>
                  <option value="CHALLAN">Candidate challan</option>
                  <option value="QUESTION_PAPER">Question paper</option>
                  <option value="SUPPORTING">Other document</option>
                </select>
                <input className="input" type="file" accept="application/pdf" onChange={(e) => setCloseFile(e.target.files?.[0] || null)} />
                <button
                  className="btn secondary small"
                  style={{ marginTop: 6 }}
                  onClick={() =>
                    run(async () => {
                      if (!closeFile) throw new Error('Choose a PDF first');
                      const fd = new FormData();
                      fd.append('file', closeFile);
                      fd.append('kind', closeKind);
                      await uploadWithProgress(`/files/${id}/documents`, fd, closeFile);
                      setCloseFile(null);
                    })
                  }
                >
                  Upload {closeKind.replaceAll('_', ' ').toLowerCase()}
                </button>
                {upload && <small className="muted" style={{ display: 'block', marginTop: 4 }}>{progressLabel(upload)}</small>}
              </Field>
            </>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            {actions.filter((a) => a !== 'RESEND_PANEL' && a !== 'PICK_NTH').map((a) => {
              const blockContinue = a === 'APPROVE' && stageType === 'PANEL_VET' && pendingVet.length > 0;
              const mailBusy = !!mailLoading;
              const cgMailPurpose =
                a === 'NOTIFY_GUIDE'
                  ? stageType === 'VIVA_DATE'
                    ? 'VIVA_DATE'
                    : stageType === 'EVALUATE'
                      ? 'EVALUATE'
                      : 'REVISION'
                  : 'PANEL_BUILD';
              const showCgView =
                a === 'REQUEST_PANEL' || a === 'REQUEST_ADDITIONAL_PANEL' || a === 'NOTIFY_GUIDE';
              const sentCgMail = showCgView ? lastSentMail(file.chiefGuideEmail, cgMailPurpose) : null;
              const actionBtn = (
                <button
                  type="button"
                  className="btn small"
                  disabled={blockContinue || mailBusy}
                  title={blockContinue ? `Still to vet: ${pendingVet.map((p: any) => p.name.trim()).join(', ')}` : undefined}
                  onClick={() => {
                    if (a === 'REQUEST_PANEL' || a === 'RESEND_PANEL' || a === 'REQUEST_ADDITIONAL_PANEL') {
                      confirmWithPreview({
                        title:
                          a === 'RESEND_PANEL'
                            ? 'Review mail and resend panel request?'
                            : a === 'REQUEST_ADDITIONAL_PANEL'
                              ? 'Review mail and request additional examiners?'
                              : 'Review mail and request panel?',
                        message: `Read the mail below, then send it to ${file.chiefGuideName || 'the Chief Guide'}${file.chiefGuideEmail ? ` (${file.chiefGuideEmail})` : ''}. They open the task link and click Get passcode to receive the passcode in a second email.`,
                        label: 'Sending Chief Guide mail…',
                        purpose: 'PANEL_BUILD',
                        channel: 'EMAIL',
                        to: file.chiefGuideEmail,
                        toName: file.chiefGuideName,
                        run: async () => {
                          if (a === 'REQUEST_ADDITIONAL_PANEL') {
                            await post(`/files/${id}/panel/additional`, {});
                            return `Additional panel request sent to ${file.chiefGuideEmail}.`;
                          }
                          const r: any = await post(`/files/${id}/panel/request`, { resend: a === 'RESEND_PANEL' });
                          return r.message || `Panel request sent to ${file.chiefGuideEmail}.`;
                        },
                      });
                      return;
                    }
                    if (a === 'NOTIFY_GUIDE') {
                      confirmWithPreview({
                        title: 'Review mail and email Chief Guide?',
                        message: `Read the mail below, then send it to ${file.chiefGuideName || 'the Chief Guide'}${file.chiefGuideEmail ? ` (${file.chiefGuideEmail})` : ''}. They open the task link and click Get passcode to receive the passcode in a second email.`,
                        label: 'Sending Chief Guide mail…',
                        purpose:
                          stageType === 'VIVA_DATE' ? 'VIVA_DATE' : stageType === 'EVALUATE' ? 'EVALUATE' : 'REVISION',
                        channel: 'EMAIL',
                        to: file.chiefGuideEmail,
                        toName: file.chiefGuideName,
                        run: async () => {
                          await post(`/files/${id}/act`, { action: 'NOTIFY_GUIDE', remark });
                          return `Task link sent to ${file.chiefGuideEmail}.`;
                        },
                      });
                      return;
                    }
                    if (a === 'SEND_OFFER') {
                      confirmWithPreview({
                        title: 'Send offer letters?',
                        message:
                          'This emails only the ticked / assigned examiners who have not yet accepted or regretted. Leftover names stay on Dealing’s panel and are not mailed.',
                        label: 'Sending offer letters…',
                        purpose: 'CONSENT',
                        channel: 'EMAIL',
                        run: async () => {
                          const r: any = await post(`/files/${id}/panel/offers`, {});
                          return r.message || 'Offer letters sent.';
                        },
                      });
                      return;
                    }
                    if (a === 'DISPATCH') {
                      confirmWithPreview({
                        title: 'Send thesis / evaluation letters?',
                        message:
                          'This emails accepted examiners a thesis letter with a link to view the PDF and submit the General Report.',
                        label: 'Sending thesis / evaluation letters…',
                        purpose: 'EVALUATE',
                        channel: 'EMAIL',
                        run: async () => {
                          const r: any = await post(`/files/${id}/panel/dispatch`, {});
                          return r.message || 'Thesis / evaluation letters sent.';
                        },
                      });
                      return;
                    }
                    if (a === 'SEND_LETTER') {
                      const kind = data.currentStage?.letterKind || 'REVISION';
                      confirmWithPreview({
                        title: `Send ${String(kind).replaceAll('_', ' ').toLowerCase()} letter?`,
                        message: 'This records the letter and emails the Chief Guide or Board as required. Revision letters stay pending until you Continue.',
                        label: 'Sending letter…',
                        purpose: kind,
                        channel: 'LETTER',
                        run: async () => {
                          await post(`/files/${id}/act`, { action: 'SEND_LETTER', remark, vivaDate, vivaTime, vivaVenue });
                          return 'Letter sent.';
                        },
                      });
                      return;
                    }
                    if (a === 'SEND_REMINDER') {
                      const next = (file.reminderLevel || 0) + 1;
                      setMailLoading('Loading reminder letter…');
                      get(`/comms/preview?fileId=${id}&purpose=REMINDER&channel=LETTER`)
                        .then((preview: any) => {
                          setMailLoading(null);
                          setConfirmMail({
                            title: `Send reminder ${next}?`,
                            message: preview?.hasTemplate
                              ? `This uses the Letter REMINDER template and starts reminder ${next} of 3. Accepted examiners receive the letter, then the file goes for AO / ACE / Dean hops.`
                              : `No active Letter REMINDER template. A default reminder letter will be used for reminder ${next} of 3.`,
                            detail: [preview?.subject, preview?.body].filter(Boolean).join('\n\n'),
                            label: 'Sending reminder…',
                            run: async () => {
                              await post(`/files/${id}/act`, { action: 'SEND_REMINDER', remark });
                              return `Reminder ${next} recorded and sent for approval.`;
                            },
                          });
                        })
                        .catch((e: any) => {
                          setMailLoading(null);
                          setError(e.message);
                        });
                      return;
                    }
                    act(a);
                  }}
                >
                  {actionLabel(a)}
                </button>
              );
              if (showCgView) {
                return (
                  <div key={a} className="row" style={{ gap: 6 }}>
                    {actionBtn}
                    <button
                      type="button"
                      className="btn secondary small"
                      disabled={mailBusy}
                      onClick={() => openMailView(chiefGuidePerson(), cgMailPurpose, 'EMAIL')}
                    >
                      {sentCgMail ? 'View sent mail' : 'View mail'}
                    </button>
                  </div>
                );
              }
              return <span key={a}>{actionBtn}</span>;
            })}
          </div>
          {canMail() && (data.approvedLetters?.cg || data.approvedLetters?.examiner) && (
            <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
              {data.approvedLetters?.cg && (
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={!!mailLoading}
                  onClick={() => printApprovedRevision('CG')}
                >
                  Print Chief Guide revision letter
                </button>
              )}
              {data.approvedLetters?.examiner && (
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={!!mailLoading}
                  onClick={() => printApprovedRevision('EXAMINER')}
                >
                  Print examiner re-eval letter
                </button>
              )}
            </div>
          )}
          {actions.filter((a) => a !== 'RESEND_PANEL').length === 0 && !canBuildPanel && !waitingForGuidePanel && (
            <p style={{ fontSize: 13, marginTop: 8, color: 'var(--muted)' }}>
              No action on this login. Waiting on <b>{stageActorLabel(data, file) || 'the assigned role'}</b>.{' '}
              {stageLoginHint(data, file)}
            </p>
          )}
          {stageType === 'PANEL_REQUEST' && actions.includes('REQUEST_PANEL') && (
            <p style={{ fontSize: 13, marginTop: 8, color: 'var(--muted)' }}>
              This request has not been sent yet. Click <b>View mail</b> to read the email, then{' '}
              <b>Request panel from {file.chiefGuideName || 'Chief Guide'}</b> to send it. They will request a passcode after opening the link.
            </p>
          )}
          {stageType === 'PANEL_VET' && pendingVet.length > 0 && (
            <p style={{ fontSize: 13, marginTop: 8, color: 'var(--muted)' }}>
              Examiner Approve already saved for the rows marked APPROVED. Still to vet in the panel list:{' '}
              <b>{pendingVet.map((p: any) => p.name.trim()).join(', ')}</b>. Then use Continue after vetting.
            </p>
          )}
          {stageCode === 'practical_appoint' && (
            <p style={{ fontSize: 13, marginTop: 8, color: 'var(--muted)' }}>
              Assign Chairperson, Internal and External (a separate practical board). Then Continue to Associate Dean
              for Approve / Hold / Reject.
            </p>
          )}
          {stageCode === 'practical_vet' && (
            <p style={{ fontSize: 13, marginTop: 8, color: 'var(--muted)' }}>
              Approve, Hold or Reject each practical board member. Hold is a real third outcome. Continue when
              Chairperson, Internal and External are approved.
            </p>
          )}
          {stageType === 'CONSENT' && (
            <p style={{ fontSize: 13, marginTop: 8, color: 'var(--muted)' }}>
              Tick examiners at selection, then send offer letters only to assigned examiners after they have been
              approved. To use a leftover name, click <b>Send for approval</b> on that row. The file goes back through
              the examiner approval hops first. They are emailed only after that routing is complete. Continue appears
              when enough selected examiners have accepted. If the leftover pool is empty, request additional examiners
              from the Chief Guide.
            </p>
          )}
          {stageType === 'DISPATCH_THESIS' && (
            <p style={{ fontSize: 13, marginTop: 8, color: 'var(--muted)' }}>
              Send thesis / evaluation letters to examiners who have accepted the offer. Confirm, then wait for the
              loader. If someone missed the mail, use <b>Resend email</b> on that row.
            </p>
          )}
          {stageType === 'PICK_NTH' && (
            <p style={{ fontSize: 13, marginTop: 8, color: 'var(--muted)' }}>
              Associate Dean picks the 4th Indian examiner from leftover Indian names. Click <b>Pick 4th</b> on one
              leftover row. Do not pick someone who already submitted a report.
            </p>
          )}
          {stageType === 'EVALUATE' && data.currentStage?.actorRole === 'GUIDE' && (
            <p style={{ fontSize: 13, marginTop: 8, color: 'var(--muted)' }}>
              The Chief Guide evaluates as the third examiner. They do not use a staff login. Click{' '}
              <b>Email evaluation link to {file.chiefGuideName || 'Chief Guide'}</b>, then they open the mailed task
              link, click Get passcode, and submit the General Report.
            </p>
          )}
          {stageType === 'EVALUATE' && data.currentStage?.actorRole !== 'GUIDE' && (
            <p style={{ fontSize: 13, marginTop: 8, color: 'var(--muted)' }}>
              Examiners submit the confidential General Report from their task link. This screen only tracks verdicts
              and lets you <b>Resend email</b> while a report is still missing. The file stays here until every assigned
              examiner has submitted, unless a Revision or Reject moves it. Send reminder uses the Letter REMINDER
              template, then AO / ACE / Dean hops.
            </p>
          )}
          {(stageCode === 'revision_dean' || data.currentStage?.letterKind === 'REVISION') && stageType === 'CONSENT_ROUTE' && (
            <p style={{ fontSize: 13, marginTop: 8, color: 'var(--muted)' }}>
              An examiner asked for revision / modification
              {revisionNames ? ` (${revisionNames})` : ''}. Click <b>Approve modification and send to Dealing</b>. Dealing
              then uploads the revised thesis PDF and the same examiner evaluates again. Do not use Return unless you
              want to stop this file.
            </p>
          )}
          {stageType === 'REVISION' && (
            <p style={{ fontSize: 13, marginTop: 8, color: 'var(--muted)' }}>
              Upload the revised thesis PDF. After upload the file returns to examiner evaluation for the examiner who
              asked for modification.
            </p>
          )}
          {file.vivaDate && <p style={{ fontSize: 13, marginTop: 8 }}>Fixed date: {file.vivaDate}</p>}
          {file.reminderLevel > 0 && (
            <p style={{ fontSize: 13, marginTop: 8 }}>Evaluation reminders sent: {file.reminderLevel} / 3</p>
          )}
          {file.resultStatus === 'HOLD' && <p style={{ fontSize: 13 }}>Result is held.</p>}
          <div className="activity-log" style={{ marginTop: 16 }}>
            <h3>Activity</h3>
            {audit.length ? (
              <div className="activity-scroll">
              {audit.map((row: any) => {
                const remark = String(row.remark || '').trim();
                const noteTexts = (row.notes || [])
                  .map((n: any) => String(n.message || '').trim())
                  .filter((message: string) => message && message !== remark);
                return (
                  <div key={row._id} className="activity-item">
                    <p>
                      <b>{row.actorName || row.actorEmail || 'System'}</b>
                      {' · '}
                      {row.operation || row.action || 'UPDATE'}
                    </p>
                    {remark ? <p className="activity-remark">Remark: {remark}</p> : null}
                    {noteTexts.map((message: string, i: number) => (
                      <p key={`${row._id}-note-${i}`} className="activity-remark">
                        Comment: {message}
                      </p>
                    ))}
                    <p className="activity-time">
                      {row.createdAt ? new Date(row.createdAt).toLocaleString() : ''}
                    </p>
                  </div>
                );
              })}
              </div>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>No edit or delete log for this file yet.</p>
            )}
          </div>
          {canRequestGuide && (
            <div style={{ marginTop: 16 }}>
              <h3>Request Chief Guide change</h3>
              <select value={guideId} onChange={(e) => setGuideId(e.target.value)}>
                <option value="">Select faculty</option>
                {faculty.map((f: any) => (
                  <option key={f._id} value={f._id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <button
                className="btn small"
                style={{ marginTop: 8 }}
                onClick={() => post(`/files/${id}/guide-change`, { chiefGuideId: guideId, reason: remark }).then(load)}
              >
                Submit request
              </button>
            </div>
          )}
        </div>
        <div className="card">
          <h3>Panel</h3>
          {stageCode === 'practical_appoint' && canMail() && (
            <div style={{ marginBottom: 12 }}>
              <Field label="Practical role">
                <select className="input" value={practicalRole} onChange={(e) => setPracticalRole(e.target.value)}>
                  <option value="CHAIRPERSON">Chairperson</option>
                  <option value="INTERNAL">Internal</option>
                  <option value="EXTERNAL">External</option>
                </select>
              </Field>
              <ExaminerPicker
                examiners={knownExaminers}
                member={{ ...member, bucketCode: member.bucketCode || 'PRACTICAL' }}
                buckets={[{ code: 'PRACTICAL', label: 'Practical board' }]}
                onChange={setMember}
              />
              <div className="row" style={{ marginTop: 8, gap: 8 }}>
                <button
                  className="btn small"
                  onClick={() => {
                    const err = validateExaminerDraft(member);
                    if (err) {
                      alert(err);
                      return;
                    }
                    post(`/files/${id}/panel/practical`, { ...member, practicalRole })
                      .then(() => {
                        setMember(emptyExaminerDraft());
                        load();
                      })
                      .catch((e: any) => alert(e.message || 'Failed to assign practical examiner'));
                  }}
                >
                  Assign {practicalRole.replaceAll('_', ' ').toLowerCase()}
                </button>
                <button
                  className="btn secondary small"
                  onClick={async () => {
                    const r: any = await get(`/files/${id}/panel/practical-details`);
                    const blob = new Blob([r.csv || ''], { type: 'text/csv' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = r.filename || 'practical-board.csv';
                    a.click();
                  }}
                >
                  Download examiner details
                </button>
              </div>
            </div>
          )}
          {stageType === 'PANEL_VET' && (
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 10px' }}>
              {(file.panel || []).length} examiners
              {pendingVet.length
                ? ` — still to Approve / Hold / Reject: ${pendingVet.map((p: any) => p.name.trim()).join(', ')}`
                : ' — all assigned examiners have a vet decision'}
            </p>
          )}
          <div className="table-scroll table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Bucket</th>
                <th>Assigned</th>
                <th>Vet</th>
                <th>Consent</th>
                <th>Reject</th>
              </tr>
            </thead>
            <tbody>
              {(file.panel || []).length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--muted)' }}>
                    No selected examiners to show at this stage.
                  </td>
                </tr>
              )}
              {(file.panel || []).map((p: any, i: number) => {
                const idx = panelIdx(p, i);
                const leftover =
                  !p.assigned &&
                  p.consentStatus !== 'ACCEPTED' &&
                  p.consentStatus !== 'REGRETTED' &&
                  p.vetStatus !== 'REJECTED' &&
                  p.vetStatus !== 'HELD' &&
                  !!String(p.email || '').trim();
                const examinerApproved = !hasExaminerVet || p.vetStatus === 'APPROVED';
                const canOfferRow =
                  stageType === 'CONSENT' &&
                  canMail() &&
                  !!p.assigned &&
                  examinerApproved &&
                  p.vetStatus !== 'REJECTED' &&
                  p.vetStatus !== 'HELD' &&
                  p.consentStatus !== 'ACCEPTED' &&
                  p.consentStatus !== 'REGRETTED' &&
                  String(p.email || '').trim();
                const canProposeRow =
                  stageType === 'CONSENT' &&
                  canMail() &&
                  (leftover ||
                    (!examinerApproved &&
                      p.consentStatus !== 'ACCEPTED' &&
                      p.consentStatus !== 'REGRETTED' &&
                      p.vetStatus !== 'REJECTED' &&
                      p.vetStatus !== 'HELD' &&
                      !!String(p.email || '').trim()));
                const canEvalRow =
                  (stageType === 'DISPATCH_THESIS' || stageType === 'EVALUATE') &&
                  canMail() &&
                  p.assigned &&
                  p.consentStatus === 'ACCEPTED' &&
                  !p.evaluation?.verdict &&
                  String(p.email || '').trim();
                return (
                <tr key={idx}>
                  <td>
                    <button type="button" className="name-link" onClick={() => setExaminerViewer({ ...p, _idx: idx })}>
                      {p.name}
                    </button>
                    {p.practicalRole ? ` · ${String(p.practicalRole).replaceAll('_', ' ')}` : ''}
                    {p.extra ? ' (extra)' : ''}
                    {!p.assigned && leftover ? (
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Leftover — send for approval</div>
                    ) : null}
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.email}</div>
                  </td>
                  <td>{p.bucketCode}</td>
                  <td>
                    {canAssignPanel ? (
                      <input
                        type="checkbox"
                        checked={!!p.assigned}
                        style={{ cursor: 'pointer', width: 16, height: 16 }}
                        onChange={() =>
                          run(() =>
                            post(`/files/${id}/panel/assign`, { indexes: [idx], assigned: !p.assigned }),
                          )
                        }
                      />
                    ) : (
                      <input
                        type="checkbox"
                        checked={!!p.assigned}
                        disabled
                        style={{ width: 16, height: 16 }}
                        title={p.assigned ? 'Assigned' : 'Not assigned'}
                      />
                    )}
                  </td>
                  <td>
                    <Pill status={p.vetStatus} />
                    {data.currentStage?.type === 'PANEL_VET' && (
                      <div className="row" style={{ marginTop: 4 }}>
                        <button
                          type="button"
                          className={p.vetStatus === 'APPROVED' ? 'btn small' : 'btn secondary small'}
                          disabled={p.vetStatus === 'APPROVED'}
                          onClick={() => run(() => post(`/files/${id}/panel/members/${idx}/vet`, { status: 'APPROVED' }))}
                        >
                          {p.vetStatus === 'APPROVED' ? 'Approved' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          className={p.vetStatus === 'HELD' ? 'btn small' : 'btn secondary small'}
                          disabled={p.vetStatus === 'HELD'}
                          onClick={() => run(() => post(`/files/${id}/panel/members/${idx}/vet`, { status: 'HELD', remark }))}
                        >
                          {p.vetStatus === 'HELD' ? 'On hold' : 'Hold'}
                        </button>
                        <button
                          type="button"
                          className={p.vetStatus === 'REJECTED' ? 'btn small' : 'btn secondary small'}
                          disabled={p.vetStatus === 'REJECTED'}
                          onClick={() => run(() => post(`/files/${id}/panel/members/${idx}/vet`, { status: 'REJECTED', remark }))}
                        >
                          {p.vetStatus === 'REJECTED' ? 'Rejected' : 'Reject'}
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    <Pill status={p.consentStatus} />
                    {p.offerSentAt && p.consentStatus === 'PENDING' && (
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Offer sent — waiting for reply</div>
                    )}
                    {canProposeRow && (
                      <div style={{ marginTop: 6 }}>
                        <button
                          type="button"
                          className="btn secondary small"
                          disabled={!!mailLoading}
                          onClick={() =>
                            setConfirmMail({
                              title: 'Send leftover examiner for approval?',
                              message: `Send ${p.name} through the examiner approval route? They will not receive an email until AO / ACE / Associate Dean finish this hop. The file leaves Examiner consent until that routing is complete.`,
                              label: `Sending ${p.name} for approval…`,
                              run: async () => {
                                const r: any = await post(`/files/${id}/panel/members/${idx}/propose`, {});
                                return r.message || `${p.name} sent for approval.`;
                              },
                            })
                          }
                        >
                          Send for approval
                        </button>
                      </div>
                    )}
                    {canOfferRow && (
                        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
                          <button
                            type="button"
                            className="btn secondary small"
                            disabled={!!mailLoading}
                            onClick={() =>
                              confirmWithPreview({
                                title: p.offerSentAt ? 'Resend email?' : 'Send email?',
                                message: `Send the offer letter to ${p.name} (${p.email})? They will request a passcode after opening the link.`,
                                label: `Sending mail to ${p.email}…`,
                                purpose: 'CONSENT',
                                channel: 'EMAIL',
                                examinerName: p.name,
                                to: p.email,
                                toName: p.name,
                                run: async () => {
                                  const r: any = await post(`/files/${id}/panel/members/${idx}/offer`, {});
                                  return r.message || `Offer sent to ${p.email}.`;
                                },
                              })
                            }
                          >
                            {p.offerSentAt ? 'Resend email' : 'Send email'}
                          </button>
                          <button
                            type="button"
                            className="btn secondary small"
                            disabled={!!mailLoading}
                            onClick={() => openMailView(p, 'CONSENT', 'EMAIL')}
                          >
                            View
                          </button>
                        </div>
                      )}
                    {!canOfferRow &&
                      canMail() &&
                      stageType === 'CONSENT' &&
                      (p.offerSentAt || p.consentStatus === 'ACCEPTED' || p.consentStatus === 'REGRETTED') &&
                      String(p.email || '').trim() && (
                        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
                          {(p.consentStatus === 'ACCEPTED' || p.consentStatus === 'REGRETTED') && (
                            <button
                              type="button"
                              className="btn secondary small"
                              onClick={() => setExaminerViewer({ ...p, _idx: idx })}
                            >
                              {p.consentStatus === 'ACCEPTED' ? 'View acceptance' : 'View refusal'}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn secondary small"
                            disabled={!!mailLoading}
                            onClick={() => openMailView(p, 'CONSENT', 'EMAIL')}
                          >
                            View letter
                          </button>
                        </div>
                      )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={p.vetStatus === 'REJECTED' ? 'btn small' : 'btn secondary small'}
                      style={
                        p.vetStatus === 'REJECTED'
                          ? { background: '#fce8e6', color: '#c5221f', borderColor: '#fad2cf', cursor: 'not-allowed' }
                          : { color: 'var(--danger)', borderColor: 'var(--line)' }
                      }
                      disabled={p.vetStatus === 'REJECTED'}
                      onClick={() => run(() => post(`/files/${id}/panel/members/${idx}/vet`, { status: 'REJECTED', remark }))}
                    >
                      {p.vetStatus === 'REJECTED' ? 'Rejected' : 'Reject'}
                    </button>
                    {canViewReports && (() => {
                      const rounds = examinerEvalRounds(p);
                      if (!rounds.length) return null;
                      return (
                        <div style={{ marginTop: 6 }}>
                          <button
                            type="button"
                            className="btn secondary small"
                            onClick={() => setReportViewer({ memberIndex: idx, roundIndex: rounds.length - 1 })}
                          >
                            View report{rounds.length > 1 ? `s (${rounds.length})` : ''}
                          </button>
                        </div>
                      );
                    })()}
                    {canEvalRow && (
                        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
                          <button
                            type="button"
                            className="btn secondary small"
                            disabled={!!mailLoading}
                            onClick={() =>
                              confirmWithPreview({
                                title: p.thesisSentAt ? 'Resend email?' : 'Send email?',
                                message: `Send the thesis / evaluation letter to ${p.name} (${p.email})? They will request a passcode after opening the link.`,
                                label: `Sending mail to ${p.email}…`,
                                purpose: 'EVALUATE',
                                channel: 'EMAIL',
                                examinerName: p.name,
                                to: p.email,
                                toName: p.name,
                                run: async () => {
                                  const r: any = await post(`/files/${id}/panel/members/${idx}/eval`, {});
                                  return r.message || `Thesis letter sent to ${p.email}.`;
                                },
                              })
                            }
                          >
                            {p.thesisSentAt ? 'Resend email' : 'Send email'}
                          </button>
                          <button
                            type="button"
                            className="btn secondary small"
                            disabled={!!mailLoading}
                            onClick={() => openMailView(p, 'EVALUATE', 'EMAIL')}
                          >
                            View
                          </button>
                        </div>
                      )}
                    {!canEvalRow &&
                      canMail() &&
                      (stageType === 'DISPATCH_THESIS' || stageType === 'EVALUATE') &&
                      p.thesisSentAt &&
                      String(p.email || '').trim() && (
                        <div style={{ marginTop: 6 }}>
                          <button
                            type="button"
                            className="btn secondary small"
                            disabled={!!mailLoading}
                            onClick={() => openMailView(p, 'EVALUATE', 'EMAIL')}
                          >
                            View
                          </button>
                        </div>
                      )}
                    {actions.includes('PICK_NTH') &&
                      p.bucketCode === (data.currentStage?.nthBucketCode || 'INDIAN') &&
                      !p.evaluation?.verdict &&
                      p.consentStatus !== 'ACCEPTED' &&
                      p.consentStatus !== 'REGRETTED' && (
                      <button
                        type="button"
                        className="btn small"
                        style={{ marginLeft: 8 }}
                        onClick={() => run(() => post(`/files/${id}/panel/nth`, { index: idx }))}
                      >
                        Pick 4th
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {stageType === 'PANEL_REQUEST' && canMail() && !canBuildPanel && (
            <div style={{ marginTop: 12 }}>
              <p style={{ margin: '0 0 10px', fontSize: 14 }}>
                The panel request has not been sent yet to {file.chiefGuideName || 'the Chief Guide'}
                {file.chiefGuideEmail ? ` (${file.chiefGuideEmail})` : ''}. View the mail first, then send it from Stage action.
              </p>
              <button
                type="button"
                className="btn secondary small"
                disabled={!!mailLoading}
                onClick={() => openMailView(chiefGuidePerson(), 'PANEL_BUILD', 'EMAIL')}
              >
                View mail
              </button>
            </div>
          )}
          {waitingForGuidePanel && !canBuildPanel && (
            <div style={{ marginTop: 12 }}>
              <p style={{ margin: '0 0 10px', fontSize: 14 }}>
                Waiting for Chief Guide {file.chiefGuideName || '—'}
                {file.chiefGuideEmail ? ` (${file.chiefGuideEmail})` : ''} to add examiners and submit the panel.
                Dealing only sends the request mail (task link). The Chief Guide opens the link, clicks Get passcode, then builds the panel.
              </p>
              {(user?.role === 'DEALING' || user?.role === 'INSTITUTE_ADMIN') && (
                <div className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className="btn small"
                    disabled={!!mailLoading}
                    onClick={() =>
                      confirmWithPreview({
                        title: 'Review mail and resend panel request?',
                        message: `Read the mail below, then resend it to ${file.chiefGuideName || 'the Chief Guide'}${file.chiefGuideEmail ? ` (${file.chiefGuideEmail})` : ''}. They open the task link and click Get passcode to receive the passcode in a second email.`,
                        label: 'Sending Chief Guide mail…',
                        purpose: 'PANEL_BUILD',
                        channel: 'EMAIL',
                        to: file.chiefGuideEmail,
                        toName: file.chiefGuideName,
                        run: async () => {
                          const r: any = await post(`/files/${id}/panel/request`, { resend: true });
                          return r.message || `Panel request resent to ${file.chiefGuideEmail}.`;
                        },
                      })
                    }
                  >
                    Resend panel request to {file.chiefGuideName || 'Chief Guide'}
                  </button>
                  <button
                    type="button"
                    className="btn secondary small"
                    disabled={!!mailLoading}
                    onClick={() => openMailView(chiefGuidePerson(), 'PANEL_BUILD', 'EMAIL')}
                  >
                    View sent mail
                  </button>
                </div>
              )}
            </div>
          )}
          {canBuildPanel && waitingForGuidePanel && (
            <div style={{ marginTop: 12 }}>
              <h3>Add examiner</h3>
              <ExaminerPicker
                examiners={knownExaminers}
                member={member}
                buckets={buckets}
                onChange={setMember}
              />
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn secondary small"
                  onClick={() => {
                    const err = validateExaminerDraft(member);
                    if (err) {
                      alert(err);
                      return;
                    }
                    post(`/files/${id}/panel/members`, member)
                      .then(() => {
                        setMember({ ...emptyExaminerDraft(), bucketCode: member.bucketCode });
                        return load();
                      })
                      .catch((e: any) => alert(e.message || 'Failed to add examiner to panel'));
                  }}
                >
                  Add to panel
                </button>
                <button className="btn small" onClick={() => post(`/files/${id}/panel/submit`, {}).then(load)}>
                  Submit panel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
      {infoOpen && (
        <CandidateInfoModal data={data} onClose={() => setInfoOpen(false)} />
      )}
      {examinerViewer && (
        <ExaminerDetailsModal
          member={examinerViewer}
          memberIndex={examinerViewer._idx}
          fileId={id}
          showBank={true}
          buckets={buckets}
          onSave={load}
          onClose={() => setExaminerViewer(null)}
        />
      )}
      {reportViewer && (file.panel?.find((p: any, i: number) => panelIdx(p, i) === reportViewer.memberIndex) || file.panel?.[reportViewer.memberIndex]) && (
        <ExaminerReportModal
          member={file.panel.find((p: any, i: number) => panelIdx(p, i) === reportViewer.memberIndex) || file.panel[reportViewer.memberIndex]}
          documents={file.documents || []}
          meta={{
            candidateName: file.candidate?.name,
            title: file.title,
            fileNo: file.fileNo,
            thesisNumber: file.thesisNumber,
            courseName: data.course?.name,
            courseTypeName: data.courseType?.name,
            specialityName: data.speciality?.name,
          }}
          roundIndex={reportViewer.roundIndex}
          onRound={(roundIndex) => setReportViewer({ ...reportViewer, roundIndex })}
          onClose={() => setReportViewer(null)}
        />
      )}
      {revisionPrint ? <RevisionLetterPrint letters={revisionPrint} onClose={() => setRevisionPrint(null)} /> : null}
      {confirmMail && (
        <ConfirmDialog
          title={confirmMail.title}
          message={confirmMail.message}
          detail={confirmMail.detail}
          yesLabel={confirmMail.detail ? 'Send mail' : 'Yes'}
          noLabel={confirmMail.detail ? 'Cancel' : 'No'}
          onYes={() => runMailJob(confirmMail.label, confirmMail.run)}
          onNo={() => setConfirmMail(null)}
        />
      )}
      {mailView && (
        <div className="modal-overlay" onClick={() => setMailView(null)} role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{mailView.status === 'PREVIEW' ? 'Mail preview' : 'Sent mail'}</h2>
              <button type="button" className="btn secondary small" onClick={() => setMailView(null)}>
                Close
              </button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 8px' }}>
              {mailView.toName || mailView.to
                ? `To ${mailView.toName || ''}${mailView.toName && mailView.to ? ' ' : ''}${mailView.to ? `<${mailView.to}>` : ''}`
                : ''}
              {mailView.status === 'PREVIEW'
                ? ' · This is the mail that will be sent. The portal link is filled in when you send.'
                : mailView.createdAt
                  ? ` · Sent ${new Date(mailView.createdAt).toLocaleString()}`
                  : ' · Sent'}
            </p>
            {mailView.subject ? <p style={{ fontWeight: 600, margin: '0 0 12px' }}>{mailView.subject}</p> : null}
            <MailBodyView body={mailView.body} />
          </div>
        </div>
      )}
      {mailLoading && <PageLoader message={mailLoading} />}
      {mailResult && (
        <ResultDialog
          ok={mailResult.ok}
          message={mailResult.message}
          onClose={() => setMailResult(null)}
        />
      )}
    </Shell>
  );
}

function dash(value?: string | number | null) {
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

function panelIdx(p: any, i: number) {
  return typeof p?.panelIndex === 'number' ? p.panelIndex : i;
}

function slotLabel(slot?: string) {
  const map: Record<string, string> = {
    ACE: 'ACE',
    AO: 'AO',
    DEAN: 'Dean',
    ASSOC_DEAN: 'Associate Dean',
  };
  return slot ? map[slot] || slot.replaceAll('_', ' ') : '';
}

function stageGoesTo(data: any, file: any) {
  const stage = data.currentStage;
  if (!stage) return '';
  const guide = file.chiefGuideName || data.chiefGuide?.name;
  const email = file.chiefGuideEmail || data.chiefGuide?.email;
  const guideLine = guide ? `Chief Guide ${guide}${email ? ` (${email})` : ''}` : 'Chief Guide';
  if (stage.type === 'PANEL_REQUEST' || stage.code === 'panel_request') {
    return `waiting with Dealing Desk. Dealing sends the request to ${guideLine}`;
  }
  if (stage.actorRole === 'GUIDE') return `with ${guideLine}`;
  if (stage.actorRole === 'DEALING') return 'with Dealing Desk';
  if (isCourseRole(stage.actorRole)) {
    return `with ${data.course?.name || 'Course'}`;
  }
  if (stage.actorRole === 'ACADEMIC') return 'with Institute Admin';
  if (stage.actorRole === 'AUTHORITY') {
    return `with ${slotLabel(stage.authoritySlot) || 'authority'}`;
  }
  if (stage.actorRole === 'EXAMINER') return 'with examiners';
  return stage.actorRole ? `with ${String(stage.actorRole).replaceAll('_', ' ')}` : '';
}

function stageActorLabel(data: any, file: any) {
  const stage = data.currentStage;
  if (!stage) return '';
  const guide = file.chiefGuideName || data.chiefGuide?.name;
  const email = file.chiefGuideEmail || data.chiefGuide?.email;
  const guideLine = guide ? `Chief Guide ${guide}${email ? ` (${email})` : ''}` : 'Chief Guide';
  if (stage.actorRole === 'GUIDE') return guideLine;
  if (stage.actorRole === 'DEALING') return 'Dealing Desk';
  if (isCourseRole(stage.actorRole)) return data.course?.name || 'Course';
  if (stage.actorRole === 'ACADEMIC') return 'Institute Admin';
  if (stage.actorRole === 'AUTHORITY') return slotLabel(stage.authoritySlot) || 'authority';
  if (stage.actorRole === 'EXAMINER') return 'examiners';
  return stage.actorRole ? String(stage.actorRole).replaceAll('_', ' ') : '';
}

function stageLoginHint(data: any, file: any) {
  const stage = data.currentStage;
  if (!stage) return '';
  if (stage.type === 'PANEL_REQUEST' || stage.code === 'panel_request') {
    return `Sign in as Dealing to request the panel from ${file.chiefGuideName || 'the Chief Guide'}.`;
  }
  if (stage.actorRole === 'DEALING') return 'Sign in as Dealing to act on this stage.';
  if (stage.actorRole === 'GUIDE') {
    return 'The Chief Guide acts from the emailed task link, not this staff login.';
  }
  if (stage.actorRole === 'AUTHORITY') {
    return `Sign in as ${slotLabel(stage.authoritySlot) || 'the assigned authority'} to act on this stage.`;
  }
  if (isCourseRole(stage.actorRole)) return 'Sign in as Academic to act on this stage.';
  if (stage.actorRole === 'ACADEMIC') return 'Sign in as Institute Admin to act on this stage.';
  return stage.actorRole ? `Sign in as ${String(stage.actorRole).replaceAll('_', ' ')} to act on this stage.` : '';
}

function examinerEvalRounds(member: any) {
  const history: any[] = member?.evaluationHistory || [];
  const rounds = history.map((h, i) => ({
    ...h,
    key: `h-${i}`,
    label: 'Previous',
  }));
  if (member?.evaluation?.verdict) {
    rounds.push({
      ...member.evaluation,
      key: 'current',
      label: 'Latest',
    });
  }
  return rounds;
}

function ExaminerReportModal({
  member,
  documents,
  meta,
  roundIndex,
  onRound,
  onClose,
}: {
  member: any;
  documents: any[];
  meta: {
    candidateName?: string;
    title?: string;
    fileNo?: string;
    thesisNumber?: string;
    courseName?: string;
    courseTypeName?: string;
    specialityName?: string;
  };
  roundIndex: number;
  onRound: (index: number) => void;
  onClose: () => void;
}) {
  const rounds = examinerEvalRounds(member);
  const selected = rounds[Math.min(Math.max(roundIndex, 0), Math.max(rounds.length - 1, 0))];
  const thesis = thesisByVersion(documents, selected?.documentVersion);

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-card modal-card-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="examiner-report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head no-print">
          <h2 id="examiner-report-title">{member.name || 'Examiner'} — evaluation report</h2>
          <div className="row">
            <button type="button" className="btn small" onClick={() => window.print()}>
              Print
            </button>
            <button type="button" className="btn secondary small" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <p className="guide-muted no-print" style={{ marginTop: 0 }}>
          {member.email}
        </p>
        {rounds.length > 1 && (
          <div className="eval-rounds no-print">
            {rounds.map((round, i) => (
              <button
                key={round.key}
                type="button"
                className={i === roundIndex ? 'btn small' : 'btn secondary small'}
                onClick={() => onRound(i)}
              >
                {round.label}: {evaluationVerdictLabel(round.verdict)}
                {round.documentVersion ? ` · v${round.documentVersion}` : ''}
                {round.submittedAt ? ` · ${new Date(round.submittedAt).toLocaleDateString()}` : ''}
              </button>
            ))}
          </div>
        )}
        {!rounds.length ? (
          <p className="guide-muted">No evaluation report for this examiner yet.</p>
        ) : (
          <>
            {thesis ? (
              <div className="no-print" style={{ margin: '12px 0' }}>
                <div className="row" style={{ marginBottom: 8 }}>
                  <span>
                    v{thesis.version} {thesis.originalName}
                  </span>
                  <a className="btn secondary small" href={`/api/uploads/${thesis.path}`} target="_blank" rel="noreferrer">
                    Download
                  </a>
                </div>
                <iframe className="thesis-frame thesis-frame-compact" title="Evaluated thesis PDF" src={`/api/uploads/${thesis.path}`} />
              </div>
            ) : null}
            <div className="eval-print-area">
              <p className="eval-print-examiner">
                Examiner: {member.name || '—'}
                {member.email ? ` · ${member.email}` : ''}
                {selected?.submittedAt ? ` · ${new Date(selected.submittedAt).toLocaleString()}` : ''}
              </p>
              <EvaluationForm meta={meta} value={toEvaluationValue(selected)} readOnly />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value, wide }: { label: string; value?: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'info-row info-span-2' : 'info-row'}>
      <dt>{label}</dt>
      <dd>{value || '—'}</dd>
    </div>
  );
}

function ExaminerDetailsModal({
  member,
  memberIndex,
  fileId,
  showBank,
  buckets = [],
  onSave,
  onClose,
}: {
  member: any;
  memberIndex?: number;
  fileId?: string;
  showBank: boolean;
  buckets?: { code: string; label: string; count?: number }[];
  onSave?: () => void;
  onClose: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [currentMember, setCurrentMember] = useState(member);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [chequeFile, setChequeFile] = useState<File | null>(null);

  useEffect(() => {
    setCurrentMember(member);
  }, [member]);

  const bank = currentMember.bank || {};
  const [form, setForm] = useState({
    name: currentMember.name || '',
    designation: currentMember.designation || '',
    department: currentMember.department || '',
    affiliation: currentMember.affiliation || '',
    address: currentMember.address || '',
    city: currentMember.city || '',
    country: currentMember.country || '',
    bucketCode: currentMember.bucketCode || '',
    mobile: currentMember.mobile || '',
    alternateMobile: currentMember.alternateMobile || '',
    email: currentMember.email || '',
    alternateEmail: currentMember.alternateEmail || '',
    holderName: bank.holderName || '',
    bankName: bank.bankName || '',
    branchAddress: bank.branchAddress || '',
    ifsc: bank.ifsc || '',
    accountType: bank.accountType || 'Saving',
    account: bank.account || '',
    pan: bank.pan || '',
    consentStatus: currentMember.consentStatus || 'PENDING',
    consentRemark: currentMember.consentRemark || '',
  });

  const syncForm = (m: any) => {
    const b = m.bank || {};
    setForm({
      name: m.name || '',
      designation: m.designation || '',
      department: m.department || '',
      affiliation: m.affiliation || '',
      address: m.address || '',
      city: m.city || '',
      country: m.country || '',
      bucketCode: m.bucketCode || '',
      mobile: m.mobile || '',
      alternateMobile: m.alternateMobile || '',
      email: m.email || '',
      alternateEmail: m.alternateEmail || '',
      holderName: b.holderName || '',
      bankName: b.bankName || '',
      branchAddress: b.branchAddress || '',
      ifsc: b.ifsc || '',
      accountType: b.accountType || 'Saving',
      account: b.account || '',
      pan: b.pan || '',
      consentStatus: m.consentStatus || 'PENDING',
      consentRemark: m.consentRemark || '',
    });
    setChequeFile(null);
  };

  const handleStartEdit = () => {
    syncForm(currentMember);
    setError(null);
    setSuccessMsg(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    syncForm(currentMember);
    setError(null);
    setIsEditing(false);
  };

  async function handleSave(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (typeof memberIndex !== 'number' || !fileId) return;
    if (!form.name || !form.name.trim()) {
      setError('Examiner name is required');
      return;
    }
    if (!form.email || !form.email.trim()) {
      setError('Examiner email is required');
      return;
    }
    if (!isValidEmail(form.email)) {
      setError('Examiner email is not a valid email address');
      return;
    }
    if (form.alternateEmail && form.alternateEmail.trim() !== '' && !isValidEmail(form.alternateEmail)) {
      setError('Alternate email is not a valid email address');
      return;
    }
    if (form.mobile && form.mobile.trim() !== '') {
      const mob = cleanMobile(form.mobile);
      if (!isValidMobile(mob)) {
        setError('Mobile must be a valid 10-digit Indian number starting with 6-9');
        return;
      }
    }
    if (form.alternateMobile && form.alternateMobile.trim() !== '') {
      const altMob = cleanMobile(form.alternateMobile);
      if (!isValidMobile(altMob)) {
        setError('Alternate mobile must be a valid 10-digit Indian number starting with 6-9');
        return;
      }
    }
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      let updated: any;
      if (chequeFile) {
        const fd = new FormData();
        Object.entries(form).forEach(([k, v]) => {
          if (v !== undefined && v !== null) fd.append(k, String(v));
        });
        fd.append('cheque', chequeFile);
        updated = await patch(`/files/${fileId}/panel/members/${memberIndex}`, fd);
      } else {
        updated = await patch(`/files/${fileId}/panel/members/${memberIndex}`, form);
      }
      setSaving(false);
      setSuccessMsg('Examiner details updated successfully.');
      const updatedMember = updated?.panel?.[memberIndex] || {
        ...currentMember,
        ...form,
        bank: {
          ...(currentMember.bank || {}),
          holderName: form.holderName,
          bankName: form.bankName,
          branchAddress: form.branchAddress,
          ifsc: form.ifsc,
          accountType: form.accountType,
          account: form.account,
          pan: form.pan,
        },
      };
      setCurrentMember(updatedMember);
      if (onSave) onSave();
      setIsEditing(false);
    } catch (err: any) {
      setSaving(false);
      setError(err?.message || 'Failed to update examiner details');
    }
  }

  const accepted = currentMember.consentStatus === 'ACCEPTED';
  const regretted = currentMember.consentStatus === 'REGRETTED';
  const chequePath = (currentMember.bank || {}).cancelledChequePath;
  const decision = accepted ? 'Accepted examinership' : regretted ? 'Unable to accept' : 'Acceptance not submitted yet';
  const canEdit = typeof memberIndex === 'number' && Boolean(fileId);

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-card modal-card-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="examiner-details-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head no-print">
          <h2 id="examiner-details-title">
            {currentMember.name || 'Examiner'} — {isEditing ? 'edit details' : 'details'}
          </h2>
          <div className="row" style={{ gap: 8 }}>
            {canEdit && !isEditing && (
              <button type="button" className="btn small" onClick={handleStartEdit}>
                ✎ Edit details
              </button>
            )}
            {isEditing && (
              <button
                type="submit"
                form="examiner-edit-form"
                className="btn small"
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            )}
            {isEditing && (
              <button
                type="button"
                className="btn secondary small"
                disabled={saving}
                onClick={handleCancel}
              >
                Cancel
              </button>
            )}
            {!isEditing && (
              <button type="button" className="btn secondary small" onClick={() => window.print()}>
                Print
              </button>
            )}
            <button type="button" className="btn secondary small" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="examiner-details-body">
          {successMsg && <div className="okbox" style={{ marginBottom: 16 }}>{successMsg}</div>}
          {error && <div style={{ marginBottom: 16 }}><ErrorBox error={error} /></div>}

          {!isEditing ? (
            <>
              <div className="info-section" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                <h3>Offer response</h3>
                <dl className="info-dl">
                  <InfoRow label="Decision" value={decision} />
                  <InfoRow label="Consent status" value={<Pill status={currentMember.consentStatus} />} />
                  <InfoRow
                    label="Offer sent"
                    value={currentMember.offerSentAt ? new Date(currentMember.offerSentAt).toLocaleString() : undefined}
                  />
                  {regretted ? (
                    <InfoRow label="Reason for refusal" value={currentMember.consentRemark} wide />
                  ) : null}
                </dl>
              </div>
              <div className="info-section">
                <h3>Examiner details</h3>
                <p className="guide-muted" style={{ marginTop: 0 }}>
                  {accepted
                    ? 'These are the fields the examiner submitted with acceptance.'
                    : 'These are the same fields collected on the acceptance form. Values fill in after the examiner submits.'}
                </p>
                <dl className="info-dl">
                  <InfoRow label="Name" value={currentMember.name} />
                  <InfoRow label="Designation" value={currentMember.designation} />
                  <InfoRow label="Department" value={currentMember.department} />
                  <InfoRow label="Institute" value={currentMember.affiliation} />
                  <InfoRow label="Address" value={currentMember.address} wide />
                  <InfoRow label="Mobile no. (for SMS)" value={currentMember.mobile} />
                  <InfoRow label="Alternate mobile" value={currentMember.alternateMobile} />
                  <InfoRow label="Email" value={currentMember.email} />
                  <InfoRow label="Alternate email" value={currentMember.alternateEmail} />
                  {currentMember.city || currentMember.country ? (
                    <InfoRow label="City / country" value={[currentMember.city, currentMember.country].filter(Boolean).join(', ')} />
                  ) : null}
                  {currentMember.bucketCode ? <InfoRow label="Bucket" value={currentMember.bucketCode} /> : null}
                </dl>
              </div>
              {showBank && (
                <>
                  <div className="info-section">
                    <h3>Cancelled cheque</h3>
                    {chequePath ? (
                      <div>
                        {/\.pdf$/i.test(chequePath) ? (
                          <p className="info-empty">Cancelled cheque uploaded as a PDF.</p>
                        ) : (
                          <img className="cheque-preview" src={`/api/uploads/${chequePath}`} alt="Cancelled cheque" />
                        )}
                        <div style={{ marginTop: 8 }}>
                          <a className="btn secondary small" href={`/api/uploads/${chequePath}`} target="_blank" rel="noreferrer">
                            Open cheque
                          </a>
                        </div>
                      </div>
                    ) : (
                      <p className="info-empty">{accepted ? 'No cancelled cheque on file.' : 'Uploaded after the examiner accepts.'}</p>
                    )}
                  </div>
                  <div className="info-section">
                    <h3>Bank details for remuneration</h3>
                    <dl className="info-dl">
                      <InfoRow label="Name of examiner (as provided in bank)" value={bank.holderName} />
                      <InfoRow label="Bank name" value={bank.bankName} />
                      <InfoRow label="Branch name with bank address" value={bank.branchAddress} wide />
                      <InfoRow label="IFSC code" value={bank.ifsc} />
                      <InfoRow label="Account type" value={bank.accountType} />
                      <InfoRow label="Account number" value={bank.account} />
                      <InfoRow label="PAN number" value={bank.pan} />
                    </dl>
                  </div>
                </>
              )}
            </>
          ) : (
            <form id="examiner-edit-form" onSubmit={handleSave}>
              <div className="info-section" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                <h3>Examiner details</h3>
                <p className="guide-muted" style={{ marginTop: 0 }}>
                  Update the examiner contact and institutional details below.
                </p>
                <div className="grid cols-2" style={{ marginTop: 12 }}>
                  <Field label="Name" required>
                    <input
                      className="input"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Designation">
                    <input
                      className="input"
                      value={form.designation}
                      onChange={(e) => setForm({ ...form, designation: e.target.value })}
                    />
                  </Field>
                  <Field label="Department">
                    <input
                      className="input"
                      value={form.department}
                      onChange={(e) => setForm({ ...form, department: e.target.value })}
                    />
                  </Field>
                  <Field label="Institute">
                    <input
                      className="input"
                      value={form.affiliation}
                      onChange={(e) => setForm({ ...form, affiliation: e.target.value })}
                    />
                  </Field>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field label="Address">
                      <input
                        className="input"
                        value={form.address}
                        onChange={(e) => setForm({ ...form, address: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label="City">
                    <input
                      className="input"
                      value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                    />
                  </Field>
                  <Field label="Country">
                    <input
                      className="input"
                      value={form.country}
                      onChange={(e) => setForm({ ...form, country: e.target.value })}
                    />
                  </Field>
                  <Field label="Bucket">
                    {buckets.length > 0 ? (
                      <select
                        className="input"
                        value={form.bucketCode}
                        onChange={(e) => setForm({ ...form, bucketCode: e.target.value })}
                      >
                        <option value="">Select bucket</option>
                        {buckets.map((b) => (
                          <option key={b.code} value={b.code}>
                            {b.label || b.code}
                          </option>
                        ))}
                        {form.bucketCode && !buckets.some((b) => b.code === form.bucketCode) && (
                          <option value={form.bucketCode}>{form.bucketCode}</option>
                        )}
                      </select>
                    ) : (
                      <input
                        className="input"
                        value={form.bucketCode}
                        onChange={(e) => setForm({ ...form, bucketCode: e.target.value.toUpperCase() })}
                      />
                    )}
                  </Field>
                  <Field label="Mobile no. (for SMS)">
                    <input
                      className="input"
                      maxLength={10}
                      placeholder="10-digit mobile"
                      value={form.mobile}
                      onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                    />
                    {form.mobile && !isValidMobile(form.mobile) && (
                      <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                        Must be 10 digits starting with 6, 7, 8, or 9
                      </span>
                    )}
                  </Field>
                  <Field label="Alternate mobile">
                    <input
                      className="input"
                      maxLength={10}
                      placeholder="10-digit mobile"
                      value={form.alternateMobile}
                      onChange={(e) => setForm({ ...form, alternateMobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                    />
                    {form.alternateMobile && !isValidMobile(form.alternateMobile) && (
                      <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                        Must be 10 digits starting with 6, 7, 8, or 9
                      </span>
                    )}
                  </Field>
                  <Field label="Email" required>
                    <input
                      className="input"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      required
                    />
                    {form.email && !isValidEmail(form.email) && (
                      <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                        Please enter a valid email address
                      </span>
                    )}
                  </Field>
                  <Field label="Alternate email">
                    <input
                      className="input"
                      type="email"
                      value={form.alternateEmail}
                      onChange={(e) => setForm({ ...form, alternateEmail: e.target.value })}
                    />
                    {form.alternateEmail && !isValidEmail(form.alternateEmail) && (
                      <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                        Please enter a valid alternate email address
                      </span>
                    )}
                  </Field>
                </div>
              </div>

              {showBank && (
                <>
                  <div className="info-section">
                    <h3>Cancelled cheque</h3>
                    {chequePath && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Current cheque on file:</div>
                        {/\.pdf$/i.test(chequePath) ? (
                          <a className="btn secondary small" href={`/api/uploads/${chequePath}`} target="_blank" rel="noreferrer">
                            PDF cheque — open
                          </a>
                        ) : (
                          <img className="cheque-preview" src={`/api/uploads/${chequePath}`} alt="Cancelled cheque" />
                        )}
                      </div>
                    )}
                    <Field label="Upload / replace cancelled cheque (JPG or PNG)">
                      <input
                        className="input"
                        type="file"
                        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                        onChange={(e) => setChequeFile(e.target.files?.[0] || null)}
                      />
                    </Field>
                    <p className="guide-muted" style={{ marginTop: 4 }}>
                      Bank name, bank address, account number, IFSC and holder name should be clear on the cheque.
                    </p>
                  </div>

                  <div className="info-section">
                    <h3>Bank details for remuneration</h3>
                    <div className="grid cols-2" style={{ marginTop: 12 }}>
                      <Field label="Name of examiner (as provided in bank)">
                        <input
                          className="input"
                          value={form.holderName}
                          onChange={(e) => setForm({ ...form, holderName: e.target.value })}
                        />
                      </Field>
                      <Field label="Bank name">
                        <input
                          className="input"
                          value={form.bankName}
                          onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                        />
                      </Field>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <Field label="Branch name with bank address">
                          <input
                            className="input"
                            value={form.branchAddress}
                            onChange={(e) => setForm({ ...form, branchAddress: e.target.value })}
                          />
                        </Field>
                      </div>
                      <Field label="IFSC code">
                        <input
                          className="input"
                          value={form.ifsc}
                          placeholder="e.g. SBIN0001234"
                          onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })}
                        />
                      </Field>
                      <Field label="Account type">
                        <select
                          className="input"
                          value={form.accountType || 'Saving'}
                          onChange={(e) => setForm({ ...form, accountType: e.target.value })}
                        >
                          <option value="Saving">Saving</option>
                          <option value="Current">Current</option>
                        </select>
                      </Field>
                      <Field label="Account number">
                        <input
                          className="input"
                          value={form.account}
                          onChange={(e) => setForm({ ...form, account: e.target.value })}
                        />
                      </Field>
                      <Field label="PAN number">
                        <input
                          className="input"
                          maxLength={10}
                          value={form.pan}
                          placeholder="e.g. ABCDE1234F"
                          style={{ textTransform: 'uppercase' }}
                          onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
                        />
                      </Field>
                    </div>
                  </div>
                </>
              )}

              <div className="info-section">
                <h3>Offer & consent status</h3>
                <div className="grid cols-2" style={{ marginTop: 12 }}>
                  <Field label="Consent status">
                    <select
                      className="input"
                      value={form.consentStatus}
                      onChange={(e) => setForm({ ...form, consentStatus: e.target.value })}
                    >
                      <option value="PENDING">PENDING</option>
                      <option value="ACCEPTED">ACCEPTED</option>
                      <option value="REGRETTED">REGRETTED (Refusal)</option>
                    </select>
                  </Field>
                  <Field label="Reason for refusal / remark">
                    <input
                      className="input"
                      value={form.consentRemark}
                      onChange={(e) => setForm({ ...form, consentRemark: e.target.value })}
                    />
                  </Field>
                </div>
              </div>

              <div className="row" style={{ marginTop: 24, justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={saving}
                  onClick={handleCancel}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn"
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function CandidateInfoModal({ data, onClose }: { data: any; onClose: () => void }) {
  const file = data.file;
  const c = file.candidate || {};
  const guide = data.chiefGuide || {};
  const session = data.session
    ? [data.session.month, data.session.year].filter(Boolean).join(' ')
    : '';
  const coGuides: any[] = data.coGuides || [];
  const allowCoGuides = (data.blueprint?.guidePolicy?.maxCoGuides ?? 0) > 0;
  const showCoGuides = coGuides.length > 0 || allowCoGuides;

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="candidate-info-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="candidate-info-title">Candidate information</h2>
          <button type="button" className="btn secondary small" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="info-section">
          <h3>Candidate</h3>
          <dl className="info-dl">
            <InfoRow label="Name" value={c.name} />
            <InfoRow label="Enrollment no." value={c.enrollmentNo} />
            <InfoRow label="Date of birth" value={c.dob} />
            <InfoRow label="Mobile" value={c.mobile} />
            <InfoRow label="Email" value={c.email} />
          </dl>
        </div>
        <div className="info-section">
          <h3>Thesis</h3>
          <dl className="info-dl">
            <InfoRow label="Title" value={file.title} />
            <InfoRow label="File no." value={file.fileNo} />
            <InfoRow label="Thesis no." value={file.thesisNumber} />
            <InfoRow label="Status" value={file.status} />
            <InfoRow label="Blueprint" value={data.blueprint?.name} />
          </dl>
        </div>
        <div className="info-section">
          <h3>Department &amp; course</h3>
          <dl className="info-dl">
            <InfoRow label="Department" value={data.department?.name} />
            <InfoRow label="Course type" value={data.courseType?.name} />
            <InfoRow label="Course" value={data.course?.name} />
            <InfoRow label="Speciality" value={data.speciality?.name} />
            <InfoRow label="Session" value={session} />
          </dl>
        </div>
        <div className="info-section">
          <h3>Chief Guide</h3>
          <dl className="info-dl">
            <InfoRow label="Name" value={guide.name || file.chiefGuideName} />
            <InfoRow label="Email" value={guide.email || file.chiefGuideEmail} />
            <InfoRow label="Designation" value={guide.designation} />
            <InfoRow label="Mobile" value={guide.mobile} />
            <InfoRow label="Affiliation" value={guide.affiliation} />
          </dl>
        </div>
        {showCoGuides && (
        <div className="info-section">
          <h3>Co-guides</h3>
          {coGuides.length ? (
            <ul className="info-list">
              {coGuides.map((g) => (
                <li key={g._id || g.email}>
                  {g.name}
                  {g.designation ? ` · ${g.designation}` : ''}
                  {g.email ? ` · ${g.email}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="info-empty">No co-guides assigned</p>
          )}
        </div>
        )}
        <div className="info-section">
          <h3>Current workflow</h3>
          <dl className="info-dl">
            <InfoRow label="Stage" value={data.currentStage?.name} />
            <InfoRow label="Waiting with" value={stageGoesTo(data, file) || dash(data.currentStage?.actorRole)} />
          </dl>
        </div>
      </div>
    </div>
  );
}

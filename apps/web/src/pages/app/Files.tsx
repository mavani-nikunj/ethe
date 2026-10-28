import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, patch, post } from '../../api';
import { Shell } from '../../components/Shell';
import { useAuth } from '../../auth';
import { isCourseRole, INBOX_LANE_LABELS } from '@ethesis/shared';
import { ConfirmDialog, Empty, ErrorBox, ExportButtons, Field, Pill } from '../../components/ui';
import { SessionFilter } from '../../components/SessionFilter';
import { applySessionParams, useSessionFilter } from '../../session';
import { compareByCourseThenCandidate } from '../../fileSort';

/** Course ids a Dealing / Authority login is limited to by Staff mapping (null = every course). */
function staffCourseScope(user: any): Set<string> | null {
  if (!['DEALING', 'AUTHORITY'].includes(user?.role) || !user?.courseIds?.length) return null;
  return new Set(user.courseIds.map(String));
}

/** Departments and specialities of the mapped courses only; the selected value always stays listed. */
function scopeLookups(user: any, courses: any[], depts: any[], specialities: any[], departmentId: string, specialityId: string) {
  const scope = staffCourseScope(user);
  if (!scope) return { scopedDepts: depts, scopedSpecs: specialities };
  const deptIds = new Set(courses.filter((c) => scope.has(String(c._id))).map((c) => String(c.departmentId || '')));
  return {
    scopedDepts: depts.filter((d) => deptIds.has(String(d._id)) || String(d._id) === String(departmentId)),
    scopedSpecs: specialities.filter(
      (s) => !s.courseId || scope.has(String(s.courseId)) || String(s._id) === String(specialityId)
    ),
  };
}

function needsThesisNumber(r: any) {
  if (r.status === 'DRAFT' || r.status === 'ON_HOLD' || r.status === 'REJECTED') return false;
  return r.lane === 'NEED_NUMBER' || r.currentStageCode === 'assign_number';
}

type NumberingProps = {
  selected: string[];
  numbers: Record<string, string>;
  busy?: boolean;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  onNumberChange: (id: string, value: string) => void;
  onSaveOne: (id: string) => void;
};

type ApprovalProps = {
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
};

/** ACE / Associate Dean: tick files waiting at their plain Approve stage and approve them together. */
function useBulkApprove(
  rows: any[],
  reload: () => Promise<unknown> | void,
  setOk: (m: string | null) => void,
  setError: (m: string | null) => void,
) {
  const [picked, setPicked] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const approvableIds = rows.filter((r) => r.canBulkApprove).map((r) => r._id);
  const selected = picked.filter((id) => approvableIds.includes(id));

  function request() {
    setError(null);
    setOk(null);
    if (!selected.length) {
      setError('Select at least 1 row to approve');
      return;
    }
    setConfirmOpen(true);
  }

  async function run() {
    setConfirmOpen(false);
    setApproving(true);
    setError(null);
    setOk(null);
    try {
      const result = await post('/files/bulk-approve', { ids: selected });
      const approved: string[] = result.approved || [];
      const failed: { id: string; message: string }[] = result.failed || [];
      if (approved.length) setOk(`Approved ${approved.length} file${approved.length === 1 ? '' : 's'}.`);
      if (failed.length) {
        setError(
          failed
            .map((x) => {
              const row = rows.find((r) => r._id === x.id);
              return `${row?.candidate?.name || row?.candidate?.enrollmentNo || x.id}: ${x.message}`;
            })
            .join(' '),
        );
      }
      setPicked([]);
      await reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setApproving(false);
    }
  }

  const approval: ApprovalProps | undefined = approvableIds.length
    ? {
        selected,
        onToggle: (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])),
        onToggleAll: (ids) => setPicked(ids),
      }
    : undefined;

  return { approval, selected, approving, confirmOpen, setConfirmOpen, request, run };
}

const PANEL_REQUEST_CHUNK = 25;

/**
 * Dealing: tick files and mail each Chief Guide in one go (one mail per file).
 * mode 'request' = first ask at the Request-panel step; mode 'resend' = mail the CG again at the panel-build step.
 */
function useBulkPanelRequest(
  rows: any[],
  reload: () => Promise<unknown> | void,
  setOk: (m: string | null) => void,
  setError: (m: string | null) => void,
  mode: 'request' | 'resend' = 'request',
) {
  const isResend = mode === 'resend';
  const eligibleField = isResend ? 'canBulkResendPanel' : 'canBulkRequestPanel';
  const endpoint = isResend ? '/files/bulk-resend-panel' : '/files/bulk-request-panel';
  const verb = isResend ? 'Resend' : 'Send';
  const [picked, setPicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{ message: string; detail?: string } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const eligibleIds = rows.filter((r) => r[eligibleField]).map((r) => r._id);
  const selected = picked.filter((id) => eligibleIds.includes(id));
  const sending = progress !== null;

  async function request() {
    setError(null);
    setOk(null);
    if (!selected.length) {
      setError(`Select at least 1 row to ${verb.toLowerCase()} the panel request`);
      return;
    }
    const picks = rows.filter((r) => selected.includes(r._id));
    const guides = new Set(picks.map((r) => String(r.chiefGuideEmail || '').toLowerCase()));
    const message =
      `${verb} ${picks.length} panel request mail${picks.length === 1 ? '' : 's'} to ` +
      `${guides.size} Chief Guide${guides.size === 1 ? '' : 's'}? Each file gets its own mail and task link, ` +
      `so a Chief Guide with several candidates receives one mail per candidate. Sample mail for ` +
      `${picks[0].candidate?.name || 'the first file'}:`;
    setLoadingPreview(true);
    try {
      const preview: any = await get(
        `/comms/preview?${new URLSearchParams({ fileId: picks[0]._id, purpose: 'PANEL_BUILD', channel: 'EMAIL' })}`,
      );
      const who = [picks[0].chiefGuideName, picks[0].chiefGuideEmail ? `<${picks[0].chiefGuideEmail}>` : '']
        .filter(Boolean)
        .join(' ');
      const detail = [who ? `To: ${who}` : '', preview?.subject ? `Subject: ${preview.subject}` : '', preview?.body || '']
        .filter(Boolean)
        .join('\n\n');
      setConfirm({ message, detail });
    } catch {
      setConfirm({ message: message.replace(/ Sample mail for .*$/, '') });
    } finally {
      setLoadingPreview(false);
    }
  }

  async function run() {
    setConfirm(null);
    setError(null);
    setOk(null);
    const ids = [...selected];
    const sent: string[] = [];
    const failed: { id: string; message: string }[] = [];
    setProgress({ done: 0, total: ids.length });
    try {
      for (let i = 0; i < ids.length; i += PANEL_REQUEST_CHUNK) {
        const chunk = ids.slice(i, i + PANEL_REQUEST_CHUNK);
        try {
          const result = await post(endpoint, { ids: chunk });
          sent.push(...(result.sent || []).map((x: any) => x.id));
          failed.push(...(result.failed || []));
        } catch (e: any) {
          failed.push(...chunk.map((id) => ({ id, message: e.message || 'Could not request panel' })));
        }
        setProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
      }
      if (sent.length)
        setOk(`Panel request ${isResend ? 'resent' : 'sent'} for ${sent.length} file${sent.length === 1 ? '' : 's'}.`);
      if (failed.length) {
        setError(
          failed
            .map((x) => {
              const row = rows.find((r) => r._id === x.id);
              return `${row?.candidate?.name || row?.candidate?.enrollmentNo || x.id}: ${x.message}`;
            })
            .join(' '),
        );
      }
      setPicked([]);
      await reload();
    } finally {
      setProgress(null);
    }
  }

  const selection: ApprovalProps | undefined = eligibleIds.length
    ? {
        selected,
        onToggle: (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])),
        onToggleAll: (ids) => setPicked(ids),
      }
    : undefined;

  const buttonLabel = progress
    ? `Sending ${progress.done} / ${progress.total}…`
    : loadingPreview
      ? 'Loading mail…'
      : isResend
        ? `Resend panel to CG (${selected.length})`
        : `Request panel from CG (${selected.length})`;

  return { selection, selected, sending, loadingPreview, buttonLabel, confirm, setConfirm, request, run };
}

type BulkPick = ApprovalProps & { field: string };

/**
 * Dealing / Assoc Dean: tick files at one step and run a single body-less action over all of them
 * (send reminder, dispatch/send letter, vet-approve, or close). Each file goes through the same
 * server-side guards as the single-file action; unqualified files come back as failures.
 */
function useBulkAct(
  rows: any[],
  reload: () => Promise<unknown> | void,
  setOk: (m: string | null) => void,
  setError: (m: string | null) => void,
  cfg: { kind: 'REMINDER' | 'DISPATCH' | 'VET_APPROVE' | 'CLOSE'; field: string; verb: string },
) {
  const [picked, setPicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const eligibleIds = rows.filter((r) => r[cfg.field]).map((r) => r._id);
  const selected = picked.filter((id) => eligibleIds.includes(id));
  const selection: BulkPick | undefined = eligibleIds.length
    ? {
        field: cfg.field,
        selected,
        onToggle: (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])),
        onToggleAll: (ids) => setPicked(ids),
      }
    : undefined;

  async function run() {
    setConfirm(false);
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res: any = await post('/files/bulk-act', { ids: selected, kind: cfg.kind });
      const done = (res.done || []).length;
      const failed = res.failed || [];
      if (done) setOk(`${cfg.verb} done for ${done} file${done === 1 ? '' : 's'}.`);
      if (failed.length) {
        setError(
          failed
            .map((x: any) => {
              const row = rows.find((r) => r._id === x.id);
              return `${row?.candidate?.name || row?.candidate?.enrollmentNo || x.id}: ${x.message}`;
            })
            .join(' '),
        );
      }
      setPicked([]);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return { selection, selected, busy, confirm, setConfirm, run };
}

type BulkActHook = ReturnType<typeof useBulkAct>;

/** Only one simple bulk action applies to a filtered list at a time; pick it by priority and build its UI copy. */
function pickSimpleBulk(hooks: {
  reminderBulk: BulkActHook;
  dispatchBulk: BulkActHook;
  vetBulk: BulkActHook;
  closeBulk: BulkActHook;
}) {
  const { reminderBulk, dispatchBulk, vetBulk, closeBulk } = hooks;
  if (reminderBulk.selection)
    return {
      hook: reminderBulk,
      label: 'send reminder',
      button: `Send reminder (${reminderBulk.selected.length})`,
      title: 'Send evaluation reminders?',
      message: `Send reminder mails to the examiners of ${reminderBulk.selected.length} file${reminderBulk.selected.length === 1 ? '' : 's'}? This emails them on the live system.`,
    };
  if (dispatchBulk.selection)
    return {
      hook: dispatchBulk,
      label: 'dispatch',
      button: `Dispatch / send letter (${dispatchBulk.selected.length})`,
      title: 'Dispatch selected files?',
      message: `Dispatch / send the stage letter for ${dispatchBulk.selected.length} file${dispatchBulk.selected.length === 1 ? '' : 's'} and move them to the next step? This emails recipients on the live system.`,
    };
  if (vetBulk.selection)
    return {
      hook: vetBulk,
      label: 'approve',
      button: `Approve selected (${vetBulk.selected.length})`,
      title: 'Approve selected files?',
      message: `Approve ${vetBulk.selected.length} file${vetBulk.selected.length === 1 ? '' : 's'} and send them to the next step? Examiners not yet vetted on these files will be approved too; held / rejected examiners stay as they are.`,
    };
  if (closeBulk.selection)
    return {
      hook: closeBulk,
      label: 'close',
      button: `Close selected (${closeBulk.selected.length})`,
      title: 'Close selected files?',
      message: `Close ${closeBulk.selected.length} file${closeBulk.selected.length === 1 ? '' : 's'}? This marks them completed.`,
    };
  return null;
}

function getExaminerConsentStats(file: any) {
  if (file.examinerConsent) return file.examinerConsent;
  const panel = file.panel || [];
  const approved = panel.filter(
    (p: any) =>
      (p.vetStatus === 'APPROVED' || (p.assigned && !p.vetStatus)) &&
      p.vetStatus !== 'REJECTED' &&
      p.vetStatus !== 'HELD',
  );
  const accepted = approved.filter((p: any) => p.consentStatus === 'ACCEPTED');
  const regretted = approved.filter((p: any) => p.consentStatus === 'REGRETTED');
  const pending = approved.filter((p: any) => !p.consentStatus || p.consentStatus === 'PENDING');
  return {
    approved: approved.length,
    accepted: accepted.length,
    regretted: regretted.length,
    pending: pending.length,
    summary: approved.length > 0 ? `${accepted.length} / ${approved.length}` : '—',
  };
}

function FileTable({
  rows,
  showDepartment = true,
  numbering,
  approval,
  panelRequest,
  panelResend,
  bulkPick,
  bulkPickLabel,
  onEditCandidate,
}: {
  rows: any[];
  showDepartment?: boolean;
  numbering?: NumberingProps;
  approval?: ApprovalProps;
  panelRequest?: ApprovalProps;
  panelResend?: ApprovalProps;
  bulkPick?: BulkPick;
  bulkPickLabel?: string;
  onEditCandidate?: (file: any) => void;
}) {
  if (!rows.length) return <Empty>No files here.</Empty>;
  const numberableIds = numbering ? rows.filter(needsThesisNumber).map((r) => r._id) : [];
  const showChecks = Boolean(numbering && numberableIds.length);
  const allSelected = Boolean(showChecks && numberableIds.every((id) => numbering!.selected.includes(id)));
  const approvableIds = approval ? rows.filter((r) => r.canBulkApprove).map((r) => r._id) : [];
  const showApproveChecks = !showChecks && approvableIds.length > 0;
  const allApproveSelected = showApproveChecks && approvableIds.every((id) => approval!.selected.includes(id));
  const panelIds = panelRequest ? rows.filter((r) => r.canBulkRequestPanel).map((r) => r._id) : [];
  const showPanelChecks = !showChecks && !showApproveChecks && panelIds.length > 0;
  const allPanelSelected = showPanelChecks && panelIds.every((id) => panelRequest!.selected.includes(id));
  const resendIds = panelResend ? rows.filter((r) => r.canBulkResendPanel).map((r) => r._id) : [];
  const showResendChecks = !showChecks && !showApproveChecks && !showPanelChecks && resendIds.length > 0;
  const allResendSelected = showResendChecks && resendIds.every((id) => panelResend!.selected.includes(id));
  const pickIds = bulkPick ? rows.filter((r) => r[bulkPick.field]).map((r) => r._id) : [];
  const showPickChecks =
    !showChecks && !showApproveChecks && !showPanelChecks && !showResendChecks && pickIds.length > 0;
  const allPickSelected = showPickChecks && pickIds.every((id) => bulkPick!.selected.includes(id));
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            {showChecks ? (
              <th>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => numbering!.onToggleAll(allSelected ? [] : numberableIds)}
                  aria-label="Select all awaiting thesis number"
                />
              </th>
            ) : null}
            {showApproveChecks ? (
              <th>
                <input
                  type="checkbox"
                  checked={allApproveSelected}
                  onChange={() => approval!.onToggleAll(allApproveSelected ? [] : approvableIds)}
                  aria-label="Select all waiting for your approval"
                />
              </th>
            ) : null}
            {showPanelChecks ? (
              <th>
                <input
                  type="checkbox"
                  checked={allPanelSelected}
                  onChange={() => panelRequest!.onToggleAll(allPanelSelected ? [] : panelIds)}
                  aria-label="Select all waiting for a panel request"
                />
              </th>
            ) : null}
            {showResendChecks ? (
              <th>
                <input
                  type="checkbox"
                  checked={allResendSelected}
                  onChange={() => panelResend!.onToggleAll(allResendSelected ? [] : resendIds)}
                  aria-label="Select all for a panel resend"
                />
              </th>
            ) : null}
            {showPickChecks ? (
              <th>
                <input
                  type="checkbox"
                  checked={allPickSelected}
                  onChange={() => bulkPick!.onToggleAll(allPickSelected ? [] : pickIds)}
                  aria-label={bulkPickLabel ? `Select all for ${bulkPickLabel}` : 'Select all'}
                />
              </th>
            ) : null}
            <th>Course type</th>
            <th>Course</th>
            {showDepartment ? <th>Department</th> : null}
            <th>Candidate</th>
            <th>Title</th>
            <th>Chief Guide</th>
            <th>No.</th>
            <th>Queue</th>
            <th>Status</th>
            <th title="Approved examiners who have accepted / Total approved examiners">Examiner Consent</th>
            <th>Edit Candidate</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const editable = Boolean(numbering && needsThesisNumber(r));
            const value = numbering ? numbering.numbers[r._id] ?? r.thesisNumber ?? '' : '';
            return (
              <tr key={r._id}>
                {showChecks ? (
                  <td>
                    {editable ? (
                      <input
                        type="checkbox"
                        checked={numbering!.selected.includes(r._id)}
                        onChange={() => numbering!.onToggle(r._id)}
                        aria-label={`Select ${r.candidate?.name || r._id}`}
                      />
                    ) : null}
                  </td>
                ) : null}
                {showApproveChecks ? (
                  <td>
                    {r.canBulkApprove ? (
                      <input
                        type="checkbox"
                        checked={approval!.selected.includes(r._id)}
                        onChange={() => approval!.onToggle(r._id)}
                        aria-label={`Select ${r.candidate?.name || r._id} for approval`}
                      />
                    ) : null}
                  </td>
                ) : null}
                {showPanelChecks ? (
                  <td>
                    {r.canBulkRequestPanel ? (
                      <input
                        type="checkbox"
                        checked={panelRequest!.selected.includes(r._id)}
                        onChange={() => panelRequest!.onToggle(r._id)}
                        aria-label={`Select ${r.candidate?.name || r._id} for panel request`}
                      />
                    ) : null}
                  </td>
                ) : null}
                {showResendChecks ? (
                  <td>
                    {r.canBulkResendPanel ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={panelResend!.selected.includes(r._id)}
                          onChange={() => panelResend!.onToggle(r._id)}
                          aria-label={`Select ${r.candidate?.name || r._id} to ${r.panelRequested ? 'resend' : 'send'} the panel request`}
                        />
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: r.panelRequested ? '#1565c0' : '#2e7d32',
                          }}
                          title={
                            r.panelRequested
                              ? 'Chief Guide already mailed — this resends the request'
                              : 'Chief Guide not mailed yet — this sends the request for the first time'
                          }
                        >
                          {r.panelRequested ? 'Resend' : 'Send'}
                        </span>
                      </div>
                    ) : null}
                  </td>
                ) : null}
                {showPickChecks ? (
                  <td>
                    {r[bulkPick!.field] ? (
                      <input
                        type="checkbox"
                        checked={bulkPick!.selected.includes(r._id)}
                        onChange={() => bulkPick!.onToggle(r._id)}
                        aria-label={`Select ${r.candidate?.name || r._id}${bulkPickLabel ? ` for ${bulkPickLabel}` : ''}`}
                      />
                    ) : null}
                  </td>
                ) : null}
                <td>{r.courseTypeName || '—'}</td>
                <td>{r.courseName || '—'}</td>
                {showDepartment ? <td>{r.departmentName || '—'}</td> : null}
                <td>
                  <Link to={`/app/files/${r._id}`}>{r.candidate?.name}</Link>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>{r.candidate?.enrollmentNo}</div>
                </td>
                <td>{r.title}</td>
                <td>{r.chiefGuideName || '—'}</td>
                <td>{r.thesisNumber || r.fileNo || '—'}</td>
                <td>{r.laneLabel || r.currentStageCode}</td>
                <td>
                  <Pill status={r.status} />
                </td>
                <td>
                  {(() => {
                    const stats = r.examinerConsent || getExaminerConsentStats(r);
                    if (!stats || stats.approved === 0) {
                      return <span style={{ color: 'var(--muted)' }}>—</span>;
                    }
                    const allAccepted = stats.accepted === stats.approved;
                    const anyAccepted = stats.accepted > 0;
                    return (
                      <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            fontWeight: 600,
                            fontSize: 12,
                            color: allAccepted ? '#2e7d32' : anyAccepted ? '#1565c0' : 'var(--muted)',
                          }}
                        >
                          <span
                            style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              backgroundColor: allAccepted ? '#2e7d32' : anyAccepted ? '#1976d2' : '#9e9e9e',
                              flexShrink: 0,
                            }}
                          />
                          {stats.accepted} / {stats.approved} Accepted
                        </span>
                        {stats.regretted > 0 && (
                          <span style={{ fontSize: 11, color: '#c62828', fontWeight: 500, paddingLeft: 14 }}>
                            {stats.regretted} refused
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </td>
                <td>
                  <a
                    href="#edit-candidate"
                    className="edit-candidate-link"
                    title={`Edit candidate information for ${r.candidate?.name || r._id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onEditCandidate?.(r);
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                    Edit Info
                  </a>
                </td>
                <td>
                  <div className="thesis-no-cell">
                    <Link to={`/app/files/${r._id}`}>click here</Link>
                    {editable ? (
                      <div className="thesis-no-row">
                        <input
                          className="input"
                          value={value}
                          disabled={numbering!.busy}
                          onChange={(e) => numbering!.onNumberChange(r._id, e.target.value)}
                          placeholder="Thesis no."
                          maxLength={50}
                          aria-label={`Thesis number for ${r.candidate?.name || r._id}`}
                        />
                        <button
                          type="button"
                          className="btn small"
                          disabled={numbering!.busy}
                          onClick={() => numbering!.onSaveOne(r._id)}
                        >
                          Thesis No.
                        </button>
                      </div>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type EditCandidateModalProps = {
  file: any;
  departments: any[];
  courseTypes: any[];
  courses: any[];
  specialities: any[];
  faculty: any[];
  onClose: () => void;
  onSaved: () => void;
};

function EditCandidateModal({
  file,
  departments,
  courseTypes,
  courses,
  specialities,
  faculty,
  onClose,
  onSaved,
}: EditCandidateModalProps) {
  const [candidateName, setCandidateName] = useState(file.candidate?.name || '');
  const [enrollmentNo, setEnrollmentNo] = useState(file.candidate?.enrollmentNo || '');
  const [dob, setDob] = useState(file.candidate?.dob ? String(file.candidate.dob).slice(0, 10) : '');
  const [mobile, setMobile] = useState(file.candidate?.mobile || '');
  const [candidateEmail, setCandidateEmail] = useState(file.candidate?.email || '');
  const [title, setTitle] = useState(file.title || '');
  const [departmentId, setDepartmentId] = useState(String(file.departmentId || ''));
  const [courseTypeId, setCourseTypeId] = useState(String(file.courseTypeId || ''));
  const [courseId, setCourseId] = useState(String(file.courseId || ''));
  const [specialityId, setSpecialityId] = useState(String(file.specialityId || ''));
  const [chiefGuideId, setChiefGuideId] = useState(String(file.chiefGuideId || ''));
  const [sessionMonth, setSessionMonth] = useState(file.sessionMonth || 'September');
  const [sessionYear, setSessionYear] = useState(String(file.sessionYear || '2026'));
  const [remarks, setRemarks] = useState(file.remarks || '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    get(`/files/${file._id}`)
      .then((res) => {
        if (!active || !res?.file) return;
        const f = res.file;
        if (f.candidate?.name) setCandidateName(f.candidate.name);
        if (f.candidate?.enrollmentNo) setEnrollmentNo(f.candidate.enrollmentNo);
        if (f.candidate?.dob) setDob(String(f.candidate.dob).slice(0, 10));
        if (f.candidate?.mobile) setMobile(f.candidate.mobile);
        if (f.candidate?.email) setCandidateEmail(f.candidate.email);
        if (f.title) setTitle(f.title);
        if (f.departmentId) setDepartmentId(String(f.departmentId));
        if (f.courseTypeId) setCourseTypeId(String(f.courseTypeId));
        if (f.courseId) setCourseId(String(f.courseId));
        if (f.specialityId) setSpecialityId(String(f.specialityId));
        if (f.chiefGuideId) setChiefGuideId(String(f.chiefGuideId));
        if (f.remarks) setRemarks(f.remarks);
        if (res.session) {
          if (res.session.month) setSessionMonth(res.session.month);
          if (res.session.year) setSessionYear(String(res.session.year));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [file._id]);

  const availableCourses = courses.filter((c) => {
    if (courseTypeId && c.courseTypeId && String(c.courseTypeId) !== String(courseTypeId)) return false;
    if (departmentId && c.departmentId && String(c.departmentId) !== String(departmentId)) return false;
    return true;
  });

  const availableSpecialities = specialities.filter((s) => {
    if (!courseId) return true;
    return !s.courseId || String(s.courseId) === String(courseId);
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!candidateName.trim() || candidateName.trim().length < 3) {
      setError('Name of Candidate must be at least 3 characters');
      return;
    }
    if (!enrollmentNo.trim()) {
      setError('Enrollment No. is required');
      return;
    }
    if (!dob) {
      setError('DOB of Candidate is required');
      return;
    }
    const cleanMobile = mobile.replace(/\D/g, '');
    if (!cleanMobile || cleanMobile.length !== 10 || !/^[6-9]/.test(cleanMobile)) {
      setError('Mobile No. must be a valid 10-digit number starting with 6-9');
      return;
    }
    if (!candidateEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail.trim())) {
      setError('Candidate Email is invalid');
      return;
    }
    if (!title.trim()) {
      setError('Thesis title is required');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, any> = {
        candidateName: candidateName.trim(),
        enrollmentNo: enrollmentNo.trim(),
        dob: dob.trim(),
        mobile: cleanMobile,
        candidateEmail: candidateEmail.trim().toLowerCase(),
        title: title.trim(),
        departmentId: departmentId || undefined,
        courseTypeId: courseTypeId || undefined,
        courseId: courseId || undefined,
        specialityId: specialityId || '',
        chiefGuideId: chiefGuideId || undefined,
        sessionMonth,
        sessionYear: Number(sessionYear),
        remarks: remarks.trim(),
      };
      await patch(`/files/${file._id}`, payload);
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Failed to update candidate information');
    } finally {
      setSaving(false);
    }
  }

  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const years = [2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030];

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="candidate-edit-modal-card"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="candidate-modal-header">
          <div>
            <h2 className="candidate-modal-title">Edit Candidate Information</h2>
            <p className="candidate-modal-sub">
              Update candidate credentials, department & course mapping, thesis title, and chief guide
            </p>
          </div>
          <button
            type="button"
            className="btn small secondary"
            onClick={onClose}
            aria-label="Close dialog"
            style={{ minWidth: 32, padding: '4px 10px', fontSize: 16, lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        <ErrorBox error={error} />

        <form onSubmit={handleSubmit}>
          {/* SECTION 1: CANDIDATE PERSONAL DETAILS */}
          <div className="candidate-section-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            Candidate Personal Details
          </div>
          <div className="candidate-form-grid-2">
            <Field label="Candidate Name" required>
              <input
                className="input"
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                placeholder="Candidate Full Name"
                required
              />
            </Field>
            <Field label="Enrollment No." required>
              <input
                className="input"
                value={enrollmentNo}
                onChange={(e) => setEnrollmentNo(e.target.value)}
                placeholder="e.g. P-TEST/634712"
                required
              />
            </Field>
            <Field label="Date of Birth (DOB)" required>
              <input
                className="input"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                min="1920-01-01"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                required
              />
            </Field>
            <Field label="Mobile No." required>
              <input
                className="input"
                type="tel"
                maxLength={10}
                placeholder="10-digit mobile number"
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                required
              />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="Candidate Email Id" required>
              <input
                className="input"
                type="email"
                placeholder="candidate@aiims.edu"
                value={candidateEmail}
                onChange={(e) => setCandidateEmail(e.target.value)}
                required
              />
            </Field>
          </div>

          {/* SECTION 2: ACADEMIC MAPPING (DROPDOWN SELECT ONLY) */}
          <div className="candidate-section-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
            Academic & Department Mapping (Dropdown Select Only)
          </div>
          <div className="candidate-form-grid-2">
            <Field label="Department" required>
              <select
                className="input"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                required
              >
                <option value="">-- Select Department --</option>
                {departments.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Course Type" required>
              <select
                className="input"
                value={courseTypeId}
                onChange={(e) => {
                  setCourseTypeId(e.target.value);
                  setCourseId('');
                  setSpecialityId('');
                }}
                required
              >
                <option value="">-- Select Course Type --</option>
                {courseTypes.map((ct) => (
                  <option key={ct._id} value={ct._id}>
                    {ct.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Course" required>
              <select
                className="input"
                value={courseId}
                onChange={(e) => {
                  setCourseId(e.target.value);
                  setSpecialityId('');
                }}
                required
              >
                <option value="">-- Select Course --</option>
                {availableCourses.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Speciality (Optional)">
              <select
                className="input"
                value={specialityId}
                onChange={(e) => setSpecialityId(e.target.value)}
              >
                <option value="">-- None / Unspecified --</option>
                {availableSpecialities.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Session Month" required>
              <select
                className="input"
                value={sessionMonth}
                onChange={(e) => setSessionMonth(e.target.value)}
                required
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Session Year" required>
              <select
                className="input"
                value={sessionYear}
                onChange={(e) => setSessionYear(e.target.value)}
                required
              >
                {years.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* SECTION 3: THESIS & GUIDE */}
          <div className="candidate-section-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            Thesis Details & Chief Guide (Dropdown Select)
          </div>
          <div style={{ marginBottom: 12 }}>
            <Field label="Chief Guide" required>
              <select
                className="input"
                value={chiefGuideId}
                onChange={(e) => setChiefGuideId(e.target.value)}
                required
              >
                <option value="">-- Select Chief Guide --</option>
                {faculty
                  .filter((f) => f.canGuide !== false)
                  .map((f) => (
                    <option key={f._id} value={f._id}>
                      {f.name} {f.designation ? `(${f.designation})` : ''}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Field label="Thesis Title" required>
              <textarea
                className="input"
                rows={2}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter candidate's thesis title"
                required
              />
            </Field>
          </div>
          <div>
            <Field label="Remarks (Optional)">
              <textarea
                className="input"
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Administrative notes or remarks"
              />
            </Field>
          </div>

          <div className="candidate-modal-footer">
            <button
              type="button"
              className="btn secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn"
              disabled={saving}
              style={{ minWidth: 150 }}
            >
              {saving ? 'Saving Changes...' : 'Save Candidate Info'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function InboxPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [lanes, setLanes] = useState<Record<string, number>>({});
  const [lane, setLane] = useState('');
  const { sessions, month, year, setMonth, setYear, ready } = useSessionFilter();

  const [depts, setDepts] = useState<any[]>([]);
  const [courseTypes, setCourseTypes] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  // Session-wide rows (no other filters) — limits Course / Course Type options to ones that have files.
  const [optionItems, setOptionItems] = useState<any[]>([]);
  const [specialities, setSpecialities] = useState<any[]>([]);
  const [faculty, setFaculty] = useState<any[]>([]);
  const [stageChoices, setStageChoices] = useState<{ stageCode: string; stageName: string; count?: number }[]>([]);

  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [courseTypeId, setCourseTypeId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [specialityId, setSpecialityId] = useState('');
  const [stage, setStage] = useState('');
  const [status, setStatus] = useState('');
  const [chiefGuideId, setChiefGuideId] = useState('');

  const [editingFile, setEditingFile] = useState<any | null>(null);

  // Numbering capability for Dealing Assistant / Institute Admin
  const [selected, setSelected] = useState<string[]>([]);
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'single'; id: string } | { kind: 'bulk' } | null>(null);

  const canAssignNumbers = user?.role === 'DEALING' || user?.role === 'INSTITUTE_ADMIN';

  useEffect(() => {
    get('/masters/departments').then((d) => setDepts(Array.isArray(d) ? d : [])).catch(() => setDepts([]));
    get('/masters/course-types').then((ct) => setCourseTypes(Array.isArray(ct) ? ct : [])).catch(() => setCourseTypes([]));
    get('/masters/courses').then((c) => setCourses(Array.isArray(c) ? c : [])).catch(() => setCourses([]));
    get('/masters/specialities').then((s) => setSpecialities(Array.isArray(s) ? s : [])).catch(() => setSpecialities([]));
    get('/masters/faculty').then((f) => setFaculty(Array.isArray(f) ? f : [])).catch(() => setFaculty([]));
  }, []);

  useEffect(() => {
    if (!ready) return;
    const params = applySessionParams(new URLSearchParams(), month, year);
    params.set('reminders', '1');
    get(`/files/workflow-board?${params.toString()}`)
      .then((data) => {
        const groups = data?.groups || [];
        const merged = new Map<string, { stageCode: string; stageName: string; count: number }>();
        for (const g of groups) {
          for (const s of g.stages || []) {
            if (!s?.stageCode) continue;
            const prev = merged.get(s.stageCode);
            if (prev) prev.count += s.count || 0;
            else merged.set(s.stageCode, { stageCode: s.stageCode, stageName: s.stageName || s.stageCode, count: s.count || 0 });
          }
        }
        setStageChoices([...merged.values()]);
      })
      .catch(() => setStageChoices([]));
  }, [ready, month, year]);

  useEffect(() => {
    if (!ready) return;
    const params = applySessionParams(new URLSearchParams(), month, year);
    get(`/files/inbox?${params.toString()}`)
      .then((data) => setOptionItems(Array.isArray(data) ? data : data?.items || []))
      .catch(() => setOptionItems([]));
  }, [ready, month, year]);

  async function load(overrides?: {
    lane?: string;
    month?: string;
    year?: string;
    q?: string;
    departmentId?: string;
    courseTypeId?: string;
    courseId?: string;
    specialityId?: string;
    stage?: string;
    status?: string;
    chiefGuideId?: string;
  }) {
    const curLane = overrides?.lane !== undefined ? overrides.lane : lane;
    const curMonth = overrides?.month !== undefined ? overrides.month : month;
    const curYear = overrides?.year !== undefined ? overrides.year : year;
    const curQ = overrides?.q !== undefined ? overrides.q : q;
    const curDept = overrides?.departmentId !== undefined ? overrides.departmentId : departmentId;
    const curType = overrides?.courseTypeId !== undefined ? overrides.courseTypeId : courseTypeId;
    const curCourse = overrides?.courseId !== undefined ? overrides.courseId : courseId;
    const curSpec = overrides?.specialityId !== undefined ? overrides.specialityId : specialityId;
    const curStage = overrides?.stage !== undefined ? overrides.stage : stage;
    const curStatus = overrides?.status !== undefined ? overrides.status : status;
    const curGuide = overrides?.chiefGuideId !== undefined ? overrides.chiefGuideId : chiefGuideId;

    const params = applySessionParams(new URLSearchParams(), curMonth, curYear);
    if (curLane) params.set('lane', curLane);
    if (curQ) params.set('q', curQ);
    if (curDept) params.set('departmentId', curDept);
    if (curType) params.set('courseTypeId', curType);
    if (curCourse) params.set('courseId', curCourse);
    if (curSpec) params.set('specialityId', curSpec);
    if (curStage) params.set('stage', curStage);
    if (curStatus) params.set('status', curStatus);
    if (curGuide) params.set('chiefGuideId', curGuide);

    const data = await get(`/files/inbox?${params.toString()}`);
    if (Array.isArray(data)) {
      setItems(data);
      setLanes({});
      return;
    }
    setItems(data.items || []);
    setLanes(data.lanes || {});
    setSelected([]);
    setNumbers({});
  }

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, month, year, lane, departmentId, courseTypeId, courseId, specialityId, stage, status, chiefGuideId]);

  function handleSearchSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    load();
  }

  function clearAllFilters() {
    setQ('');
    setDepartmentId('');
    setCourseTypeId('');
    setCourseId('');
    setSpecialityId('');
    setStage('');
    setStatus('');
    setChiefGuideId('');
    setLane('');
    load({
      q: '',
      departmentId: '',
      courseTypeId: '',
      courseId: '',
      specialityId: '',
      stage: '',
      status: '',
      chiefGuideId: '',
      lane: '',
    });
  }

  const hasActiveFilters = Boolean(
    q || departmentId || courseTypeId || courseId || specialityId || stage || status || chiefGuideId || lane
  );

  const courseTypeOf = (item: any) =>
    String(item.courseTypeId || courses.find((c) => String(c._id) === String(item.courseId))?.courseTypeId || '');
  const usedCourseIds = new Set(optionItems.map((i) => String(i.courseId || '')).filter(Boolean));
  const usedCourseTypeIds = new Set(optionItems.map(courseTypeOf).filter(Boolean));
  const availableCourseTypes = courseTypes.filter(
    (ct) => usedCourseTypeIds.has(String(ct._id)) || String(ct._id) === String(courseTypeId)
  );

  const filteredCourses = courses.filter((c) => {
    if (!usedCourseIds.has(String(c._id)) && String(c._id) !== String(courseId)) return false;
    if (courseTypeId && c.courseTypeId && String(c.courseTypeId) !== String(courseTypeId)) return false;
    if (departmentId && c.departmentId && String(c.departmentId) !== String(departmentId)) return false;
    return true;
  });

  const { scopedDepts, scopedSpecs } = scopeLookups(user, courses, depts, specialities, departmentId, specialityId);
  const filteredSpecs = scopedSpecs.filter((s) => {
    if (!courseId) return true;
    return !s.courseId || String(s.courseId) === String(courseId);
  });

  const displayItems = items.filter((item) => {
    if (q) {
      const qLower = q.toLowerCase();
      const matchCandidate = item.candidate?.name?.toLowerCase().includes(qLower);
      const matchEnroll = item.candidate?.enrollmentNo?.toLowerCase().includes(qLower);
      const matchTitle = item.title?.toLowerCase().includes(qLower);
      const matchThesisNo = item.thesisNumber?.toLowerCase().includes(qLower);
      const matchFileNo = item.fileNo?.toLowerCase().includes(qLower);
      const matchGuide = item.chiefGuideName?.toLowerCase().includes(qLower);
      if (!matchCandidate && !matchEnroll && !matchTitle && !matchThesisNo && !matchFileNo && !matchGuide) return false;
    }
    if (departmentId && String(item.departmentId) !== String(departmentId)) return false;
    if (courseId && String(item.courseId) !== String(courseId)) return false;
    if (courseTypeId && item.courseTypeId && String(item.courseTypeId) !== String(courseTypeId)) return false;
    if (specialityId && String(item.specialityId) !== String(specialityId)) return false;
    if (chiefGuideId && String(item.chiefGuideId) !== String(chiefGuideId)) return false;
    if (stage && !stage.startsWith('remind_') && String(item.currentStageCode) !== String(stage)) return false;
    if (status && String(item.status) !== String(status)) return false;
    if (lane && String(item.lane) !== String(lane)) return false;
    return true;
  }).sort(compareByCourseThenCandidate);

  const numberableIds = canAssignNumbers ? displayItems.filter(needsThesisNumber).map((r) => r._id) : [];
  const showNumbering = numberableIds.length > 0;
  const bulk = useBulkApprove(displayItems, load, setOk, setError);
  const panelBulk = useBulkPanelRequest(displayItems, load, setOk, setError);
  const panelResendBulk = useBulkPanelRequest(displayItems, load, setOk, setError, 'resend');
  const reminderBulk = useBulkAct(displayItems, load, setOk, setError, { kind: 'REMINDER', field: 'canBulkReminder', verb: 'Reminder' });
  const dispatchBulk = useBulkAct(displayItems, load, setOk, setError, { kind: 'DISPATCH', field: 'canBulkDispatch', verb: 'Dispatch' });
  const vetBulk = useBulkAct(displayItems, load, setOk, setError, { kind: 'VET_APPROVE', field: 'canBulkVetApprove', verb: 'Approval' });
  const closeBulk = useBulkAct(displayItems, load, setOk, setError, { kind: 'CLOSE', field: 'canBulkClose', verb: 'Close' });
  const simpleBulk = pickSimpleBulk({ reminderBulk, dispatchBulk, vetBulk, closeBulk });

  function thesisValue(id: string) {
    const row = displayItems.find((r) => r._id === id);
    return (numbers[id] ?? row?.thesisNumber ?? '').trim();
  }

  function requestBulk() {
    setError(null);
    setOk(null);
    if (!selected.length) {
      setError('Select at least 1 row');
      return;
    }
    setConfirm({ kind: 'bulk' });
  }

  function requestOne(id: string) {
    setError(null);
    setOk(null);
    const row = displayItems.find((r) => r._id === id);
    if (!needsThesisNumber(row)) {
      setError('Thesis number can be added only after ACE approval');
      return;
    }
    if (!thesisValue(id)) {
      setError('Thesis number is required');
      return;
    }
    setConfirm({ kind: 'single', id });
  }

  async function runAssign(assignItems: { id: string; thesisNumber: string }[]) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const result = await post('/files/thesis-numbers', { items: assignItems });
      const saved: string[] = result.saved || [];
      const failed: { id: string; message: string }[] = result.failed || [];
      if (saved.length) {
        setOk(`Thesis no. saved for ${saved.length} file${saved.length === 1 ? '' : 's'}.`);
      }
      if (failed.length) {
        setError(
          failed
            .map((f) => {
              const row = displayItems.find((r) => r._id === f.id);
              return `${row?.candidate?.name || row?.candidate?.enrollmentNo || f.id}: ${f.message}`;
            })
            .join(' '),
        );
      }
      setSelected([]);
      setConfirm(null);
      await load();
    } catch (e: any) {
      setError(e.message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  function confirmAssign() {
    if (!confirm || busy) return;
    const next = confirm;
    setConfirm(null);
    if (next.kind === 'single') {
      void runAssign([{ id: next.id, thesisNumber: thesisValue(next.id) }]);
      return;
    }
    void runAssign(selected.map((id) => ({ id, thesisNumber: thesisValue(id) })));
  }

  const exportCols = [
    { key: 'courseTypeName', label: 'Course type' },
    { key: 'courseName', label: 'Course' },
    { key: 'departmentName', label: 'Department' },
    { key: 'candidate', label: 'Candidate' },
    { key: 'enrollmentNo', label: 'Enrollment' },
    { key: 'title', label: 'Title' },
    { key: 'specialityName', label: 'Speciality' },
    { key: 'chiefGuideName', label: 'Chief Guide' },
    { key: 'thesisNumber', label: 'No.' },
    { key: 'queue', label: 'Queue' },
    { key: 'status', label: 'Status' },
    { key: 'examinerConsent', label: 'Examiner Consent' },
  ];
  const exportRows = displayItems.map((r) => {
    const stats = r.examinerConsent || getExaminerConsentStats(r);
    return {
      candidate: r.candidate?.name,
      enrollmentNo: r.candidate?.enrollmentNo,
      title: r.title,
      departmentName: r.departmentName,
      courseTypeName: r.courseTypeName,
      courseName: r.courseName,
      specialityName: r.specialityName,
      chiefGuideName: r.chiefGuideName,
      thesisNumber: r.thesisNumber || r.fileNo,
      queue: r.laneLabel || r.lane || r.currentStageCode,
      status: r.status,
      examinerConsent:
        stats.approved > 0
          ? `${stats.accepted} / ${stats.approved} Accepted${stats.regretted > 0 ? ` (${stats.regretted} refused)` : ''}`
          : '—',
    };
  });

  // Selected names for tags
  const activeDept = depts.find((d) => String(d._id) === String(departmentId));
  const activeCourseType = courseTypes.find((ct) => String(ct._id) === String(courseTypeId));
  const activeCourse = courses.find((c) => String(c._id) === String(courseId));
  const activeSpec = specialities.find((s) => String(s._id) === String(specialityId));
  const activeStage = stageChoices.find((s) => s.stageCode === stage);
  const activeGuide = faculty.find((f) => String(f._id) === String(chiefGuideId));

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Inbox</h1>
          <p>New files from departments land with ACE, then Dealing numbers them, then Assoc Dean approves the Chief Guide. Open File 360 to act.</p>
        </div>
      </div>

      <div className="inbox-filter-panel">
        <div className="inbox-filter-header">
          <div className="inbox-filter-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filter Inbox Files
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              className="btn small secondary"
              onClick={clearAllFilters}
            >
              Reset All Filters
            </button>
          )}
        </div>

        <div className="inbox-filter-grid">
          {/* 1. Academic Session */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Session Month</span>
            <select
              value={month}
              onChange={(e) => {
                const nextMonth = e.target.value;
                setMonth(nextMonth);
                load({ month: nextMonth });
              }}
              aria-label="Session Month"
            >
              <option value="">All months</option>
              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Session Year</span>
            <select
              value={year}
              onChange={(e) => {
                const nextYear = e.target.value;
                setYear(nextYear);
                load({ year: nextYear });
              }}
              aria-label="Session Year"
            >
              <option value="">All years</option>
              {Array.from(new Set(sessions.map((s) => s.year).filter(Boolean))).sort((a, b) => Number(b) - Number(a)).map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          </div>

          {/* 2. Department */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Department</span>
            <select
              value={departmentId}
              onChange={(e) => {
                const next = e.target.value;
                setDepartmentId(next);
                load({ departmentId: next });
              }}
              aria-label="Department"
            >
              <option value="">All departments</option>
              {scopedDepts.map((d) => (
                <option key={d._id} value={d._id}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* 3. Course Type */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Course Type</span>
            <select
              value={courseTypeId}
              onChange={(e) => {
                const next = e.target.value;
                setCourseTypeId(next);
                setCourseId('');
                setSpecialityId('');
                load({ courseTypeId: next, courseId: '', specialityId: '' });
              }}
              aria-label="Course Type"
            >
              <option value="">All course types</option>
              {availableCourseTypes.map((ct) => (
                <option key={ct._id} value={ct._id}>{ct.name}</option>
              ))}
            </select>
          </div>

          {/* 4. Course */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Course</span>
            <select
              value={courseId}
              onChange={(e) => {
                const next = e.target.value;
                setCourseId(next);
                setSpecialityId('');
                load({ courseId: next, specialityId: '' });
              }}
              aria-label="Course"
            >
              <option value="">All courses</option>
              {filteredCourses.map((c) => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* 5. Speciality */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Speciality</span>
            <select
              value={specialityId}
              onChange={(e) => {
                const next = e.target.value;
                setSpecialityId(next);
                load({ specialityId: next });
              }}
              aria-label="Speciality"
            >
              <option value="">All specialities</option>
              {filteredSpecs.map((s) => (
                <option key={s._id} value={s._id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* 6. Workflow Step / Stage */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Workflow Step</span>
            <select
              value={stage}
              onChange={(e) => {
                const next = e.target.value;
                setStage(next);
                load({ stage: next });
              }}
              aria-label="Workflow step"
            >
              <option value="">All steps</option>
              {stageChoices.map((s) => (
                <option key={s.stageCode} value={s.stageCode}>
                  {s.stageName} {s.count ? `(${s.count})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 7. Queue / Action Lane */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Queue / Lane</span>
            <select
              value={lane}
              onChange={(e) => {
                const next = e.target.value;
                setLane(next);
                load({ lane: next });
              }}
              aria-label="Queue or lane"
            >
              <option value="">All queues</option>
              {Object.keys(INBOX_LANE_LABELS).map((code) => (
                <option key={code} value={code}>
                  {INBOX_LANE_LABELS[code]} {lanes[code] ? `(${lanes[code]})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 8. Chief Guide */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Chief Guide</span>
            <select
              value={chiefGuideId}
              onChange={(e) => {
                const next = e.target.value;
                setChiefGuideId(next);
                load({ chiefGuideId: next });
              }}
              aria-label="Chief Guide"
            >
              <option value="">All chief guides</option>
              {faculty.filter((f) => f.canGuide !== false).map((f) => (
                <option key={f._id} value={f._id}>
                  {f.name} {f.designation ? `(${f.designation})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 9. Status */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Status</span>
            <select
              value={status}
              onChange={(e) => {
                const next = e.target.value;
                setStatus(next);
                load({ status: next });
              }}
              aria-label="Status"
            >
              <option value="">All statuses</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="ON_HOLD">On Hold</option>
              <option value="COMPLETED">Completed</option>
              <option value="REJECTED">Rejected</option>
              <option value="DRAFT">Draft</option>
            </select>
          </div>

          {/* 10. Search Input */}
          <form className="inbox-filter-search-box" onSubmit={handleSearchSubmit}>
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search candidate name, enrollment no., title, thesis no., file no., guide..."
              aria-label="Search inbox files"
            />
            {q && (
              <button
                type="button"
                className="btn small secondary"
                onClick={() => {
                  setQ('');
                  load({ q: '' });
                }}
                aria-label="Clear search"
              >
                Clear
              </button>
            )}
            <button type="submit" className="btn small secondary">
              Search
            </button>
          </form>
        </div>

        {/* Active Filter Tags */}
        {hasActiveFilters && (
          <div className="filter-active-tags">
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Active Filters:</span>
            {q && (
              <span className="filter-tag-pill">
                Search: &ldquo;{q}&rdquo;
                <button type="button" onClick={() => { setQ(''); load({ q: '' }); }} aria-label="Remove search filter">&times;</button>
              </span>
            )}
            {month && (
              <span className="filter-tag-pill">
                Month: {month}
                <button type="button" onClick={() => { setMonth(''); load({ month: '' }); }} aria-label="Remove month filter">&times;</button>
              </span>
            )}
            {year && (
              <span className="filter-tag-pill">
                Year: {year}
                <button type="button" onClick={() => { setYear(''); load({ year: '' }); }} aria-label="Remove year filter">&times;</button>
              </span>
            )}
            {activeDept && (
              <span className="filter-tag-pill">
                Dept: {activeDept.name}
                <button type="button" onClick={() => { setDepartmentId(''); load({ departmentId: '' }); }} aria-label="Remove department filter">&times;</button>
              </span>
            )}
            {activeCourseType && (
              <span className="filter-tag-pill">
                Type: {activeCourseType.name}
                <button type="button" onClick={() => { setCourseTypeId(''); load({ courseTypeId: '' }); }} aria-label="Remove course type filter">&times;</button>
              </span>
            )}
            {activeCourse && (
              <span className="filter-tag-pill">
                Course: {activeCourse.name}
                <button type="button" onClick={() => { setCourseId(''); load({ courseId: '' }); }} aria-label="Remove course filter">&times;</button>
              </span>
            )}
            {activeSpec && (
              <span className="filter-tag-pill">
                Speciality: {activeSpec.name}
                <button type="button" onClick={() => { setSpecialityId(''); load({ specialityId: '' }); }} aria-label="Remove speciality filter">&times;</button>
              </span>
            )}
            {activeStage && (
              <span className="filter-tag-pill">
                Step: {activeStage.stageName}
                <button type="button" onClick={() => { setStage(''); load({ stage: '' }); }} aria-label="Remove step filter">&times;</button>
              </span>
            )}
            {lane && (
              <span className="filter-tag-pill">
                Queue: {INBOX_LANE_LABELS[lane] || lane}
                <button type="button" onClick={() => { setLane(''); load({ lane: '' }); }} aria-label="Remove queue filter">&times;</button>
              </span>
            )}
            {activeGuide && (
              <span className="filter-tag-pill">
                Guide: {activeGuide.name}
                <button type="button" onClick={() => { setChiefGuideId(''); load({ chiefGuideId: '' }); }} aria-label="Remove guide filter">&times;</button>
              </span>
            )}
            {status && (
              <span className="filter-tag-pill">
                Status: {status.replace('_', ' ')}
                <button type="button" onClick={() => { setStatus(''); load({ status: '' }); }} aria-label="Remove status filter">&times;</button>
              </span>
            )}
            <button
              type="button"
              className="btn small"
              style={{ padding: '2px 8px', fontSize: 11, background: '#c0392b', color: '#fff', border: 0 }}
              onClick={clearAllFilters}
            >
              Clear All
            </button>
          </div>
        )}
      </div>

      {/* Queue Lane Toggle Buttons */}
      <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button
          className={`btn small ${!lane ? '' : 'secondary'}`}
          onClick={() => { setLane(''); load({ lane: '' }); }}
        >
          All ({Object.values(lanes).reduce((a, b) => a + b, 0) || items.length})
        </button>
        {Object.entries(lanes).map(([code, count]) => (
          <button
            key={code}
            className={`btn small ${lane === code ? '' : 'secondary'}`}
            onClick={() => { setLane(code); load({ lane: code }); }}
          >
            {INBOX_LANE_LABELS[code] || code.replaceAll('_', ' ')} ({count})
          </button>
        ))}
      </div>

      <ErrorBox error={error} />
      {ok ? <div className="okbox">{ok}</div> : null}

      <div className="card">
        <div className="files-toolbar" style={{ marginBottom: 12 }}>
          <b>
            Total Files: {displayItems.length}
            {displayItems.length !== items.length ? ` (filtered from ${items.length})` : ''}
          </b>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <ExportButtons columns={exportCols} rows={exportRows} filename="inbox-files" title="Inbox Files" />
            {showNumbering && (
              <button
                type="button"
                className="btn small secondary"
                onClick={requestBulk}
                disabled={busy}
              >
                Add Multiple Thesis No.
              </button>
            )}
            {bulk.approval && (
              <button type="button" className="btn small" onClick={bulk.request} disabled={bulk.approving}>
                {bulk.approving ? 'Approving…' : `Approve selected (${bulk.selected.length})`}
              </button>
            )}
            {panelBulk.selection && (
              <button
                type="button"
                className="btn small"
                onClick={() => void panelBulk.request()}
                disabled={panelBulk.sending || panelBulk.loadingPreview}
              >
                {panelBulk.buttonLabel}
              </button>
            )}
            {panelResendBulk.selection && (
              <button
                type="button"
                className="btn small"
                onClick={() => void panelResendBulk.request()}
                disabled={panelResendBulk.sending || panelResendBulk.loadingPreview}
              >
                {panelResendBulk.buttonLabel}
              </button>
            )}
            {simpleBulk && (
              <button
                type="button"
                className="btn small"
                onClick={() => simpleBulk.hook.setConfirm(true)}
                disabled={simpleBulk.hook.busy}
              >
                {simpleBulk.hook.busy ? 'Working…' : simpleBulk.button}
              </button>
            )}
          </div>
        </div>

        <FileTable
          rows={displayItems}
          onEditCandidate={setEditingFile}
          approval={bulk.approval}
          panelRequest={panelBulk.selection}
          panelResend={panelResendBulk.selection}
          bulkPick={simpleBulk?.hook.selection}
          bulkPickLabel={simpleBulk?.label}
          numbering={
            showNumbering
              ? {
                  selected,
                  numbers,
                  busy,
                  onToggle: (id) => {
                    if (!numberableIds.includes(id)) return;
                    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
                  },
                  onToggleAll: (ids) => setSelected(ids),
                  onNumberChange: (id, value) => setNumbers((prev) => ({ ...prev, [id]: value })),
                  onSaveOne: requestOne,
                }
              : undefined
          }
        />
      </div>

      {bulk.confirmOpen && (
        <ConfirmDialog
          title="Approve selected files?"
          message={`Approve ${bulk.selected.length} selected file${bulk.selected.length === 1 ? '' : 's'} and send them to the next step?`}
          yesLabel="Yes, approve"
          noLabel="Cancel"
          onYes={() => void bulk.run()}
          onNo={() => bulk.setConfirmOpen(false)}
        />
      )}

      {panelBulk.confirm && (
        <ConfirmDialog
          title="Review mail and request panel?"
          message={panelBulk.confirm.message}
          detail={panelBulk.confirm.detail}
          yesLabel={`Yes, send ${panelBulk.selected.length} mail${panelBulk.selected.length === 1 ? '' : 's'}`}
          noLabel="Cancel"
          onYes={() => void panelBulk.run()}
          onNo={() => panelBulk.setConfirm(null)}
        />
      )}

      {panelResendBulk.confirm && (
        <ConfirmDialog
          title="Review mail and resend panel request?"
          message={panelResendBulk.confirm.message}
          detail={panelResendBulk.confirm.detail}
          yesLabel={`Yes, send ${panelResendBulk.selected.length} mail${panelResendBulk.selected.length === 1 ? '' : 's'}`}
          noLabel="Cancel"
          onYes={() => void panelResendBulk.run()}
          onNo={() => panelResendBulk.setConfirm(null)}
        />
      )}

      {simpleBulk && simpleBulk.hook.confirm && (
        <ConfirmDialog
          title={simpleBulk.title}
          message={simpleBulk.message}
          yesLabel="Yes, proceed"
          noLabel="Cancel"
          onYes={() => void simpleBulk.hook.run()}
          onNo={() => simpleBulk.hook.setConfirm(false)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'bulk' ? 'Are you sure?' : 'Save thesis number?'}
          message={
            confirm.kind === 'bulk'
              ? 'Save numbers and send ready files to Assoc Dean?'
              : 'You want to save this thesis number?'
          }
          yesLabel={confirm.kind === 'bulk' ? 'Yes, send it' : 'Yes, save this'}
          noLabel="Cancel"
          onYes={confirmAssign}
          onNo={() => setConfirm(null)}
        />
      )}

      {editingFile && (
        <EditCandidateModal
          file={editingFile}
          departments={depts}
          courseTypes={courseTypes}
          courses={courses}
          specialities={specialities}
          faculty={faculty}
          onClose={() => setEditingFile(null)}
          onSaved={() => {
            setEditingFile(null);
            setOk('Candidate information updated successfully.');
            load();
          }}
        />
      )}
    </Shell>
  );
}

export function FilesPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [depts, setDepts] = useState<any[]>([]);
  const [courseTypes, setCourseTypes] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  // Session-wide rows (no other filters) — limits Course / Course Type options to ones that have files.
  const [optionItems, setOptionItems] = useState<any[]>([]);
  const [specialities, setSpecialities] = useState<any[]>([]);
  const [faculty, setFaculty] = useState<any[]>([]);
  const [stageChoices, setStageChoices] = useState<{ stageCode: string; stageName: string; count?: number }[]>([]);

  const [q, setQ] = useState(searchParams.get('q') || '');
  const [departmentId, setDepartmentId] = useState(searchParams.get('departmentId') || '');
  const [courseTypeId, setCourseTypeId] = useState(searchParams.get('courseTypeId') || '');
  const [courseId, setCourseId] = useState(searchParams.get('courseId') || '');
  const [specialityId, setSpecialityId] = useState(searchParams.get('specialityId') || '');
  const [stage, setStage] = useState(searchParams.get('stage') || '');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [chiefGuideId, setChiefGuideId] = useState(searchParams.get('chiefGuideId') || '');
  const [lane, setLane] = useState(searchParams.get('lane') || '');

  const { sessions, month, year, setMonth, setYear, ready: sessionReady } = useSessionFilter();

  const [selected, setSelected] = useState<string[]>([]);
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'single'; id: string } | { kind: 'bulk' } | null>(null);
  const [editingFile, setEditingFile] = useState<any | null>(null);

  const canAssignNumbers = user?.role === 'DEALING' || user?.role === 'INSTITUTE_ADMIN';

  useEffect(() => {
    get('/masters/departments').then((d) => setDepts(Array.isArray(d) ? d : [])).catch(() => setDepts([]));
    get('/masters/course-types').then((ct) => setCourseTypes(Array.isArray(ct) ? ct : [])).catch(() => setCourseTypes([]));
    get('/masters/courses').then((c) => setCourses(Array.isArray(c) ? c : [])).catch(() => setCourses([]));
    get('/masters/specialities').then((s) => setSpecialities(Array.isArray(s) ? s : [])).catch(() => setSpecialities([]));
    get('/masters/faculty').then((f) => setFaculty(Array.isArray(f) ? f : [])).catch(() => setFaculty([]));
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const params = applySessionParams(new URLSearchParams(), month, year);
    params.set('reminders', '1');
    get(`/files/workflow-board?${params.toString()}`)
      .then((data) => {
        const groups = data?.groups || [];
        const merged = new Map<string, { stageCode: string; stageName: string; count: number }>();
        for (const g of groups) {
          for (const s of g.stages || []) {
            if (!s?.stageCode) continue;
            const prev = merged.get(s.stageCode);
            if (prev) prev.count += s.count || 0;
            else merged.set(s.stageCode, { stageCode: s.stageCode, stageName: s.stageName || s.stageCode, count: s.count || 0 });
          }
        }
        setStageChoices([...merged.values()]);
      })
      .catch(() => setStageChoices([]));
  }, [sessionReady, month, year]);

  useEffect(() => {
    if (!sessionReady) return;
    const params = applySessionParams(new URLSearchParams(), month, year);
    if (isCourseRole(user?.role)) params.set('bucket', 'submitted');
    get(`/files?${params.toString()}`)
      .then((data) => setOptionItems(Array.isArray(data) ? data : data?.items || []))
      .catch(() => setOptionItems([]));
  }, [sessionReady, month, year]);

  async function load(overrides?: {
    departmentId?: string;
    q?: string;
    stage?: string;
    courseTypeId?: string;
    courseId?: string;
    specialityId?: string;
    month?: string;
    year?: string;
    status?: string;
    chiefGuideId?: string;
    lane?: string;
  }) {
    const curDept = overrides?.departmentId !== undefined ? overrides.departmentId : departmentId;
    const curQ = overrides?.q !== undefined ? overrides.q : q;
    const curStage = overrides?.stage !== undefined ? overrides.stage : stage;
    const curType = overrides?.courseTypeId !== undefined ? overrides.courseTypeId : courseTypeId;
    const curCourse = overrides?.courseId !== undefined ? overrides.courseId : courseId;
    const curSpec = overrides?.specialityId !== undefined ? overrides.specialityId : specialityId;
    const curMonth = overrides?.month !== undefined ? overrides.month : month;
    const curYear = overrides?.year !== undefined ? overrides.year : year;
    const curStatus = overrides?.status !== undefined ? overrides.status : status;
    const curGuide = overrides?.chiefGuideId !== undefined ? overrides.chiefGuideId : chiefGuideId;
    const curLane = overrides?.lane !== undefined ? overrides.lane : lane;

    const params = new URLSearchParams();
    if (curQ) params.set('q', curQ);
    if (curDept) params.set('departmentId', curDept);
    if (curStage) params.set('stage', curStage);
    if (curType) params.set('courseTypeId', curType);
    if (curCourse) params.set('courseId', curCourse);
    if (curSpec) params.set('specialityId', curSpec);
    if (curStatus) params.set('status', curStatus);
    if (curGuide) params.set('chiefGuideId', curGuide);
    if (curLane) params.set('lane', curLane);
    applySessionParams(params, curMonth, curYear);
    if (isCourseRole(user?.role)) params.set('bucket', 'submitted');

    const nextRows = await get(`/files?${params.toString()}`);
    setRows(Array.isArray(nextRows) ? nextRows : []);
    setSelected([]);
    setNumbers({});
  }

  useEffect(() => {
    if (!sessionReady) return;
    load();
  }, [sessionReady, month, year, lane, departmentId, courseTypeId, courseId, specialityId, stage, status, chiefGuideId]);

  function handleSearchSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    load();
  }

  function clearAllFilters() {
    setQ('');
    setDepartmentId('');
    setCourseTypeId('');
    setCourseId('');
    setSpecialityId('');
    setStage('');
    setStatus('');
    setChiefGuideId('');
    setLane('');
    load({
      q: '',
      departmentId: '',
      courseTypeId: '',
      courseId: '',
      specialityId: '',
      stage: '',
      status: '',
      chiefGuideId: '',
      lane: '',
    });
  }

  const hasActiveFilters = Boolean(
    q || departmentId || courseTypeId || courseId || specialityId || stage || status || chiefGuideId || lane
  );

  const courseTypeOf = (item: any) =>
    String(item.courseTypeId || courses.find((c) => String(c._id) === String(item.courseId))?.courseTypeId || '');
  const usedCourseIds = new Set(optionItems.map((i) => String(i.courseId || '')).filter(Boolean));
  const usedCourseTypeIds = new Set(optionItems.map(courseTypeOf).filter(Boolean));
  const availableCourseTypes = courseTypes.filter(
    (ct) => usedCourseTypeIds.has(String(ct._id)) || String(ct._id) === String(courseTypeId)
  );

  const filteredCourses = courses.filter((c) => {
    if (!usedCourseIds.has(String(c._id)) && String(c._id) !== String(courseId)) return false;
    if (courseTypeId && c.courseTypeId && String(c.courseTypeId) !== String(courseTypeId)) return false;
    if (departmentId && c.departmentId && String(c.departmentId) !== String(departmentId)) return false;
    return true;
  });

  const { scopedDepts, scopedSpecs } = scopeLookups(user, courses, depts, specialities, departmentId, specialityId);
  const filteredSpecs = scopedSpecs.filter((s) => {
    if (!courseId) return true;
    return !s.courseId || String(s.courseId) === String(courseId);
  });

  const displayRows = rows.filter((item) => {
    if (q) {
      const qLower = q.toLowerCase();
      const matchCandidate = item.candidate?.name?.toLowerCase().includes(qLower);
      const matchEnroll = item.candidate?.enrollmentNo?.toLowerCase().includes(qLower);
      const matchTitle = item.title?.toLowerCase().includes(qLower);
      const matchThesisNo = item.thesisNumber?.toLowerCase().includes(qLower);
      const matchFileNo = item.fileNo?.toLowerCase().includes(qLower);
      const matchGuide = item.chiefGuideName?.toLowerCase().includes(qLower);
      if (!matchCandidate && !matchEnroll && !matchTitle && !matchThesisNo && !matchFileNo && !matchGuide) return false;
    }
    if (departmentId && String(item.departmentId) !== String(departmentId)) return false;
    if (courseId && String(item.courseId) !== String(courseId)) return false;
    if (courseTypeId && item.courseTypeId && String(item.courseTypeId) !== String(courseTypeId)) return false;
    if (specialityId && String(item.specialityId) !== String(specialityId)) return false;
    if (chiefGuideId && String(item.chiefGuideId) !== String(chiefGuideId)) return false;
    if (stage && !stage.startsWith('remind_') && String(item.currentStageCode) !== String(stage)) return false;
    if (status && String(item.status) !== String(status)) return false;
    if (lane && String(item.lane) !== String(lane)) return false;
    return true;
  }).sort(compareByCourseThenCandidate);

  const lanes = rows.reduce<Record<string, number>>((acc, r) => {
    if (r.lane) acc[r.lane] = (acc[r.lane] || 0) + 1;
    return acc;
  }, {});

  const numberableIds = canAssignNumbers ? displayRows.filter(needsThesisNumber).map((r) => r._id) : [];
  const showNumbering = numberableIds.length > 0;
  const bulk = useBulkApprove(displayRows, load, setOk, setError);
  const panelBulk = useBulkPanelRequest(displayRows, load, setOk, setError);
  const panelResendBulk = useBulkPanelRequest(displayRows, load, setOk, setError, 'resend');
  const reminderBulk = useBulkAct(displayRows, load, setOk, setError, { kind: 'REMINDER', field: 'canBulkReminder', verb: 'Reminder' });
  const dispatchBulk = useBulkAct(displayRows, load, setOk, setError, { kind: 'DISPATCH', field: 'canBulkDispatch', verb: 'Dispatch' });
  const vetBulk = useBulkAct(displayRows, load, setOk, setError, { kind: 'VET_APPROVE', field: 'canBulkVetApprove', verb: 'Approval' });
  const closeBulk = useBulkAct(displayRows, load, setOk, setError, { kind: 'CLOSE', field: 'canBulkClose', verb: 'Close' });
  const simpleBulk = pickSimpleBulk({ reminderBulk, dispatchBulk, vetBulk, closeBulk });

  function thesisValue(id: string) {
    const row = displayRows.find((r) => r._id === id);
    return (numbers[id] ?? row?.thesisNumber ?? '').trim();
  }

  function requestBulk() {
    setError(null);
    setOk(null);
    if (!selected.length) {
      setError('Select at least 1 row');
      return;
    }
    setConfirm({ kind: 'bulk' });
  }

  function requestOne(id: string) {
    setError(null);
    setOk(null);
    const row = displayRows.find((r) => r._id === id);
    if (!needsThesisNumber(row)) {
      setError('Thesis number can be added only after ACE approval');
      return;
    }
    if (!thesisValue(id)) {
      setError('Thesis number is required');
      return;
    }
    setConfirm({ kind: 'single', id });
  }

  async function runAssign(items: { id: string; thesisNumber: string }[]) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const result = await post('/files/thesis-numbers', { items });
      const saved: string[] = result.saved || [];
      const failed: { id: string; message: string }[] = result.failed || [];
      if (saved.length) {
        setOk(`Thesis no. saved for ${saved.length} file${saved.length === 1 ? '' : 's'}.`);
      }
      if (failed.length) {
        setError(
          failed
            .map((f) => {
              const row = displayRows.find((r) => r._id === f.id);
              return `${row?.candidate?.name || row?.candidate?.enrollmentNo || f.id}: ${f.message}`;
            })
            .join(' '),
        );
      }
      setSelected([]);
      setConfirm(null);
      await load();
    } catch (e: any) {
      setError(e.message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  function confirmAssign() {
    if (!confirm || busy) return;
    const next = confirm;
    setConfirm(null);
    if (next.kind === 'single') {
      void runAssign([{ id: next.id, thesisNumber: thesisValue(next.id) }]);
      return;
    }
    void runAssign(selected.map((id) => ({ id, thesisNumber: thesisValue(id) })));
  }

  const exportCols = [
    { key: 'courseTypeName', label: 'Course type' },
    { key: 'courseName', label: 'Course' },
    { key: 'departmentName', label: 'Department' },
    { key: 'candidate', label: 'Candidate' },
    { key: 'enrollmentNo', label: 'Enrollment' },
    { key: 'title', label: 'Title' },
    { key: 'specialityName', label: 'Speciality' },
    { key: 'chiefGuideName', label: 'Chief Guide' },
    { key: 'thesisNumber', label: 'No.' },
    { key: 'queue', label: 'Queue' },
    { key: 'status', label: 'Status' },
    { key: 'examinerConsent', label: 'Examiner Consent' },
  ];
  const exportRows = displayRows.map((r) => {
    const stats = r.examinerConsent || getExaminerConsentStats(r);
    return {
      candidate: r.candidate?.name,
      enrollmentNo: r.candidate?.enrollmentNo,
      title: r.title,
      departmentName: r.departmentName,
      courseTypeName: r.courseTypeName,
      courseName: r.courseName,
      specialityName: r.specialityName,
      chiefGuideName: r.chiefGuideName,
      thesisNumber: r.thesisNumber || r.fileNo,
      queue: r.laneLabel || r.lane || r.currentStageCode,
      status: r.status,
      examinerConsent:
        stats.approved > 0
          ? `${stats.accepted} / ${stats.approved} Accepted${stats.regretted > 0 ? ` (${stats.regretted} refused)` : ''}`
          : '—',
    };
  });

  const activeDept = depts.find((d) => String(d._id) === String(departmentId));
  const activeCourseType = courseTypes.find((ct) => String(ct._id) === String(courseTypeId));
  const activeCourse = courses.find((c) => String(c._id) === String(courseId));
  const activeSpec = specialities.find((s) => String(s._id) === String(specialityId));
  const activeStage = stageChoices.find((s) => s.stageCode === stage);
  const activeGuide = faculty.find((f) => String(f._id) === String(chiefGuideId));

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>
            {isCourseRole(user?.role) ? 'Academic thesis' : 'Files'}
          </h1>
          <p>
            {user?.role === 'INSTITUTE_ADMIN'
              ? 'Oversight only. Create courses and academic logins; those logins initiate new files.'
              : isCourseRole(user?.role)
                  ? 'Sent files follow the course-type blueprint. Open a candidate to work File 360 / metro. Drafts stay under Added thesis until Send to Examination Section.'
                  : 'Every thesis in this institute.'}
          </p>
        </div>
        {isCourseRole(user?.role) && (
          <Link className="btn" to="/app/files/new">
            Add thesis
          </Link>
        )}
      </div>

      <div className="inbox-filter-panel">
        <div className="inbox-filter-header">
          <div className="inbox-filter-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filter Files
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              className="btn small secondary"
              onClick={clearAllFilters}
            >
              Reset All Filters
            </button>
          )}
        </div>

        <div className="inbox-filter-grid">
          {/* 1. Academic Session Month */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Session Month</span>
            <select
              value={month}
              onChange={(e) => {
                const nextMonth = e.target.value;
                setMonth(nextMonth);
                load({ month: nextMonth });
              }}
              aria-label="Session Month"
            >
              <option value="">All months</option>
              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* 2. Academic Session Year */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Session Year</span>
            <select
              value={year}
              onChange={(e) => {
                const nextYear = e.target.value;
                setYear(nextYear);
                load({ year: nextYear });
              }}
              aria-label="Session Year"
            >
              <option value="">All years</option>
              {Array.from(new Set(sessions.map((s) => s.year).filter(Boolean))).sort((a, b) => Number(b) - Number(a)).map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          </div>

          {/* 3. Department */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Department</span>
            <select
              value={departmentId}
              onChange={(e) => {
                const next = e.target.value;
                setDepartmentId(next);
                load({ departmentId: next });
              }}
              aria-label="Department"
            >
              <option value="">All departments</option>
              {scopedDepts.map((d) => (
                <option key={d._id} value={d._id}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* 4. Course Type */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Course Type</span>
            <select
              value={courseTypeId}
              onChange={(e) => {
                const next = e.target.value;
                setCourseTypeId(next);
                setCourseId('');
                setSpecialityId('');
                load({ courseTypeId: next, courseId: '', specialityId: '' });
              }}
              aria-label="Course Type"
            >
              <option value="">All course types</option>
              {availableCourseTypes.map((ct) => (
                <option key={ct._id} value={ct._id}>{ct.name}</option>
              ))}
            </select>
          </div>

          {/* 5. Course */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Course</span>
            <select
              value={courseId}
              onChange={(e) => {
                const next = e.target.value;
                setCourseId(next);
                setSpecialityId('');
                load({ courseId: next, specialityId: '' });
              }}
              aria-label="Course"
            >
              <option value="">All courses</option>
              {filteredCourses.map((c) => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* 6. Speciality */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Speciality</span>
            <select
              value={specialityId}
              onChange={(e) => {
                const next = e.target.value;
                setSpecialityId(next);
                load({ specialityId: next });
              }}
              aria-label="Speciality"
            >
              <option value="">All specialities</option>
              {filteredSpecs.map((s) => (
                <option key={s._id} value={s._id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* 7. Workflow Step / Stage */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Workflow Step</span>
            <select
              value={stage}
              onChange={(e) => {
                const next = e.target.value;
                setStage(next);
                load({ stage: next });
              }}
              aria-label="Workflow step"
            >
              <option value="">All steps</option>
              {stageChoices.map((s) => (
                <option key={s.stageCode} value={s.stageCode}>
                  {s.stageName} {s.count ? `(${s.count})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 8. Queue / Action Lane */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Queue / Lane</span>
            <select
              value={lane}
              onChange={(e) => {
                const next = e.target.value;
                setLane(next);
                load({ lane: next });
              }}
              aria-label="Queue or lane"
            >
              <option value="">All queues</option>
              {Object.keys(INBOX_LANE_LABELS).map((code) => (
                <option key={code} value={code}>
                  {INBOX_LANE_LABELS[code]} {lanes[code] ? `(${lanes[code]})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 9. Chief Guide */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Chief Guide</span>
            <select
              value={chiefGuideId}
              onChange={(e) => {
                const next = e.target.value;
                setChiefGuideId(next);
                load({ chiefGuideId: next });
              }}
              aria-label="Chief Guide"
            >
              <option value="">All chief guides</option>
              {faculty.filter((f) => f.canGuide !== false).map((f) => (
                <option key={f._id} value={f._id}>
                  {f.name} {f.designation ? `(${f.designation})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 10. Status */}
          <div className="inbox-filter-field">
            <span className="inbox-filter-label">Status</span>
            <select
              value={status}
              onChange={(e) => {
                const next = e.target.value;
                setStatus(next);
                load({ status: next });
              }}
              aria-label="Status"
            >
              <option value="">All statuses</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="ON_HOLD">On Hold</option>
              <option value="COMPLETED">Completed</option>
              <option value="REJECTED">Rejected</option>
              <option value="DRAFT">Draft</option>
            </select>
          </div>

          {/* 11. Search Input */}
          <form className="inbox-filter-search-box" onSubmit={handleSearchSubmit}>
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search candidate name, enrollment no., title, thesis no., file no., guide..."
              aria-label="Search files"
            />
            {q && (
              <button
                type="button"
                className="btn small secondary"
                onClick={() => {
                  setQ('');
                  load({ q: '' });
                }}
                aria-label="Clear search"
              >
                Clear
              </button>
            )}
            <button type="submit" className="btn small secondary">
              Search
            </button>
          </form>
        </div>

        {/* Active Filter Tags */}
        {hasActiveFilters && (
          <div className="filter-active-tags">
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Active Filters:</span>
            {q && (
              <span className="filter-tag-pill">
                Search: &ldquo;{q}&rdquo;
                <button type="button" onClick={() => { setQ(''); load({ q: '' }); }} aria-label="Remove search filter">&times;</button>
              </span>
            )}
            {month && (
              <span className="filter-tag-pill">
                Month: {month}
                <button type="button" onClick={() => { setMonth(''); load({ month: '' }); }} aria-label="Remove month filter">&times;</button>
              </span>
            )}
            {year && (
              <span className="filter-tag-pill">
                Year: {year}
                <button type="button" onClick={() => { setYear(''); load({ year: '' }); }} aria-label="Remove year filter">&times;</button>
              </span>
            )}
            {activeDept && (
              <span className="filter-tag-pill">
                Dept: {activeDept.name}
                <button type="button" onClick={() => { setDepartmentId(''); load({ departmentId: '' }); }} aria-label="Remove department filter">&times;</button>
              </span>
            )}
            {activeCourseType && (
              <span className="filter-tag-pill">
                Type: {activeCourseType.name}
                <button type="button" onClick={() => { setCourseTypeId(''); load({ courseTypeId: '' }); }} aria-label="Remove course type filter">&times;</button>
              </span>
            )}
            {activeCourse && (
              <span className="filter-tag-pill">
                Course: {activeCourse.name}
                <button type="button" onClick={() => { setCourseId(''); load({ courseId: '' }); }} aria-label="Remove course filter">&times;</button>
              </span>
            )}
            {activeSpec && (
              <span className="filter-tag-pill">
                Speciality: {activeSpec.name}
                <button type="button" onClick={() => { setSpecialityId(''); load({ specialityId: '' }); }} aria-label="Remove speciality filter">&times;</button>
              </span>
            )}
            {activeStage && (
              <span className="filter-tag-pill">
                Step: {activeStage.stageName}
                <button type="button" onClick={() => { setStage(''); load({ stage: '' }); }} aria-label="Remove step filter">&times;</button>
              </span>
            )}
            {lane && (
              <span className="filter-tag-pill">
                Queue: {INBOX_LANE_LABELS[lane] || lane}
                <button type="button" onClick={() => { setLane(''); load({ lane: '' }); }} aria-label="Remove queue filter">&times;</button>
              </span>
            )}
            {activeGuide && (
              <span className="filter-tag-pill">
                Guide: {activeGuide.name}
                <button type="button" onClick={() => { setChiefGuideId(''); load({ chiefGuideId: '' }); }} aria-label="Remove guide filter">&times;</button>
              </span>
            )}
            {status && (
              <span className="filter-tag-pill">
                Status: {status.replace('_', ' ')}
                <button type="button" onClick={() => { setStatus(''); load({ status: '' }); }} aria-label="Remove status filter">&times;</button>
              </span>
            )}
            <button
              type="button"
              className="btn small"
              style={{ padding: '2px 8px', fontSize: 11, background: '#c0392b', color: '#fff', border: 0 }}
              onClick={clearAllFilters}
            >
              Clear All
            </button>
          </div>
        )}
      </div>

      {/* Queue Lane Toggle Buttons */}
      {Object.keys(lanes).length > 0 && (
        <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button
            className={`btn small ${!lane ? '' : 'secondary'}`}
            onClick={() => { setLane(''); load({ lane: '' }); }}
          >
            All ({rows.length})
          </button>
          {Object.entries(lanes).map(([code, count]) => (
            <button
              key={code}
              className={`btn small ${lane === code ? '' : 'secondary'}`}
              onClick={() => { setLane(code); load({ lane: code }); }}
            >
              {INBOX_LANE_LABELS[code] || code.replaceAll('_', ' ')} ({count})
            </button>
          ))}
        </div>
      )}

      <ErrorBox error={error} />
      {ok ? <div className="okbox">{ok}</div> : null}

      <div className="card">
        <div className="files-toolbar" style={{ marginBottom: 12 }}>
          <b>
            Total Thesis: {displayRows.length}
            {displayRows.length !== rows.length ? ` (filtered from ${rows.length})` : ''}
          </b>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <ExportButtons columns={exportCols} rows={exportRows} filename="files" title="Files" />
            {showNumbering && (
              <button
                type="button"
                className="btn small secondary"
                onClick={requestBulk}
                disabled={busy}
              >
                Add Multiple Thesis No.
              </button>
            )}
            {bulk.approval && (
              <button type="button" className="btn small" onClick={bulk.request} disabled={bulk.approving}>
                {bulk.approving ? 'Approving…' : `Approve selected (${bulk.selected.length})`}
              </button>
            )}
            {panelBulk.selection && (
              <button
                type="button"
                className="btn small"
                onClick={() => void panelBulk.request()}
                disabled={panelBulk.sending || panelBulk.loadingPreview}
              >
                {panelBulk.buttonLabel}
              </button>
            )}
            {panelResendBulk.selection && (
              <button
                type="button"
                className="btn small"
                onClick={() => void panelResendBulk.request()}
                disabled={panelResendBulk.sending || panelResendBulk.loadingPreview}
              >
                {panelResendBulk.buttonLabel}
              </button>
            )}
            {simpleBulk && (
              <button
                type="button"
                className="btn small"
                onClick={() => simpleBulk.hook.setConfirm(true)}
                disabled={simpleBulk.hook.busy}
              >
                {simpleBulk.hook.busy ? 'Working…' : simpleBulk.button}
              </button>
            )}
          </div>
        </div>

        <FileTable
          rows={displayRows}
          onEditCandidate={setEditingFile}
          approval={bulk.approval}
          panelRequest={panelBulk.selection}
          panelResend={panelResendBulk.selection}
          bulkPick={simpleBulk?.hook.selection}
          bulkPickLabel={simpleBulk?.label}
          numbering={
            showNumbering
              ? {
                  selected,
                  numbers,
                  busy,
                  onToggle: (id) => {
                    if (!numberableIds.includes(id)) return;
                    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
                  },
                  onToggleAll: (ids) => setSelected(ids),
                  onNumberChange: (id, value) => setNumbers((prev) => ({ ...prev, [id]: value })),
                  onSaveOne: requestOne,
                }
              : undefined
          }
        />
      </div>

      {bulk.confirmOpen && (
        <ConfirmDialog
          title="Approve selected files?"
          message={`Approve ${bulk.selected.length} selected file${bulk.selected.length === 1 ? '' : 's'} and send them to the next step?`}
          yesLabel="Yes, approve"
          noLabel="Cancel"
          onYes={() => void bulk.run()}
          onNo={() => bulk.setConfirmOpen(false)}
        />
      )}

      {panelBulk.confirm && (
        <ConfirmDialog
          title="Review mail and request panel?"
          message={panelBulk.confirm.message}
          detail={panelBulk.confirm.detail}
          yesLabel={`Yes, send ${panelBulk.selected.length} mail${panelBulk.selected.length === 1 ? '' : 's'}`}
          noLabel="Cancel"
          onYes={() => void panelBulk.run()}
          onNo={() => panelBulk.setConfirm(null)}
        />
      )}

      {panelResendBulk.confirm && (
        <ConfirmDialog
          title="Review mail and resend panel request?"
          message={panelResendBulk.confirm.message}
          detail={panelResendBulk.confirm.detail}
          yesLabel={`Yes, send ${panelResendBulk.selected.length} mail${panelResendBulk.selected.length === 1 ? '' : 's'}`}
          noLabel="Cancel"
          onYes={() => void panelResendBulk.run()}
          onNo={() => panelResendBulk.setConfirm(null)}
        />
      )}

      {simpleBulk && simpleBulk.hook.confirm && (
        <ConfirmDialog
          title={simpleBulk.title}
          message={simpleBulk.message}
          yesLabel="Yes, proceed"
          noLabel="Cancel"
          onYes={() => void simpleBulk.hook.run()}
          onNo={() => simpleBulk.hook.setConfirm(false)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'bulk' ? 'Are you sure?' : 'Save thesis number?'}
          message={
            confirm.kind === 'bulk'
              ? 'Save numbers and send ready files to Assoc Dean?'
              : 'You want to save this thesis number?'
          }
          yesLabel={confirm.kind === 'bulk' ? 'Yes, send it' : 'Yes, save this'}
          noLabel="Cancel"
          onYes={confirmAssign}
          onNo={() => setConfirm(null)}
        />
      )}

      {editingFile && (
        <EditCandidateModal
          file={editingFile}
          departments={depts}
          courseTypes={courseTypes}
          courses={courses}
          specialities={specialities}
          faculty={faculty}
          onClose={() => setEditingFile(null)}
          onSaved={() => {
            setEditingFile(null);
            setOk('Candidate information updated successfully.');
            load();
          }}
        />
      )}
    </Shell>
  );
}

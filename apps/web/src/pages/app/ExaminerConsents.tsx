import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../../api';
import { Shell } from '../../components/Shell';
import { ConfirmDialog, Empty, ErrorBox, ExportButtons, Field, PageLoader, Pill, ResultDialog } from '../../components/ui';
import { SessionFilter } from '../../components/SessionFilter';
import { applySessionParams, useSessionFilter } from '../../session';

type Tab = 'ALL' | 'NOT_SENT' | 'ACCEPTED' | 'PENDING' | 'REGRETTED';
type Kind = 'offer' | 'resend' | 'thesis';

const TABS: { key: Tab; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'NOT_SENT', label: 'Offer not sent' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'PENDING', label: 'Waiting to accept' },
  { key: 'REGRETTED', label: 'Regretted' },
];

const EXPORT_COLS = [
  { key: 'thesisNumber', label: 'Thesis no.' },
  { key: 'fileNo', label: 'File no.' },
  { key: 'candidateName', label: 'Candidate' },
  { key: 'courseName', label: 'Course' },
  { key: 'specialityName', label: 'Speciality' },
  { key: 'examinerName', label: 'Examiner' },
  { key: 'examinerEmail', label: 'Email' },
  { key: 'examinerMobile', label: 'Mobile' },
  { key: 'consentStatus', label: 'Consent' },
  { key: 'offerSent', label: 'Offer sent' },
  { key: 'thesisSent', label: 'Thesis sent' },
  { key: 'stageName', label: 'File stage' },
];

const CHUNK = 25;

function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleString() : '';
}

function tabOf(r: any): Tab {
  if (r.offerPending) return 'NOT_SENT';
  if (r.consentStatus === 'ACCEPTED') return 'ACCEPTED';
  if (r.consentStatus === 'REGRETTED') return 'REGRETTED';
  return 'PENDING';
}

/** Offer not sent → offer letter; waiting to accept → offer letter again; everyone else → thesis letter. */
function kindOf(r: any): Kind {
  if (r.offerPending) return 'offer';
  return tabOf(r) === 'PENDING' ? 'resend' : 'thesis';
}

function sendable(r: any) {
  const kind = kindOf(r);
  return kind === 'offer' ? r.canSendOffer : kind === 'resend' ? r.canResendOffer : r.canSend;
}

function blockedReason(r: any) {
  const kind = kindOf(r);
  return kind === 'offer' ? r.offerBlockedReason : kind === 'resend' ? r.resendOfferBlockedReason : r.blockedReason;
}

export function ExaminerConsentsPage() {
  const { sessions, month, year, setMonth, setYear, ready } = useSessionFilter();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('ACCEPTED');
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ rows: any[]; kind: Kind } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function load() {
    const params = applySessionParams(new URLSearchParams(), month, year);
    if (q.trim()) params.set('q', q.trim());
    setLoading(true);
    setError(null);
    get(`/examiner-consents?${params.toString()}`)
      .then((data) => {
        setItems(Array.isArray(data?.items) ? data.items : []);
        setSelected([]);
      })
      .catch((e: any) => setError(e.message || 'Could not load examiners'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, month, year]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { ALL: items.length, NOT_SENT: 0, ACCEPTED: 0, PENDING: 0, REGRETTED: 0 };
    for (const r of items) c[tabOf(r)]++;
    return c;
  }, [items]);

  const rows = tab === 'ALL' ? items : items.filter((r) => tabOf(r) === tab);
  // Header checkbox: everyone sendable, except accepted examiners who already have the thesis.
  const unsent = rows.filter((r) => sendable(r) && !(kindOf(r) === 'thesis' && r.thesisSentAt));
  const selectedRows = items.filter((r) => selected.includes(r.id));
  const selectedOffers = selectedRows.filter((r) => kindOf(r) === 'offer');
  const selectedResends = selectedRows.filter((r) => kindOf(r) === 'resend');
  const selectedThesis = selectedRows.filter((r) => kindOf(r) === 'thesis');
  const exportRows = rows.map((r) => ({ ...r, offerSent: fmt(r.offerSentAt), thesisSent: fmt(r.thesisSentAt) }));

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function toggleAllUnsent() {
    const ids = unsent.map((r) => r.id);
    const allOn = ids.length > 0 && ids.every((id) => selected.includes(id));
    setSelected((cur) => (allOn ? cur.filter((id) => !ids.includes(id)) : [...new Set([...cur, ...ids])]));
  }

  async function send(list: any[], kind: Kind) {
    setConfirm(null);
    const what = kind === 'thesis' ? 'Thesis / evaluation letter' : 'Offer letter';
    const endpoint = kind === 'thesis' ? 'send-thesis' : 'send-offer';
    let sent = 0;
    const failed: string[] = [];
    try {
      for (let i = 0; i < list.length; i += CHUNK) {
        const chunk = list.slice(i, i + CHUNK);
        setBusy(`Sending ${what.toLowerCase()}s… ${Math.min(i + CHUNK, list.length)} / ${list.length}`);
        const r: any = await post(`/examiner-consents/${endpoint}`, {
          // Thesis: the confirm dialog already warns about repeats. Offer: resend only for waiting examiners.
          resend: kind !== 'offer',
          items: chunk.map((row) => ({ fileId: row.fileId, panelIndex: row.panelIndex })),
        });
        sent += r?.sent?.length || 0;
        for (const f of r?.failed || []) {
          const row = list.find((x) => x.id === f.id);
          failed.push(`${row?.examinerName || f.id} (${row?.thesisNumber || 'file'}): ${f.message}`);
        }
      }
      setResult({
        ok: !failed.length,
        message: `${what} ${kind === 'resend' ? 'resent' : 'sent'} to ${sent} examiner(s).${failed.length ? ` Not sent: ${failed.join('; ')}` : ''}`,
      });
    } catch (e: any) {
      setResult({ ok: false, message: e.message || `Could not send ${what.toLowerCase()}s` });
    } finally {
      setBusy(null);
      load();
    }
  }

  return (
    <Shell mode="app">
      <div className="page-head">
        <div>
          <h1>Examiner consent</h1>
          <p className="guide-muted">
            Examiners who were emailed the offer letter, and their reply. "Offer not sent" lists assigned examiners still
            waiting for the offer (acceptance) letter: send it once AO / ACE / Assoc. Dean routing is done. Send the thesis
            to anyone who accepted, one by one or in bulk. Nothing in the existing File 360 steps changes.
          </p>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <Field label="Session">
            <SessionFilter
              sessions={sessions}
              month={month}
              year={year}
              onChange={(m, y) => {
                setMonth(m);
                setYear(y);
              }}
            />
          </Field>
          <Field label="Search">
            <input
              className="input"
              value={q}
              placeholder="Thesis no., candidate, examiner…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') load();
              }}
            />
          </Field>
          <button type="button" className="btn secondary" onClick={load} disabled={loading}>
            Search
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={tab === t.key ? 'btn small' : 'btn secondary small'}
              onClick={() => {
                setTab(t.key);
                setSelected([]);
              }}
            >
              {t.label} ({counts[t.key]})
            </button>
          ))}
        </div>
        <div className="files-toolbar" style={{ marginBottom: 12 }}>
          <b>
            {rows.length} examiner(s){loading ? ' (loading…)' : ''}
            {selected.length ? ` · ${selected.length} selected` : ''}
          </b>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <ExportButtons columns={EXPORT_COLS} rows={exportRows} filename="examiner-consent" title="Examiner consent" />
            {tab === 'NOT_SENT' || selectedOffers.length ? (
              <button
                type="button"
                className="btn small"
                disabled={!!busy || !selectedOffers.length}
                onClick={() => setConfirm({ rows: selectedOffers, kind: 'offer' })}
              >
                Send offer to selected ({selectedOffers.length})
              </button>
            ) : null}
            {tab === 'PENDING' || selectedResends.length ? (
              <button
                type="button"
                className="btn small"
                disabled={!!busy || !selectedResends.length}
                onClick={() => setConfirm({ rows: selectedResends, kind: 'resend' })}
              >
                Resend offer to selected ({selectedResends.length})
              </button>
            ) : null}
            {tab !== 'NOT_SENT' && tab !== 'PENDING' ? (
              <button
                type="button"
                className="btn small"
                disabled={!!busy || !selectedThesis.length}
                onClick={() => setConfirm({ rows: selectedThesis, kind: 'thesis' })}
              >
                Send thesis to selected ({selectedThesis.length})
              </button>
            ) : null}
          </div>
        </div>
        {!rows.length ? (
          <Empty>{loading ? 'Loading…' : 'No examiners in this list.'}</Empty>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={unsent.length > 0 && unsent.every((r) => selected.includes(r.id))}
                      disabled={!unsent.length}
                      onChange={toggleAllUnsent}
                      aria-label="Select all examiners not yet sent their letter"
                      title="Select all examiners not yet sent their letter"
                    />
                  </th>
                  <th>Thesis no.</th>
                  <th>Candidate</th>
                  <th>Course / Speciality</th>
                  <th>Examiner</th>
                  <th>Consent</th>
                  <th>Offer sent</th>
                  <th>Thesis</th>
                  <th>File stage</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(r.id)}
                        disabled={!sendable(r)}
                        title={sendable(r) ? '' : blockedReason(r)}
                        onChange={() => toggle(r.id)}
                        aria-label={`Select ${r.examinerName}`}
                      />
                    </td>
                    <td>
                      {r.thesisNumber || '—'}
                      {r.fileNo ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.fileNo}</div> : null}
                    </td>
                    <td>{r.candidateName || '—'}</td>
                    <td>
                      {r.courseName}
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.specialityName}</div>
                    </td>
                    <td>
                      <b>{r.examinerName || '—'}</b>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {[r.examinerEmail, r.examinerMobile].filter(Boolean).join(' · ')}
                      </div>
                      {r.examinerDesignation || r.examinerAffiliation ? (
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {[r.examinerDesignation, r.examinerAffiliation].filter(Boolean).join(', ')}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {r.offerPending ? (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Offer not sent</span>
                      ) : (
                        <Pill status={r.consentStatus} />
                      )}
                      {r.consentStatus === 'REGRETTED' && r.consentRemark ? (
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.consentRemark}</div>
                      ) : null}
                    </td>
                    <td style={{ fontSize: 12 }}>{fmt(r.offerSentAt) || '—'}</td>
                    <td style={{ fontSize: 12 }}>
                      {r.evaluationSubmitted ? (
                        <Pill status="COMPLETED" />
                      ) : r.thesisSentAt ? (
                        <>Sent {fmt(r.thesisSentAt)}</>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>Not sent</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.stageName}</td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {r.offerPending ? (
                          r.canSendOffer ? (
                            <button
                              type="button"
                              className="btn small"
                              disabled={!!busy}
                              onClick={() => setConfirm({ rows: [r], kind: 'offer' })}
                            >
                              Send offer
                            </button>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.offerBlockedReason}</span>
                          )
                        ) : kindOf(r) === 'resend' ? (
                          r.canResendOffer ? (
                            <button
                              type="button"
                              className="btn secondary small"
                              disabled={!!busy}
                              onClick={() => setConfirm({ rows: [r], kind: 'resend' })}
                            >
                              Resend offer
                            </button>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.resendOfferBlockedReason}</span>
                          )
                        ) : r.canSend ? (
                          <button
                            type="button"
                            className={r.thesisSentAt ? 'btn secondary small' : 'btn small'}
                            disabled={!!busy}
                            onClick={() => setConfirm({ rows: [r], kind: 'thesis' })}
                          >
                            {r.thesisSentAt ? 'Resend thesis' : 'Send thesis'}
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.blockedReason}</span>
                        )}
                        <Link className="btn small secondary" to={`/app/files/${r.fileId}`}>
                          File 360
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {confirm ? (
        <ConfirmDialog
          title={
            confirm.kind === 'offer'
              ? confirm.rows.length === 1
                ? 'Send offer letter?'
                : `Send offer letter to ${confirm.rows.length} examiners?`
              : confirm.kind === 'resend'
                ? confirm.rows.length === 1
                  ? 'Resend offer letter?'
                  : `Resend offer letter to ${confirm.rows.length} examiners?`
                : confirm.rows.length === 1
                ? 'Send thesis?'
                : `Send thesis to ${confirm.rows.length} examiners?`
          }
          message={
            confirm.kind === 'offer'
              ? confirm.rows.length === 1
                ? `Email the offer (acceptance) letter to ${confirm.rows[0].examinerName} (${confirm.rows[0].examinerEmail})?`
                : `Email the offer (acceptance) letter to ${confirm.rows.length} examiners?`
              : confirm.kind === 'resend'
                ? confirm.rows.length === 1
                  ? `Email the offer (acceptance) letter again to ${confirm.rows[0].examinerName} (${confirm.rows[0].examinerEmail})? They were first sent it on ${fmt(confirm.rows[0].offerSentAt)}.`
                  : `Email the offer (acceptance) letter again to ${confirm.rows.length} examiners who have not replied yet?`
                : confirm.rows.length === 1
              ? `Email the thesis / evaluation link to ${confirm.rows[0].examinerName} (${confirm.rows[0].examinerEmail})?${
                  confirm.rows[0].thesisSentAt ? ' They were already sent it once.' : ''
                }`
              : `Email the thesis / evaluation link to ${confirm.rows.length} accepted examiners?${
                  confirm.rows.some((r) => r.thesisSentAt)
                    ? ` ${confirm.rows.filter((r) => r.thesisSentAt).length} of them were already sent it and will get it again.`
                    : ''
                }`
          }
          yesLabel="Send"
          noLabel="Cancel"
          onYes={() => send(confirm.rows, confirm.kind)}
          onNo={() => setConfirm(null)}
        />
      ) : null}
      {busy ? <PageLoader message={busy} /> : null}
      {result ? <ResultDialog ok={result.ok} message={result.message} onClose={() => setResult(null)} /> : null}
    </Shell>
  );
}

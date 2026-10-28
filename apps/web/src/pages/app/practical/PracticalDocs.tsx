import { FormEvent, useEffect, useMemo, useState } from 'react';
import { PRACTICAL_DOC_TYPES, PRACTICAL_QUESTION_PAPER } from '@ethesis/shared';
import { del, get, post } from '../../../api';
import { Shell } from '../../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons, Field } from '../../../components/ui';
import { usePracticalMeta } from './common';
import { openAuthedFile } from './extras';

type DocRow = {
  _id: string;
  kind: string;
  uploadType?: number;
  typeLabel: string;
  courseName: string;
  specialityName: string;
  originalName: string;
  uploadedBy?: string;
  createdAt?: string;
};

/**
 * "Upload Previous Question Paper" (one paper per course + speciality per session) and
 * "Upload all Documents" (guidelines, remuneration, TA/DA documents shown on the examiner portal).
 */
export function PracticalDocsPage({ mode }: { mode: 'question-papers' | 'documents' }) {
  const isPaper = mode === 'question-papers';
  const { meta, error: metaError } = usePracticalMeta();
  const [sessionId, setSessionId] = useState('');
  const [rows, setRows] = useState<DocRow[]>([]);
  const [courseId, setCourseId] = useState('');
  const [specialityId, setSpecialityId] = useState('');
  const [uploadType, setUploadType] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<DocRow | null>(null);

  const canEdit = !!meta?.can.edit;
  const typeDef = PRACTICAL_DOC_TYPES.find((t) => String(t.code) === uploadType);
  const specs = useMemo(() => (meta?.specialities || []).filter((s) => String(s.courseId) === courseId), [meta, courseId]);

  useEffect(() => {
    if (meta && !sessionId) setSessionId(meta.currentSessionId || meta.sessions[0]?._id || '');
  }, [meta]);

  async function load() {
    try {
      const q = isPaper ? `?kind=${PRACTICAL_QUESTION_PAPER}&sessionId=${sessionId}` : '?kind=DOC';
      if (isPaper && !sessionId) return;
      setRows(await get<DocRow[]>(`/practical/documents${q}`));
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [sessionId, mode]);

  async function upload(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!file) return setError('Choose a PDF file');
    const fd = new FormData();
    fd.append('file', file);
    if (isPaper) {
      if (!courseId || !specialityId) return setError('Select Course and Speciality');
      fd.append('kind', PRACTICAL_QUESTION_PAPER);
      fd.append('courseId', courseId);
      fd.append('specialityId', specialityId);
      fd.append('sessionId', sessionId);
    } else {
      if (!typeDef) return setError('Select the upload type');
      if (typeDef.perCourse && !courseId) return setError('Select the course for this document');
      fd.append('kind', 'DOC');
      fd.append('uploadType', String(typeDef.code));
      if (typeDef.perCourse) fd.append('courseId', courseId);
    }
    setBusy(true);
    try {
      await post('/practical/documents', fd);
      setNotice('Uploaded. A new upload for the same slot replaces the old file.');
      setFile(null);
      setFileKey((k) => k + 1);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    const r = deleting;
    setDeleting(null);
    if (!r) return;
    try {
      await del(`/practical/documents/${r._id}`);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const shown = rows.filter((r) =>
    `${r.courseName} ${r.specialityName} ${r.typeLabel} ${r.originalName}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const cols = isPaper
    ? [
        { key: 'courseName', label: 'Course Name' },
        { key: 'specialityName', label: 'Speciality' },
        { key: 'originalName', label: 'File' },
      ]
    : [
        { key: 'typeLabel', label: 'Document' },
        { key: 'courseName', label: 'Course Name' },
        { key: 'originalName', label: 'File' },
      ];

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>{isPaper ? 'Manage Question Paper' : 'Manage Examination Guideline'}</h1>
          <p>
            {isPaper
              ? 'Previous question paper for each course and speciality. Examiners of that board download it from their portal.'
              : 'Guideline, question-paper format and remuneration are uploaded per course; Air, Rail, Road and Boarding & Lodging documents once for all courses.'}
          </p>
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      {notice ? <div className="practical-notice">{notice}</div> : null}
      {meta && canEdit ? (
        <form className="card" onSubmit={upload}>
          <div className="grid cols-2">
            {isPaper ? (
              <Field label="Exam Session">
                <select className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                  {meta.sessions.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.month} {s.year}
                      {s.current ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Upload Type" required>
                <select className="input" value={uploadType} onChange={(e) => setUploadType(e.target.value)}>
                  <option value="">Select Upload Type</option>
                  {PRACTICAL_DOC_TYPES.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label}
                      {t.perCourse ? '' : ' (all courses)'}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {isPaper || typeDef?.perCourse ? (
              <Field label="Course" required>
                <select
                  className="input"
                  value={courseId}
                  onChange={(e) => {
                    setCourseId(e.target.value);
                    setSpecialityId('');
                  }}
                >
                  <option value="">-- Select Course --</option>
                  {meta.courses.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {isPaper ? (
              <Field label="Speciality" required>
                <select className="input" value={specialityId} onChange={(e) => setSpecialityId(e.target.value)}>
                  <option value="">-- Select Speciality --</option>
                  {specs.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="File (PDF, max 20 MB)" required>
              <input key={fileKey} className="input" type="file" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </Field>
          </div>
          <div className="practical-actions-right">
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'Uploading…' : isPaper ? 'Upload Paper' : 'Upload'}
            </button>
          </div>
        </form>
      ) : null}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="practical-toolbar">
          <h3 className="practical-total">
            {isPaper ? 'Total Paper' : 'Total Examination Guideline'} <span className="practical-count">{shown.length}</span>
          </h3>
        </div>
        <div className="file-number-toolbar">
          <ExportButtons columns={[{ key: 'sr', label: 'SNo.' }, ...cols]} rows={shown.map((r, i) => ({ sr: i + 1, ...r }))} filename={mode} />
          <label className="field table-filter" style={{ margin: 0 }}>
            <span>Search</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        {shown.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>SNo.</th>
                  {cols.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r._id}>
                    <td>{i + 1}</td>
                    {cols.map((c) => (
                      <td key={c.key}>{(r as any)[c.key]}</td>
                    ))}
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          className="btn small secondary"
                          onClick={() => openAuthedFile(`/practical/documents/${r._id}/file`).catch((e) => setError(e.message))}
                        >
                          Click Here
                        </button>
                        {canEdit ? (
                          <button type="button" className="btn small danger" onClick={() => setDeleting(r)}>
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">Nothing uploaded yet.</p>
        )}
      </div>
      {deleting ? (
        <ConfirmDialog
          title="Delete document"
          message={`Delete ${deleting.typeLabel} — ${deleting.originalName}?`}
          yesLabel="Delete"
          noLabel="Cancel"
          onYes={confirmDelete}
          onNo={() => setDeleting(null)}
        />
      ) : null}
    </Shell>
  );
}

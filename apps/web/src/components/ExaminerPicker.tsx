import { useMemo, useState } from 'react';
import { Field } from './ui';
import { isValidEmail, isValidMobile, cleanMobile, normalizeIndianMobile } from '@ethesis/shared';

export type ExaminerDraft = {
  name: string;
  email: string;
  bucketCode: string;
  affiliation: string;
  mobile?: string;
  designation?: string;
  department?: string;
  address?: string;
  city?: string;
  country?: string;
};

export function validateExaminerDraft(draft: ExaminerDraft): string | null {
  if (!draft.name || !draft.name.trim()) return 'Examiner name is required';
  if (!draft.email || !draft.email.trim()) return 'Examiner email is required';
  if (!isValidEmail(draft.email)) return 'Examiner email is invalid (e.g. examiner@domain.edu)';
  if (draft.mobile && draft.mobile.trim() !== '') {
    const digits = cleanMobile(draft.mobile);
    if (!isValidMobile(digits)) {
      return 'Examiner mobile must be a valid 10-digit Indian mobile number';
    }
  }
  if (!draft.bucketCode) return 'Please select a bucket for this examiner';
  return null;
}

export const emptyExaminerDraft = (): ExaminerDraft => ({
  name: '',
  email: '',
  bucketCode: '',
  affiliation: '',
  mobile: '',
  designation: '',
  department: '',
  address: '',
  city: '',
  country: '',
});

type KnownExaminer = ExaminerDraft & { onThisPanel?: boolean };

function matches(p: KnownExaminer, q: string) {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return (
    (p.name || '').toLowerCase().includes(n) ||
    (p.email || '').toLowerCase().includes(n) ||
    (p.affiliation || '').toLowerCase().includes(n) ||
    (p.designation || '').toLowerCase().includes(n) ||
    (p.department || '').toLowerCase().includes(n) ||
    (p.mobile || '').includes(n)
  );
}

export function ExaminerPicker({
  examiners,
  member,
  buckets,
  onChange,
  errors,
  hideExisting,
}: {
  examiners: KnownExaminer[];
  member: ExaminerDraft;
  buckets: { code: string; label: string; count?: number }[];
  onChange: (next: ExaminerDraft) => void;
  /** Optional messages shown under a field (keys: name, email, mobile, bucketCode). */
  errors?: Record<string, string | undefined>;
  /** Hide the "Existing examiner" picker (used when editing someone already on the panel). */
  hideExisting?: boolean;
}) {
  const [suggest, setSuggest] = useState<'name' | 'email' | null>(null);
  const picked = examiners.find((p) => p.email && p.email === String(member.email || '').trim().toLowerCase());

  const nameHits = useMemo(
    () => examiners.filter((p) => matches(p, member.name)).slice(0, 12),
    [examiners, member.name],
  );
  const emailHits = useMemo(
    () => examiners.filter((p) => matches(p, member.email)).slice(0, 12),
    [examiners, member.email],
  );

  function pick(p: KnownExaminer) {
    if (p.onThisPanel) return;
    onChange({
      ...member,
      name: p.name || '',
      email: p.email || '',
      affiliation: p.affiliation || '',
      mobile: p.mobile || '',
      designation: p.designation || '',
      department: p.department || '',
      address: p.address || '',
      city: p.city || '',
      country: p.country || '',
    });
    setSuggest(null);
  }

  function bindEmail(raw: string) {
    const email = raw.trim().toLowerCase();
    const found = examiners.find((p) => p.email === email);
    if (found && !found.onThisPanel) pick(found);
  }

  return (
    <>
      {!hideExisting && (
      <>
      <Field label="Existing examiner">
        <select
          className="input"
          value={picked && !picked.onThisPanel ? picked.email : ''}
          onChange={(e) => {
            const found = examiners.find((p) => p.email === e.target.value);
            if (found) pick(found);
            else {
              onChange({ ...emptyExaminerDraft(), bucketCode: member.bucketCode });
              setSuggest(null);
            }
          }}
        >
          <option value="">New examiner — type details below</option>
          {examiners.map((p) => (
            <option key={p.email} value={p.email} disabled={p.onThisPanel}>
              {p.name} ({p.email})
              {p.onThisPanel ? ' — already on this panel' : ''}
            </option>
          ))}
        </select>
      </Field>
      <p className="guide-hint" style={{ marginTop: 6 }}>
        {examiners.length
          ? 'Pick an examiner already used on another thesis, or type a new person. The same examiner cannot be added twice on this candidate.'
          : 'No saved examiners yet. After you add someone, they can be picked again for other candidates.'}
      </p>
      {picked && !picked.onThisPanel ? (
        <p className="guide-hint" style={{ marginTop: 4 }}>
          Details filled from previous use. Choose the bucket for this thesis, then add.
        </p>
      ) : null}
      </>
      )}
      <div className="grid cols-2" style={{ marginTop: 10 }}>
        <Field label="Examiner Name" required error={errors?.name}>
          <div className="examiner-suggest">
            <input
              className="input"
              value={member.name}
              placeholder="e.g. Dr. A. K. Sharma"
              autoComplete="off"
              onFocus={() => setSuggest('name')}
              onChange={(e) => {
                onChange({ ...member, name: e.target.value });
                setSuggest('name');
              }}
              onBlur={() => setTimeout(() => setSuggest((s) => (s === 'name' ? null : s)), 180)}
            />
            {suggest === 'name' && member.name.trim() && nameHits.length > 0 && (
              <div className="examiner-suggest-list" role="listbox">
                {nameHits.map((p) => (
                  <button
                    key={p.email}
                    type="button"
                    disabled={p.onThisPanel}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(p)}
                  >
                    <b>{p.name}</b>
                    {(p.designation || p.department) && (
                      <span style={{ color: 'var(--ink, #1f2d41)' }}>{[p.designation, p.department].filter(Boolean).join(', ')}</span>
                    )}
                    <span>
                      {p.email}
                      {p.onThisPanel ? ' — already on this panel' : p.affiliation ? ` · ${p.affiliation}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>
        <Field label="Email Id" required error={errors?.email}>
          <div className="examiner-suggest">
            <input
              className="input"
              type="email"
              value={member.email}
              placeholder="e.g. examiner@aiims.edu"
              autoComplete="off"
              onFocus={() => setSuggest('email')}
              onChange={(e) => {
                onChange({ ...member, email: e.target.value });
                setSuggest('email');
              }}
              onBlur={(e) => {
                bindEmail(e.target.value);
                setTimeout(() => setSuggest((s) => (s === 'email' ? null : s)), 180);
              }}
            />
            {member.email.trim() && !isValidEmail(member.email) && (
              <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                Please enter a valid email address
              </span>
            )}
            {suggest === 'email' && member.email.trim() && emailHits.length > 0 && (
              <div className="examiner-suggest-list" role="listbox">
                {emailHits.map((p) => (
                  <button
                    key={p.email}
                    type="button"
                    disabled={p.onThisPanel}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(p)}
                  >
                    <b>{p.name}</b>
                    {(p.designation || p.department) && (
                      <span style={{ color: 'var(--ink, #1f2d41)' }}>{[p.designation, p.department].filter(Boolean).join(', ')}</span>
                    )}
                    <span>
                      {p.email}
                      {p.onThisPanel ? ' — already on this panel' : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>
        <Field label="Mobile No." error={errors?.mobile}>
          <input
            className="input"
            type="tel"
            placeholder="10-digit mobile (e.g. 9876543210)"
            maxLength={16}
            value={member.mobile || ''}
            onChange={(e) => {
              // A pasted "+91 98765 43210" becomes "9876543210" instead of being cut to the first 10 digits.
              const clean = normalizeIndianMobile(e.target.value.replace(/\D/g, '').slice(0, 12));
              onChange({ ...member, mobile: clean });
            }}
          />
          {member.mobile && member.mobile.length > 0 && !isValidMobile(member.mobile) && (
            <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
              Must be 10 digits starting with 6, 7, 8, or 9
            </span>
          )}
        </Field>
        <Field label="Designation">
          <input
            className="input"
            placeholder="e.g. Professor & HOD"
            value={member.designation || ''}
            onChange={(e) => onChange({ ...member, designation: e.target.value })}
          />
        </Field>
        <Field label="Department">
          <input
            className="input"
            placeholder="e.g. Department of Anatomy"
            value={member.department || ''}
            onChange={(e) => onChange({ ...member, department: e.target.value })}
          />
        </Field>
        <Field label="Examiner Institute">
          <input
            className="input"
            placeholder="e.g. AIIMS New Delhi / PGI Chandigarh"
            value={member.affiliation || ''}
            onChange={(e) => onChange({ ...member, affiliation: e.target.value })}
          />
        </Field>
        <Field label="Bucket" required error={errors?.bucketCode}>
          <select
            className="input"
            value={member.bucketCode}
            onChange={(e) => onChange({ ...member, bucketCode: e.target.value })}
          >
            <option value="">Select bucket</option>
            {buckets.map((b) => (
              <option key={b.code} value={b.code}>
                {b.label}
                {b.count ? ` (${b.count})` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Address">
          <input
            className="input"
            placeholder="e.g. Dept of Anatomy, Medical College Campus"
            value={member.address || ''}
            onChange={(e) => onChange({ ...member, address: e.target.value })}
          />
        </Field>
      </div>
    </>
  );
}


import { Fragment } from 'react';
import { EVALUATION_REPORT_ITEMS } from '@ethesis/shared';

export type EvaluationValue = {
  verdict: string;
  grade: string;
  comments: string;
  report: Record<string, string>;
};

export function emptyEvaluation(): EvaluationValue {
  return { verdict: 'ACCEPT', grade: 'COMMENDABLE', comments: '', report: {} };
}

export function toEvaluationValue(raw?: {
  verdict?: string;
  grade?: string;
  comments?: string;
  report?: Record<string, string>;
}): EvaluationValue {
  return {
    verdict: String(raw?.verdict || ''),
    grade: String(raw?.grade || ''),
    comments: String(raw?.comments || ''),
    report: raw?.report && typeof raw.report === 'object' ? { ...raw.report } : {},
  };
}

export function evaluationVerdictLabel(verdict?: string) {
  if (verdict === 'ACCEPT') return 'Accepted';
  if (verdict === 'REJECT') return 'Rejected';
  if (verdict === 'REVISION') return 'Revision / modification';
  return verdict || '—';
}

export function thesisByVersion(docs: any[] | undefined, version?: number) {
  const theses = (docs || []).filter((d: any) => !d.kind || d.kind === 'THESIS');
  if (version != null) {
    const match = theses.find((d: any) => Number(d.version || 0) === Number(version));
    if (match) return match;
  }
  if (!theses.length) return null;
  return theses.reduce((a: any, b: any) => (Number(a.version || 0) >= Number(b.version || 0) ? a : b));
}

export function evaluationError(value: EvaluationValue, allowReject = true): string | null {
  const allowed = allowReject ? ['ACCEPT', 'REVISION', 'REJECT'] : ['ACCEPT', 'REVISION'];
  if (!allowed.includes(value.verdict)) {
    return allowReject
      ? 'Select a recommendation: Accepted, Revision / modification, or Rejected'
      : 'Select a recommendation: Accepted or Revision / modification';
  }
  if (value.verdict === 'ACCEPT' && !value.grade) {
    return 'Accepted reports need a grade: Highly Commendable, Commendable or Satisfactory';
  }
  if (value.verdict === 'REJECT' && !String(value.comments || '').trim()) {
    return 'Give reasons for rejection in comments';
  }
  for (const item of EVALUATION_REPORT_ITEMS) {
    if (!['YES', 'NO', 'CANT_SAY'].includes(value.report[item.key])) {
      return `General Report: answer "${item.label}" (Yes / No / Can't Say)`;
    }
  }
  return null;
}

export function EvaluationForm({
  meta,
  value,
  onChange,
  onSubmit,
  disabled,
  readOnly,
  submitLabel = 'Submit Evaluation Report',
  allowReject = true,
}: {
  meta: {
    candidateName?: string;
    title?: string;
    fileNo?: string;
    thesisNumber?: string;
    courseName?: string;
    courseTypeName?: string;
    specialityName?: string;
  };
  value: EvaluationValue;
  onChange?: (next: EvaluationValue) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  readOnly?: boolean;
  submitLabel?: string;
  allowReject?: boolean;
}) {
  const locked = Boolean(disabled || readOnly);
  function setReport(key: string, answer: string) {
    onChange?.({ ...value, report: { ...value.report, [key]: answer } });
  }

  const grouped: { group?: string; items: (typeof EVALUATION_REPORT_ITEMS)[number][] }[] = [];
  for (const item of EVALUATION_REPORT_ITEMS) {
    const group = 'group' in item ? item.group : undefined;
    if (group) {
      grouped.push({ group, items: [item] });
    } else if (grouped.length && grouped[grouped.length - 1].group && !item.no) {
      grouped[grouped.length - 1].items.push(item);
    } else {
      grouped.push({ items: [item] });
    }
  }

  return (
    <div className="eval-form">
      <div className="eval-head">
        <div className="eval-confidential">CONFIDENTIAL</div>
        <h2>Examination Section</h2>
        <p className="eval-sub">
          Evaluation Report on thesis
          {meta.courseTypeName ? ` (${meta.courseTypeName})` : ''}
          {meta.courseName ? ` for ${meta.courseName}` : ''}
          {meta.specialityName ? ` in ${meta.specialityName}` : ''}
        </p>
        {meta.fileNo ? <div className="eval-fileno">{meta.fileNo}</div> : null}
      </div>
      <table className="eval-meta">
        <tbody>
          <tr>
            <th>Name of the student</th>
            <td>{meta.candidateName || '—'}</td>
          </tr>
          <tr>
            <th>Title of thesis</th>
            <td>{meta.title || '—'}</td>
          </tr>
          {meta.thesisNumber ? (
            <tr>
              <th>Thesis no.</th>
              <td>{meta.thesisNumber}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <h3>Recommendation</h3>
      <label className="eval-rec">
        <input
          type="radio"
          name="recommendation"
          checked={value.verdict === 'ACCEPT'}
          disabled={locked}
          onChange={() => onChange?.({ ...value, verdict: 'ACCEPT' })}
        />
        <span>1. ACCEPTED</span>
      </label>
      {value.verdict === 'ACCEPT' && (
        <div className="eval-grades">
          {[
            ['HIGHLY_COMMENDABLE', 'A. Highly Commendable'],
            ['COMMENDABLE', 'B. Commendable'],
            ['SATISFACTORY', 'C. Satisfactory'],
          ].map(([code, label]) => (
            <label key={code} className="eval-grade">
              <input
                type="radio"
                name="grade"
                checked={value.grade === code}
                disabled={locked}
                onChange={() => onChange?.({ ...value, grade: code })}
              />
              {label}
            </label>
          ))}
        </div>
      )}
      <label className="eval-rec">
        <input
          type="radio"
          name="recommendation"
          checked={value.verdict === 'REVISION'}
          disabled={locked}
          onChange={() => onChange?.({ ...value, verdict: 'REVISION' })}
        />
        <span>2. REVISION / MODIFICATION REQUIRED</span>
      </label>
      {allowReject || value.verdict === 'REJECT' ? (
        <label className="eval-rec">
          <input
            type="radio"
            name="recommendation"
            checked={value.verdict === 'REJECT'}
            disabled={locked}
            onChange={() => onChange?.({ ...value, verdict: 'REJECT' })}
          />
          <span>3. REJECTED (please give reasons in comments)</span>
        </label>
      ) : null}

      <h3>General Report</h3>
      <div className="table-wrap">
        <table className="table eval-report">
          <thead>
            <tr>
              <th></th>
              <th></th>
              <th>Yes</th>
              <th>No</th>
              <th>Can&apos;t Say</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((block, bi) => (
              <Fragment key={`b-${bi}`}>
                {block.group ? (
                  <tr>
                    <td>2.</td>
                    <td colSpan={4}>{block.group}</td>
                  </tr>
                ) : null}
                {block.items.map((item) => (
                  <tr key={item.key}>
                    <td>{item.no}</td>
                    <td>{item.label}</td>
                    {['YES', 'NO', 'CANT_SAY'].map((ans) => (
                      <td key={ans}>
                        <input
                          type="radio"
                          name={item.key}
                          checked={value.report[item.key] === ans}
                          disabled={locked}
                          onChange={() => setReport(item.key, ans)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <label className="field" style={{ marginTop: 14 }}>
        <span>Comments{value.verdict === 'REJECT' ? ' (required for rejection)' : ''}</span>
        <textarea
          className="input"
          rows={4}
          value={value.comments}
          disabled={locked}
          onChange={(e) => onChange?.({ ...value, comments: e.target.value })}
        />
      </label>

      {readOnly ? null : (
        <button className="btn" type="button" style={{ marginTop: 16 }} disabled={locked} onClick={() => onSubmit?.()}>
          {submitLabel}
        </button>
      )}
    </div>
  );
}

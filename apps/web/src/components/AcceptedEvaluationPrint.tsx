import { LETTERHEAD_LOGO_SRC } from '@ethesis/shared';
import { EvaluationForm, toEvaluationValue } from './EvaluationForm';

export type AcceptedPrintMode = 'report' | 'report-examiner' | 'cheque';

export type AcceptedPrintDoc = {
  id: string;
  meta: {
    candidateName?: string;
    title?: string;
    fileNo?: string;
    thesisNumber?: string;
    courseName?: string;
    courseTypeName?: string;
    specialityName?: string;
  };
  examiner: {
    examinerId?: string;
    name?: string;
    designation?: string;
    department?: string;
    institute?: string;
    address?: string;
  };
  evaluation?: any;
  chequePath?: string;
};

export type AcceptedPrintData = { instituteName?: string; logoUrl?: string; docs: AcceptedPrintDoc[] };

const TITLES: Record<AcceptedPrintMode, string> = {
  report: 'Thesis evaluation report',
  'report-examiner': 'Thesis evaluation report with examiner details',
  cheque: 'Cancelled cheque',
};

function isPdf(path: string) {
  return /\.pdf$/i.test(path);
}

/** Print view for the old PrintMultiplePdfEvaluation / …WithExaminer / …ExaminerCC pages: one sheet per examiner. */
export function AcceptedEvaluationPrint({
  mode,
  data,
  onClose,
}: {
  mode: AcceptedPrintMode;
  data: AcceptedPrintData;
  onClose: () => void;
}) {
  const showExaminer = mode !== 'report';
  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-card modal-card-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="accepted-print-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head no-print">
          <h2 id="accepted-print-title">
            {TITLES[mode]} ({data.docs.length})
          </h2>
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
          Use Print and choose Save as PDF to download.
        </p>
        <div className="letter-print-area">
          {data.docs.map((doc, i) => (
            <article key={doc.id} className="letter-print-sheet">
              <header className="letter-print-head">
                <img src={data.logoUrl || LETTERHEAD_LOGO_SRC} alt="" className="letter-print-logo" />
                <div style={{ flex: 1 }}>
                  <p className="letter-print-confidential" style={{ margin: 0 }}>
                    CONFIDENTIAL
                  </p>
                  <p className="letter-print-org">{data.instituteName || 'Examination Section'}</p>
                  <p>Examination Section</p>
                </div>
                <b style={{ fontSize: 22, border: '2px solid #000', padding: '4px 10px', alignSelf: 'flex-start' }}>
                  {mode === 'cheque' ? i + 1 : doc.meta.thesisNumber || '—'}
                </b>
              </header>
              {showExaminer ? (
                <table className="table" style={{ margin: '12px 0' }}>
                  <tbody>
                    <ExaminerRow label="Examiner Id" value={doc.examiner.examinerId} />
                    <ExaminerRow label="Name" value={doc.examiner.name} />
                    <ExaminerRow label="Designation" value={doc.examiner.designation} />
                    <ExaminerRow label="Department" value={doc.examiner.department} />
                    <ExaminerRow label="Institute" value={doc.examiner.institute} />
                    <ExaminerRow label="Address" value={doc.examiner.address} />
                  </tbody>
                </table>
              ) : null}
              {mode === 'cheque' ? (
                !doc.chequePath ? (
                  <p className="guide-muted">Cancelled cheque not uploaded.</p>
                ) : isPdf(doc.chequePath) ? (
                  <iframe
                    title={`Cancelled cheque ${doc.examiner.name || ''}`}
                    src={`/api/uploads/${doc.chequePath}`}
                    style={{ width: '100%', height: 900, border: 0 }}
                  />
                ) : (
                  <img src={`/api/uploads/${doc.chequePath}`} alt="Cancelled cheque" style={{ width: '100%' }} />
                )
              ) : (
                <EvaluationForm meta={doc.meta} value={toEvaluationValue(doc.evaluation || undefined)} readOnly />
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExaminerRow({ label, value }: { label: string; value?: string }) {
  return (
    <tr>
      <td style={{ width: 160 }}>{label}</td>
      <td style={{ width: 12 }}>:</td>
      <td>{value || '—'}</td>
    </tr>
  );
}

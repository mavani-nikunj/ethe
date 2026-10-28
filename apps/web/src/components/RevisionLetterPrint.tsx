import { LETTERHEAD_LOGO_SRC } from '@ethesis/shared';
import { MailBodyView } from './ui';

export type RevisionLetterDoc = {
  kind?: string;
  subject?: string;
  body?: string;
  bodyHtml?: string;
  instituteName?: string;
  logoUrl?: string;
  fileNo?: string;
  thesisNumber?: string;
  candidateName?: string;
  examinerName?: string;
  printedAt?: string;
};

export function RevisionLetterPrint({
  letters,
  onClose,
}: {
  letters: RevisionLetterDoc[];
  onClose: () => void;
}) {
  if (!letters.length) return null;
  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-card modal-card-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="revision-letter-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head no-print">
          <h2 id="revision-letter-title">Approved revision letter</h2>
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
          Use Print and choose Save as PDF if you need a file. This does not send mail.
        </p>
        <div className="letter-print-area">
          {letters.map((letter, i) => (
            <article key={`${letter.fileNo || ''}-${letter.examinerName || ''}-${i}`} className="letter-print-sheet">
              <header className="letter-print-head">
                <img src={letter.logoUrl || LETTERHEAD_LOGO_SRC} alt="" className="letter-print-logo" />
                <div>
                  <p className="letter-print-org">{letter.instituteName || 'Examination Section'}</p>
                  <p>Examination Section</p>
                </div>
              </header>
              <div className="letter-print-meta">
                <span>File no.: {letter.fileNo || '—'}</span>
                <span>Thesis no.: {letter.thesisNumber || '—'}</span>
                <span>
                  Date:{' '}
                  {letter.printedAt
                    ? new Date(letter.printedAt).toLocaleDateString('en-IN')
                    : new Date().toLocaleDateString('en-IN')}
                </span>
              </div>
              <p className="letter-print-confidential">CONFIDENTIAL</p>
              {letter.subject ? <h3 className="letter-print-subject">{letter.subject}</h3> : null}
              <MailBodyView body={letter.bodyHtml || letter.body} />
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

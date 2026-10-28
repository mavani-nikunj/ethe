import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { get } from '../api';
import { BrandBar } from '../components/BrandBar';
import { PRODUCT_NAME } from '@ethesis/shared';

function consentDecided(status?: string) {
  return status === 'ACCEPTED' || status === 'REGRETTED';
}

export function TaskSubmittedPage() {
  const { token } = useParams();
  const [peek, setPeek] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get(`/tasks/${token}`)
      .then(setPeek)
      .catch((e) => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <div className="submit-shell">
        <div className="submit-box">
          <span className="submit-msg">{error}</span>
        </div>
      </div>
    );
  }

  if (!peek) {
    return (
      <div className="submit-shell">
        <div className="submit-box">
          <span className="submit-msg">Loading…</span>
        </div>
      </div>
    );
  }

  const consentDone = peek.purpose === 'CONSENT' && consentDecided(peek.consentStatus);
  const evalDone = peek.purpose === 'EVALUATE' && peek.evaluationSubmitted;
  const panelDone = peek.purpose === 'PANEL_BUILD' && peek.panelSubmitted;
  if (!consentDone && !evalDone && !panelDone) {
    return <Navigate to={`/task/${token}`} replace />;
  }

  const accepted = peek.consentStatus === 'ACCEPTED';
  const headline = panelDone ? 'Examiner panel submitted successfully' : 'Submitted Successfully';
  const sub = panelDone
    ? 'The Examination Section has received the panel of examiners.'
    : evalDone
      ? 'Your evaluation report has been submitted.'
      : accepted
        ? 'You have successfully accepted the examinership and your details have been submitted.'
        : 'Your response has been submitted successfully.';

  return (
    <div className="submit-shell">
      <BrandBar
        logoUrl={peek.institute?.logoUrl}
        title={peek.institute?.name || PRODUCT_NAME}
        right={
          <div>
            <div>{peek.name}</div>
            <div>{peek.email}</div>
          </div>
        }
      />
      <div className="submit-head">
        <div className="submit-kicker">{PRODUCT_NAME}</div>
        <h2>Examination Section</h2>
      </div>
      <div className="submit-box">
        <span className="submit-msg">{headline}</span>
        <p className="submit-sub">{sub}</p>
        {peek.candidate?.name ? (
          <p className="submit-meta">
            {peek.candidate.name}
            {peek.title ? ` · ${peek.title}` : ''}
            {peek.fileNo ? ` · File ${peek.fileNo}` : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}

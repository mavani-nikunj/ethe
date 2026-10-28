import { useEffect, useState } from 'react';
import { get, getToken, post } from '../../../api';
import { ErrorBox, Field } from '../../../components/ui';
import { PracticalRow } from './common';

/** Air booking form fields (labels match the API's AIR_FIELDS). */
export const AIR_FIELD_LABELS: [string, string][] = [
  ['passengerName', 'Passenger name (as on ID)'],
  ['gender', 'Gender'],
  ['age', 'Age'],
  ['fromPlace', 'From'],
  ['toPlace', 'To'],
  ['onwardDate', 'Onward date'],
  ['onwardFlight', 'Onward flight no. / preferred time'],
  ['returnDate', 'Return date'],
  ['returnFlight', 'Return flight no. / preferred time'],
  ['payLevel', 'Pay level'],
  ['gradePay', 'Grade pay'],
  ['hotelNeeded', 'Hotel / guest house needed'],
  ['hotelArrival', 'Hotel arrival (date & time)'],
  ['hotelDeparture', 'Hotel departure (date & time)'],
  ['notes', 'Notes'],
];

/** Open an API file that needs the login token (PDF / image) in a new tab. */
export async function openAuthedFile(path: string) {
  const win = window.open('', '_blank');
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken() || ''}` } });
  if (!res.ok) {
    win?.close();
    throw new Error('Could not open the file');
  }
  const url = URL.createObjectURL(await res.blob());
  if (win) win.location.href = url;
  else window.location.href = url;
}

export function BookingTable({ booking }: { booking: Record<string, any> }) {
  return (
    <table className="table practical-booking">
      <tbody>
        {AIR_FIELD_LABELS.filter(([k]) => booking[k] !== undefined && booking[k] !== '').map(([k, label]) => (
          <tr key={k}>
            <th>{label}</th>
            <td>{typeof booking[k] === 'boolean' ? (booking[k] ? 'Yes' : 'No') : String(booking[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BookingDialog({ row, onClose }: { row: PracticalRow; onClose: () => void }) {
  return (
    <div className="modal-overlay dialog-overlay" role="presentation" onClick={onClose}>
      <div className="modal-card dialog-card practical-letter-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>Air booking — {row.name}</h2>
        <p className="practical-muted">
          {row.typeLabel} · {row.courseName} / {row.specialityName} · {row.mobile} · {row.email}
        </p>
        <BookingTable booking={row.airBooking || {}} />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => window.print()}>
            Print
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Send Email": choose which mail to send (built-in or institute template). */
export function TemplatePickDialog({
  title,
  count,
  onYes,
  onNo,
}: {
  title: string;
  count: number;
  onYes: (purpose: string) => void;
  onNo: () => void;
}) {
  const [list, setList] = useState<{ purpose: string; name: string }[]>([]);
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    get<{ purpose: string; name: string }[]>('/practical/mail-templates').then(setList).catch((e) => setError(e.message));
  }, []);
  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card dialog-card" role="dialog" aria-modal="true">
        <h2>{title}</h2>
        <p>
          Send a mail to {count} selected examiner{count === 1 ? '' : 's'}. Each mail carries the examiner's own portal link.
        </p>
        <ErrorBox error={error} />
        <Field label="Select Mail Title" required>
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">-- Select Mail Title --</option>
            {list.map((t) => (
              <option key={t.purpose} value={t.purpose}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={!pick} onClick={() => onYes(pick)}>
            Send Email
          </button>
          <button type="button" className="btn secondary" onClick={onNo}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** The Associate Dean's scanned signature, printed on offer / appointment letters after approval. */
export function DeanSignatureCard() {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<{ url: string | null }>('/practical/signature')
      .then((r) => setUrl(r.url))
      .catch(() => undefined);
  }, []);
  async function upload(file?: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await post<{ url: string }>('/practical/signature', fd);
      setUrl(`${r.url}?t=${Date.now()}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card practical-signature">
      <div>
        <b>Your signature on letters</b>
        <p className="practical-muted">Printed on offer and appointment letters of examiners you approve. PNG or JPG, white background.</p>
        <ErrorBox error={error} />
      </div>
      {url ? <img src={url} alt="Signature" /> : <span className="practical-muted">No signature uploaded</span>}
      <label className="btn small secondary">
        {busy ? 'Uploading…' : url ? 'Replace' : 'Upload'}
        <input type="file" accept=".png,.jpg,.jpeg" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </label>
    </div>
  );
}

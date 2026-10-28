import { useEffect, useState } from 'react';
import { get } from './api';

export const SESSION_CHANGED = 'ethesis:session-changed';

export type SessionRow = { _id: string; month: string; year: number; current?: boolean };

export function notifySessionChanged() {
  window.dispatchEvent(new Event(SESSION_CHANGED));
}

export function applySessionParams(params: URLSearchParams, month: string, year: string) {
  if (!month && !year) {
    params.set('session', 'all');
    return params;
  }
  if (month) params.set('month', month);
  if (year) params.set('year', year);
  return params;
}

export function sessionQueryString(month: string, year: string) {
  return applySessionParams(new URLSearchParams(), month, year).toString();
}

export function sessionBody(month: string, year: string) {
  if (!month && !year) return { session: 'all' as const };
  return {
    ...(month ? { month } : {}),
    ...(year ? { year } : {}),
  };
}

export function useSessionFilter() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      get('/masters/sessions').catch(() => []),
      get('/masters/sessions/current').catch(() => null),
    ]).then(([rows, current]) => {
      if (cancelled) return;
      setSessions(Array.isArray(rows) ? rows : []);
      if (current?.month && current?.year) {
        setMonth(current.month);
        setYear(String(current.year));
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function withSession(params = new URLSearchParams()) {
    applySessionParams(params, month, year);
    return params;
  }

  return { sessions, month, year, setMonth, setYear, ready, withSession };
}

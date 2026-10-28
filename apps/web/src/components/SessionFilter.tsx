import { monthsFromSessions, yearsFromSessions } from '../dept';

export function SessionFilter({
  sessions,
  month,
  year,
  onChange,
}: {
  sessions: { month?: string; year?: number | string }[];
  month: string;
  year: string;
  onChange: (month: string, year: string) => void;
}) {
  return (
    <div className="session-filter">
      <select
        className="input"
        value={month}
        aria-label="Session month"
        onChange={(e) => onChange(e.target.value, year)}
      >
        <option value="">All months</option>
        {monthsFromSessions(sessions, month).map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select
        className="input"
        value={year}
        aria-label="Session year"
        onChange={(e) => {
          const nextYear = e.target.value;
          onChange(nextYear ? month : '', nextYear);
        }}
      >
        <option value="">All years</option>
        {yearsFromSessions(sessions, year).map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}

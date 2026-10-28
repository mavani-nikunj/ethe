import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export type MetroStageCount = {
  stageCode: string;
  stageName: string;
  count: number;
};

export type MetroCourseGroup = {
  courseTypeId: string;
  courseTypeName: string;
  blueprintName?: string;
  total: number;
  stages: MetroStageCount[];
};

function filesHref(courseTypeId?: string, stageCode?: string, month?: string, year?: string) {
  const params = new URLSearchParams();
  if (stageCode) params.set('stage', stageCode);
  if (courseTypeId) params.set('courseTypeId', courseTypeId);
  if (month) params.set('month', month);
  if (year) params.set('year', year);
  return `/app/files?${params.toString()}`;
}

function CourseMetro({ group, month, year }: { group: MetroCourseGroup; month?: string; year?: string }) {
  const navigate = useNavigate();
  const metroRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = metroRef.current;
    if (!el) return;

    function measure() {
      const node = metroRef.current;
      if (!node) return;
      const stops = Array.from(node.querySelectorAll<HTMLElement>('.metro-stop'));
      if (!stops.length) {
        setOverflows(false);
        return;
      }
      const firstTop = stops[0].offsetTop;
      const firstRow = stops.filter((s) => s.offsetTop === firstTop);
      const rowBottom = Math.max(...firstRow.map((s) => s.offsetTop + s.offsetHeight));
      node.style.setProperty('--metro-one-row', `${rowBottom}px`);
      setOverflows(stops.some((s) => s.offsetTop > firstTop));
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [group.stages, expanded]);

  return (
    <div className="wf-group">
      <div className="wf-group-head">
        <h4>
          <Link className="metro-group-link" to={filesHref(group.courseTypeId, undefined, month, year)}>
            {group.courseTypeName}
          </Link>
        </h4>
        <span>
          {group.blueprintName ? `${group.blueprintName} · ` : ''}
          {group.total} {group.total === 1 ? 'candidate' : 'candidates'}
        </span>
      </div>
      <div ref={metroRef} className={`metro dashboard-metro${expanded ? '' : ' collapsed'}`}>
        {group.stages.map((s) => {
          const count = s.count || 0;
          const status = count > 0 ? 'CURRENT' : '';
          return (
            <button
              type="button"
              className={`metro-stop clickable ${status}`}
              key={s.stageCode}
              onClick={() => navigate(filesHref(group.courseTypeId, s.stageCode, month, year))}
            >
              <div className={`dot ${status}`} />
              <small>
                {s.stageName}
                <span className="metro-counts">
                  <span className="metro-count">{count}</span>
                </span>
              </small>
            </button>
          );
        })}
      </div>
      {(overflows || expanded) && (
        <div className="metro-view-row">
          <button type="button" className="btn secondary small" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Hide' : 'View'}
          </button>
        </div>
      )}
    </div>
  );
}

export function DashboardMetro({ groups, month, year }: { groups: MetroCourseGroup[]; month?: string; year?: string }) {
  if (!groups?.length) return null;
  return (
    <div>
      {groups.map((g) => (
        <CourseMetro key={g.courseTypeId || g.courseTypeName} group={g} month={month} year={year} />
      ))}
    </div>
  );
}

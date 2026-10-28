import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

function isActiveStatus(status: string) {
  return status === 'CURRENT' || status === 'HOLD' || status === 'REJECTED';
}

export function Metro({
  items,
  hrefForStage,
}: {
  items: { stageCode: string; stageName: string; status: string }[];
  hrefForStage?: (stageCode: string) => string;
}) {
  const metroRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const list = items || [];

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
      setOverflows(stops.some((s) => s.offsetTop > firstTop));

      const current = stops.find((s) => isActiveStatus(s.dataset.status || '')) || stops[0];
      const rowTop = expanded ? firstTop : current.offsetTop;
      const rowStops = stops.filter((s) => s.offsetTop === rowTop);
      const rowBottom = Math.max(...rowStops.map((s) => s.offsetTop + s.offsetHeight));
      node.style.setProperty('--metro-one-row', `${firstTop + (rowBottom - rowTop)}px`);
      node.scrollTop = expanded ? 0 : Math.max(0, rowTop - firstTop);
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [list, expanded]);

  if (!list.length) return null;

  return (
    <div>
      <div ref={metroRef} className={`metro dashboard-metro${expanded ? '' : ' collapsed'}`}>
        {list.map((s) => {
          const href = hrefForStage?.(s.stageCode);
          const className = `metro-stop ${s.status}${href ? ' clickable' : ''}`;
          const inner = (
            <>
              <div className={`dot ${s.status}`} />
              <small>
                {s.stageName}
                {isActiveStatus(s.status) ? (
                  <>
                    <br />
                    {s.status === 'CURRENT' ? 'Current' : s.status}
                  </>
                ) : null}
              </small>
            </>
          );
          if (href) {
            return (
              <Link
                className={className}
                data-status={s.status}
                key={s.stageCode}
                to={href}
                title="View all candidates at this step"
              >
                {inner}
              </Link>
            );
          }
          return (
            <div className={className} data-status={s.status} key={s.stageCode}>
              {inner}
            </div>
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

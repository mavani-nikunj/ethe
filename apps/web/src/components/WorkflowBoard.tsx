import { Link } from 'react-router-dom';

export type WorkflowBoardStage = {
  stageCode: string;
  stageName: string;
  count: number;
};

export type WorkflowBoardGroup = {
  courseTypeId: string;
  courseTypeName: string;
  blueprintName?: string;
  total: number;
  stages: WorkflowBoardStage[];
};

function stageLink(group: WorkflowBoardGroup, stageCode: string) {
  const params = new URLSearchParams();
  params.set('stage', stageCode);
  if (group.courseTypeId) params.set('courseTypeId', group.courseTypeId);
  return `/app/files?${params.toString()}`;
}

export function WorkflowBoard({ groups }: { groups: WorkflowBoardGroup[] }) {
  if (!groups?.length) return null;

  return (
    <div>
      {groups.map((g) => (
        <div className="wf-group" key={g.courseTypeId || g.courseTypeName}>
          <div className="wf-group-head">
            <h4>{g.courseTypeName}</h4>
            <span>
              {g.blueprintName ? `${g.blueprintName} · ` : ''}
              {g.total} {g.total === 1 ? 'candidate' : 'candidates'}
            </span>
          </div>
          <div className="grid cols-4">
            {g.stages.map((s) => (
              <Link
                className={`card wf-card${s.count ? '' : ' empty'}`}
                key={s.stageCode}
                to={stageLink(g, s.stageCode)}
              >
                <b>{s.count}</b>
                <span>{s.stageName}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

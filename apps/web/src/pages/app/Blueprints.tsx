import { useEffect, useState } from 'react';
import { get, post, patch, del } from '../../api';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field } from '../../components/ui';
import { DEFAULT_AUTHORITY_SLOTS, LetterKind, StageType, UserRole } from '@ethesis/shared';

const STAGE_TYPES = Object.values(StageType);
const ACTORS = ['COURSE', 'DEALING', 'AUTHORITY', 'GUIDE', 'EXAMINER'];
const LETTERS = ['', ...Object.values(LetterKind)];
const SLOTS = ['', ...DEFAULT_AUTHORITY_SLOTS.map((s) => s.code)];

const emptyStage = () => ({
  code: '',
  name: '',
  type: StageType.APPROVE,
  actorRole: UserRole.DEALING,
  authoritySlot: '',
  next: '',
  nextOnReject: '',
  letterKind: '',
});

export function BlueprintsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [courseTypes, setCourseTypes] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [courseTypeId, setCourseTypeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(keepId?: string) {
    const list = await get('/blueprints');
    setRows(list);
    setCourseTypes(await get('/masters/course-types'));
    const id = keepId || selected?._id || list[0]?._id;
    if (id) setSelected(await get(`/blueprints/${id}`));
    else setSelected(null);
  }
  useEffect(() => {
    load();
  }, []);

  function setField(k: string, v: any) {
    setSelected((s: any) => ({ ...s, [k]: v }));
  }

  function setStage(i: number, k: string, v: any) {
    setSelected((s: any) => {
      const stages = [...(s.stages || [])];
      stages[i] = { ...stages[i], [k]: v };
      return { ...s, stages };
    });
  }

  async function save() {
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      const body = {
        name: selected.name,
        code: selected.code,
        description: selected.description,
        stages: selected.stages,
        guidePolicy: selected.guidePolicy,
        panelRule: selected.panelRule,
        revisionOwnerRole: selected.revisionOwnerRole,
        flags: selected.flags,
      };
      const saved = selected._id
        ? await patch(`/blueprints/${selected._id}`, body)
        : await post('/blueprints', body);
      await load(saved._id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Workflow blueprints</h1>
          <p>
            Each course type follows the blueprint you bind to it. Courses under that type inherit the flow. Seed PG /
            PhD as a start, or clone and change the hops for any other programme. Saving a live blueprint changes files
            already on that line.
          </p>
        </div>
        <div className="row">
          <button
            className="btn secondary"
            onClick={async () => {
              setError(null);
              try {
                await post('/blueprints/seed', {});
                await load();
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            Seed PG + PhD templates
          </button>
          <button
            className="btn"
            onClick={async () => {
              setError(null);
              try {
                const created = await post('/blueprints', {
                  name: 'New programme',
                  code: `CUSTOM_${Date.now().toString(36).toUpperCase()}`,
                });
                await load(created._id);
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            New blueprint
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="grid cols-2">
        <div className="card">
          {rows.map((r) => (
            <button
              key={r._id}
              className={`btn ${selected?._id === r._id ? '' : 'secondary'}`}
              style={{ display: 'block', width: '100%', marginBottom: 8, textAlign: 'left' }}
              onClick={async () => setSelected(await get(`/blueprints/${r._id}`))}
            >
              {r.name}
              <div style={{ fontWeight: 400, fontSize: 12 }}>
                {r.code}
                {(r.boundCourseTypes || []).length ? ` · ${r.boundCourseTypes.join(', ')}` : ''}
              </div>
            </button>
          ))}
        </div>
        <div className="card">
          {selected ? (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <button className="btn small" onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : 'Save flow'}
                </button>
                {selected._id && (
                  <>
                    <button
                      className="btn secondary small"
                      onClick={async () => {
                        const copy = await post(`/blueprints/${selected._id}/clone`, {});
                        await load(copy._id);
                      }}
                    >
                      Clone
                    </button>
                    <button
                      className="btn ghost small"
                      onClick={async () => {
                        if (!confirm(`Delete ${selected.name}?`)) return;
                        try {
                          await del(`/blueprints/${selected._id}`);
                          setSelected(null);
                          await load();
                        } catch (e: any) {
                          setError(e.message);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
              <div className="grid cols-2">
                <Field label="Name" required>
                  <input className="input" value={selected.name || ''} onChange={(e) => setField('name', e.target.value)} />
                </Field>
                <Field label="Code">
                  <input className="input" value={selected.code || ''} onChange={(e) => setField('code', e.target.value)} />
                </Field>
              </div>
              <Field label="Description">
                <textarea rows={2} value={selected.description || ''} onChange={(e) => setField('description', e.target.value)} />
              </Field>
              <div className="grid cols-2">
                <Field label="Min co-guides">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={selected.guidePolicy?.minCoGuides ?? 0}
                    onChange={(e) =>
                      setField('guidePolicy', { ...selected.guidePolicy, minCoGuides: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field label="Max co-guides">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={selected.guidePolicy?.maxCoGuides ?? 0}
                    onChange={(e) => setField('guidePolicy', { ...selected.guidePolicy, maxCoGuides: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Revision owner">
                  <select
                    value={selected.revisionOwnerRole || 'DEALING'}
                    onChange={(e) => setField('revisionOwnerRole', e.target.value)}
                  >
                    <option value="DEALING">Dealing</option>
                    <option value="GUIDE">Chief Guide</option>
                  </select>
                </Field>
                <Field label="Hold / release result">
                  <select
                    value={selected.flags?.resultHoldRelease ? 'yes' : 'no'}
                    onChange={(e) =>
                      setField('flags', { ...selected.flags, resultHoldRelease: e.target.value === 'yes' })
                    }
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </Field>
                <Field label="Remuneration">
                  <select
                    value={selected.flags?.remuneration ? 'yes' : 'no'}
                    onChange={(e) => setField('flags', { ...selected.flags, remuneration: e.target.value === 'yes' })}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </Field>
              </div>
              {(selected.boundCourseTypes || rows.find((r) => r._id === selected._id)?.boundCourseTypes || []).length > 0 && (
                <p style={{ color: 'var(--gold, #8a6d1b)', fontSize: 13, marginTop: 8 }}>
                  Bound to {(selected.boundCourseTypes || rows.find((r) => r._id === selected._id)?.boundCourseTypes).join(', ')}.
                  Saving changes this flow for files already on that line. Clone first if you want a safe draft.
                </p>
              )}
              <div className="row" style={{ flexWrap: 'wrap', gap: 6, margin: '12px 0' }}>
                {(selected.stages || []).map((s: any, i: number) => (
                  <span key={`${s.code}-${i}`} className="pill" style={{ fontSize: 12 }}>
                    {s.name || s.code || 'untitled'}
                    {s.next ? ' →' : ''}
                  </span>
                ))}
              </div>
              <h3 style={{ margin: '14px 0 8px' }}>Examiner buckets</h3>
              {(selected.panelRule?.buckets || []).map((b: any, i: number) => (
                <div className="row" key={i} style={{ marginBottom: 6 }}>
                  <input
                    className="input"
                    placeholder="Code"
                    value={b.code}
                    onChange={(e) => {
                      const buckets = [...(selected.panelRule?.buckets || [])];
                      buckets[i] = { ...b, code: e.target.value };
                      setField('panelRule', { buckets });
                    }}
                    style={{ maxWidth: 120 }}
                  />
                  <input
                    className="input"
                    placeholder="Label"
                    value={b.label}
                    onChange={(e) => {
                      const buckets = [...(selected.panelRule?.buckets || [])];
                      buckets[i] = { ...b, label: e.target.value };
                      setField('panelRule', { buckets });
                    }}
                  />
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={b.count}
                    onChange={(e) => {
                      const buckets = [...(selected.panelRule?.buckets || [])];
                      buckets[i] = { ...b, count: Number(e.target.value) };
                      setField('panelRule', { buckets });
                    }}
                    style={{ maxWidth: 80 }}
                  />
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => {
                      const buckets = (selected.panelRule?.buckets || []).filter((_: any, j: number) => j !== i);
                      setField('panelRule', { buckets });
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="btn secondary small"
                type="button"
                onClick={() =>
                  setField('panelRule', {
                    buckets: [...(selected.panelRule?.buckets || []), { code: '', label: '', count: 1 }],
                  })
                }
              >
                Add bucket
              </button>
              <h3 style={{ margin: '18px 0 8px' }}>File flow</h3>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>
                Next is the hop after approve / continue. Next on reject is the return hop (leave empty to close as rejected).
              </p>
              {(selected.stages || []).map((s: any, i: number) => (
                <div key={i} className="card" style={{ marginBottom: 10, padding: 12 }}>
                  <div className="row" style={{ marginBottom: 8, justifyContent: 'space-between' }}>
                    <b>
                      {i + 1}. {s.name || s.code || 'New stage'}
                    </b>
                    <div className="row">
                      <button
                        className="btn ghost small"
                        type="button"
                        disabled={i === 0}
                        onClick={() => {
                          const stages = [...selected.stages];
                          [stages[i - 1], stages[i]] = [stages[i], stages[i - 1]];
                          setField('stages', stages);
                        }}
                      >
                        Up
                      </button>
                      <button
                        className="btn ghost small"
                        type="button"
                        disabled={i === selected.stages.length - 1}
                        onClick={() => {
                          const stages = [...selected.stages];
                          [stages[i + 1], stages[i]] = [stages[i], stages[i + 1]];
                          setField('stages', stages);
                        }}
                      >
                        Down
                      </button>
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => setField('stages', selected.stages.filter((_: any, j: number) => j !== i))}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="grid cols-2">
                    <Field label="Code" required>
                      <input className="input" value={s.code} onChange={(e) => setStage(i, 'code', e.target.value)} />
                    </Field>
                    <Field label="Name" required>
                      <input className="input" value={s.name} onChange={(e) => setStage(i, 'name', e.target.value)} />
                    </Field>
                    <Field label="Type">
                      <select value={s.type} onChange={(e) => setStage(i, 'type', e.target.value)}>
                        {STAGE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t.replaceAll('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Who acts">
                      <select value={s.actorRole} onChange={(e) => setStage(i, 'actorRole', e.target.value)}>
                        {ACTORS.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Authority slot">
                      <select value={s.authoritySlot || ''} onChange={(e) => setStage(i, 'authoritySlot', e.target.value)}>
                        {SLOTS.map((slot) => (
                          <option key={slot || 'none'} value={slot}>
                            {slot || '—'}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Letter">
                      <select value={s.letterKind || ''} onChange={(e) => setStage(i, 'letterKind', e.target.value)}>
                        {LETTERS.map((k) => (
                          <option key={k || 'none'} value={k}>
                            {k || '—'}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Next">
                      <select value={s.next || ''} onChange={(e) => setStage(i, 'next', e.target.value)}>
                        <option value="">End / close</option>
                        {(selected.stages || [])
                          .filter((o: any) => o.code && o.code !== s.code)
                          .map((o: any) => (
                            <option key={o.code} value={o.code}>
                              {o.name || o.code}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Next on reject">
                      <select value={s.nextOnReject || ''} onChange={(e) => setStage(i, 'nextOnReject', e.target.value)}>
                        <option value="">Reject file</option>
                        {(selected.stages || [])
                          .filter((o: any) => o.code && o.code !== s.code)
                          .map((o: any) => (
                            <option key={o.code} value={o.code}>
                              {o.name || o.code}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Next on hold">
                      <select value={s.nextOnHold || ''} onChange={(e) => setStage(i, 'nextOnHold', e.target.value)}>
                        <option value="">Stay on hold</option>
                        {(selected.stages || [])
                          .filter((o: any) => o.code && o.code !== s.code)
                          .map((o: any) => (
                            <option key={o.code} value={o.code}>
                              {o.name || o.code}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="4th examiner bucket">
                      <select value={s.nthBucketCode || ''} onChange={(e) => setStage(i, 'nthBucketCode', e.target.value)}>
                        <option value="">—</option>
                        {(selected.panelRule?.buckets || []).map((b: any) => (
                          <option key={b.code} value={b.code}>
                            {b.label || b.code}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Evaluation round">
                      <input
                        className="input"
                        type="number"
                        min={0}
                        value={s.evaluationRound || ''}
                        onChange={(e) => setStage(i, 'evaluationRound', e.target.value ? Number(e.target.value) : '')}
                      />
                    </Field>
                    <Field label="Wait (accepted count)">
                      <input
                        className="input"
                        type="number"
                        min={0}
                        value={s.waitAccepted || ''}
                        onChange={(e) => setStage(i, 'waitAccepted', e.target.value ? Number(e.target.value) : '')}
                      />
                    </Field>
                  </div>
                </div>
              ))}
              <button
                className="btn secondary small"
                type="button"
                onClick={() => setField('stages', [...(selected.stages || []), emptyStage()])}
              >
                Add stage
              </button>
              <Field label="Bind this flow to a course type">
                <div className="row">
                  <select value={courseTypeId} onChange={(e) => setCourseTypeId(e.target.value)}>
                    <option value="">Select course type</option>
                    {courseTypes.map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.name}
                        {t.blueprintId ? (String(t.blueprintId) === String(selected._id) ? ' (this flow)' : ' (other flow)') : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn small"
                    disabled={!selected._id || !courseTypeId}
                    onClick={async () => {
                      setError(null);
                      try {
                        await post(`/blueprints/${selected._id}/bind-course-type/${courseTypeId}`, {});
                        await load(selected._id);
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  >
                    Bind
                  </button>
                  <button
                    className="btn secondary small"
                    disabled={!courseTypeId}
                    onClick={async () => {
                      setError(null);
                      try {
                        await post(`/blueprints/unbind-course-type/${courseTypeId}`, {});
                        await load(selected._id);
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  >
                    Unbind
                  </button>
                </div>
              </Field>
            </>
          ) : (
            <p>No blueprints yet. Seed the PG / PhD templates or create a new flow.</p>
          )}
        </div>
      </div>
    </Shell>
  );
}

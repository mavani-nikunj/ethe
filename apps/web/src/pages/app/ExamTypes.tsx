import { FormEvent, useEffect, useMemo, useState } from 'react';
import { get, post, patch, del } from '../../api';
import { Shell } from '../../components/Shell';
import { ConfirmDialog, ErrorBox } from '../../components/ui';
import { copyRows, downloadCsv, printRows } from '../../dept';

interface ExamTypeRow {
  _id: string;
  name: string;
}

const STORAGE_KEY = 'ethesis_exam_types_cache';

const DEFAULT_EXAM_TYPES: ExamTypeRow[] = [
  { _id: 'ext_1', name: 'Supplementary' },
  { _id: 'ext_2', name: 'Compartmental' },
  { _id: 'ext_3', name: 'Regular' },
  { _id: 'ext_4', name: 'Regular/Supplementary' },
];

export function ExamTypesPage() {
  const [rows, setRows] = useState<ExamTypeRow[]>(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return DEFAULT_EXAM_TYPES;
  });

  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<'none' | 'name'>('none');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ExamTypeRow | null>(null);
  const [examTypeName, setExamTypeName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [itemToDelete, setItemToDelete] = useState<ExamTypeRow | null>(null);

  const syncCache = (nextRows: ExamTypeRow[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRows));
    } catch {
      // ignore
    }
  };

  async function loadData() {
    try {
      const data = await get<ExamTypeRow[]>('/masters/exam-types');
      if (Array.isArray(data) && data.length > 0) {
        setRows(data);
        syncCache(data);
        return;
      }
    } catch {
      // API may fail if endpoint not live yet, fallback smoothly to local
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredRows = useMemo(() => {
    let list = [...rows];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q));
    }
    if (sortCol === 'name') {
      list.sort((a, b) => {
        const res = a.name.localeCompare(b.name);
        return sortAsc ? res : -res;
      });
    }
    return list;
  }, [rows, search, sortCol, sortAsc]);

  const totalFiltered = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const pageRows = filteredRows.slice(startIdx, startIdx + pageSize);

  function openAddModal() {
    setEditingItem(null);
    setExamTypeName('');
    setFormError(null);
    setModalOpen(true);
  }

  function openEditModal(row: ExamTypeRow) {
    setEditingItem(row);
    setExamTypeName(row.name);
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingItem(null);
    setExamTypeName('');
    setFormError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = examTypeName.trim();
    if (!trimmed) {
      setFormError('Exam Type is required');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      if (editingItem) {
        let updatedRow: ExamTypeRow = { ...editingItem, name: trimmed };
        try {
          const apiRes = await patch<ExamTypeRow>(`/masters/exam-types/${editingItem._id}`, { name: trimmed });
          if (apiRes && apiRes._id) updatedRow = apiRes;
        } catch {
          // fallback to client update
        }
        const next = rows.map((r) => (r._id === editingItem._id ? updatedRow : r));
        setRows(next);
        syncCache(next);
      } else {
        let newRow: ExamTypeRow = { _id: `ext_${Date.now()}`, name: trimmed };
        try {
          const apiRes = await post<ExamTypeRow>('/masters/exam-types', { name: trimmed });
          if (apiRes && apiRes._id) newRow = apiRes;
        } catch {
          // fallback to client add
        }
        const next = [...rows, newRow];
        setRows(next);
        syncCache(next);
      }
      closeModal();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save Exam Type');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    if (!itemToDelete) return;
    try {
      await del(`/masters/exam-types/${itemToDelete._id}`);
    } catch {
      // ignore API failure and delete locally
    }
    const next = rows.filter((r) => r._id !== itemToDelete._id);
    setRows(next);
    syncCache(next);
    setItemToDelete(null);
  }

  const exportCols = [
    { key: 'sno', label: 'S.No.' },
    { key: 'name', label: 'Exam Type' },
  ];

  const exportRows = filteredRows.map((r, i) => ({
    sno: i + 1,
    name: r.name,
  }));

  return (
    <Shell mode="app">
      <div className="exam-type-hero">
        <div className="exam-type-hero-icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        </div>
        <h1>Add/Edit Exam Type</h1>
      </div>

      <div className="exam-type-card">
        <div className="exam-type-header">
          <div className="exam-type-stat">
            <span>Total Speciality</span>
            <span className="exam-type-badge">{rows.length}</span>
          </div>
          <button type="button" className="btn-add-exam" onClick={openAddModal}>
            Add Exam Type
          </button>
        </div>

        <div className="exam-type-toolbar">
          <div className="exam-export-btns no-print">
            <button
              type="button"
              className="btn-export-teal"
              onClick={() => copyRows(exportCols, exportRows)}
            >
              Copy
            </button>
            <button
              type="button"
              className="btn-export-teal"
              onClick={() => downloadCsv('exam-types.csv', exportCols, exportRows)}
            >
              Excel
            </button>
            <button
              type="button"
              className="btn-export-teal"
              onClick={() => printRows('Exam Types', exportCols, exportRows)}
            >
              PDF
            </button>
          </div>

          <div className="exam-search-box no-print">
            <label htmlFor="exam-search-input">Search:</label>
            <input
              id="exam-search-input"
              type="text"
              className="exam-search-input"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        <div className="exam-table-container">
          <table className="exam-table">
            <thead>
              <tr>
                <th
                  style={{ width: '80px' }}
                  onClick={() => {
                    if (sortCol === 'none') {
                      setSortCol('name');
                      setSortAsc(false);
                    } else {
                      setSortCol('none');
                    }
                  }}
                >
                  S.No. <span style={{ opacity: 0.6, fontSize: '11px' }}>⇅</span>
                </th>
                <th
                  onClick={() => {
                    if (sortCol !== 'name') {
                      setSortCol('name');
                      setSortAsc(true);
                    } else {
                      setSortAsc(!sortAsc);
                    }
                  }}
                >
                  Exam Type <span style={{ opacity: 0.6, fontSize: '11px' }}>⇅</span>
                </th>
                <th style={{ width: '160px', textAlign: 'left' }}>
                  Action <span style={{ opacity: 0.6, fontSize: '11px' }}>⇅</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
                    No exam types found.
                  </td>
                </tr>
              ) : (
                pageRows.map((row, idx) => {
                  const sNo = startIdx + idx + 1;
                  return (
                    <tr key={row._id}>
                      <td style={{ color: '#475569' }}>{sNo}</td>
                      <td style={{ fontWeight: 500 }}>{row.name}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-edit-exam"
                          onClick={() => openEditModal(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-delete-exam"
                          onClick={() => setItemToDelete(row)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="exam-table-footer">
          <div>
            {totalFiltered === 0
              ? 'Showing 0 to 0 of 0 entries'
              : `Showing ${startIdx + 1} to ${Math.min(startIdx + pageSize, totalFiltered)} of ${totalFiltered} entries`}
          </div>

          <div className="exam-pagination no-print">
            <button
              type="button"
              className="btn-page"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                className={`btn-page${p === currentPage ? ' active' : ''}`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ))}

            <button
              type="button"
              className="btn-page"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="modal-overlay exam-modal-overlay" onClick={closeModal}>
          <div className="exam-modal-card" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="exam-modal-close"
              aria-label="Close"
              onClick={closeModal}
            >
              ×
            </button>

            <div className="exam-modal-side">
              <div className="exam-modal-icon" aria-hidden>
                <svg viewBox="0 0 64 64" width="50" height="50">
                  <rect x="16" y="10" width="32" height="42" rx="4" fill="none" stroke="#2e1065" strokeWidth="3" />
                  <path d="M24 10h16v8H24z" fill="none" stroke="#2e1065" strokeWidth="3" />
                  <circle cx="44" cy="42" r="10" fill="#6d28d9" stroke="#2e1065" strokeWidth="2" />
                  <path d="M39 42l3 3 7-7" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p>Please fill all fields to add detail</p>
              <span className="exam-modal-next">›</span>
            </div>

            <form className="exam-modal-form" onSubmit={handleSubmit}>
              <h2>{editingItem ? 'Edit Exam Type' : 'Add Exam Type'}</h2>
              <p className="exam-modal-subtitle">All fields are mandatory</p>

              <ErrorBox error={formError} />

              <div style={{ marginTop: '10px', marginBottom: '24px' }}>
                <label
                  htmlFor="exam-type-name"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: '8px',
                  }}
                >
                  Exam Type <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  id="exam-type-name"
                  type="text"
                  className="input"
                  placeholder="Enter Exam Type"
                  value={examTypeName}
                  onChange={(e) => setExamTypeName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto' }}>
                <button
                  type="submit"
                  className="btn-exam-submit"
                  disabled={submitting}
                >
                  {submitting ? 'Submitting…' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {itemToDelete && (
        <ConfirmDialog
          title="Delete Exam Type"
          message={`Are you sure you want to delete exam type "${itemToDelete.name}"?`}
          yesLabel="Delete"
          noLabel="Cancel"
          onYes={confirmDelete}
          onNo={() => setItemToDelete(null)}
        />
      )}
    </Shell>
  );
}

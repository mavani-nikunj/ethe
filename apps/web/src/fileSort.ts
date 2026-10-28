/** Ascending by course type, course, department, then candidate name — the standard order for thesis grids. */
export function compareByCourseThenCandidate(a: any, b: any) {
  const keys = [
    (r: any) => r.courseTypeName,
    (r: any) => r.courseName,
    (r: any) => r.departmentName,
    (r: any) => r.candidate?.name ?? r.candidateName,
  ];
  for (const key of keys) {
    const diff = String(key(a) || '').localeCompare(String(key(b) || ''), undefined, { sensitivity: 'base' });
    if (diff) return diff;
  }
  return 0;
}

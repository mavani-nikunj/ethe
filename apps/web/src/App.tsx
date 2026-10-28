import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { canonicalUserRole } from '@ethesis/shared';
import { useAuth } from './auth';

const LoginPage = lazy(() => import('./pages/Login').then((m) => ({ default: m.LoginPage })));
const SetPasswordPage = lazy(() => import('./pages/SetPassword').then((m) => ({ default: m.SetPasswordPage })));
const TaskPage = lazy(() => import('./pages/Task').then((m) => ({ default: m.TaskPage })));
const PracticalTaskPage = lazy(() => import('./pages/PracticalTask').then((m) => ({ default: m.PracticalTaskPage })));
const TaskSubmittedPage = lazy(() => import('./pages/TaskSubmitted').then((m) => ({ default: m.TaskSubmittedPage })));
const PlatformHome = lazy(() => import('./pages/platform/Home').then((m) => ({ default: m.PlatformHome })));
const InstitutesPage = lazy(() => import('./pages/platform/Institutes').then((m) => ({ default: m.InstitutesPage })));
const InstituteWizard = lazy(() => import('./pages/platform/Wizard').then((m) => ({ default: m.InstituteWizard })));
const InstituteDetail = lazy(() => import('./pages/platform/Detail').then((m) => ({ default: m.InstituteDetail })));
const AuditPage = lazy(() => import('./pages/platform/Audit').then((m) => ({ default: m.AuditPage })));
const LogsPage = lazy(() => import('./pages/platform/Logs').then((m) => ({ default: m.LogsPage })));
const AppHome = lazy(() => import('./pages/app/Home').then((m) => ({ default: m.AppHome })));
const FilesMod = () => import('./pages/app/Files');
const InboxPage = lazy(() => FilesMod().then((m) => ({ default: m.InboxPage })));
const FilesPage = lazy(() => FilesMod().then((m) => ({ default: m.FilesPage })));
const NewThesisPage = lazy(() => import('./pages/app/NewThesis').then((m) => ({ default: m.NewThesisPage })));
const File360Page = lazy(() => import('./pages/app/File360').then((m) => ({ default: m.File360Page })));
const ApprovedLettersPage = lazy(() => import('./pages/app/ApprovedLetters').then((m) => ({ default: m.ApprovedLettersPage })));
const AcceptedEvaluationsPage = lazy(() => import('./pages/app/AcceptedEvaluations').then((m) => ({ default: m.AcceptedEvaluationsPage })));
const ExaminerConsentsPage = lazy(() => import('./pages/app/ExaminerConsents').then((m) => ({ default: m.ExaminerConsentsPage })));
const MastersMod = () => import('./pages/app/Masters');
const MastersPage = lazy(() => MastersMod().then((m) => ({ default: m.MastersPage })));
const BlueprintsPage = lazy(() => import('./pages/app/Blueprints').then((m) => ({ default: m.BlueprintsPage })));
const CommsPage = lazy(() => import('./pages/app/Comms').then((m) => ({ default: m.CommsPage })));
const FileNumbersPage = lazy(() => import('./pages/app/FileNumbers').then((m) => ({ default: m.FileNumbersPage })));
const ExamTypesPage = lazy(() => import('./pages/app/ExamTypes').then((m) => ({ default: m.ExamTypesPage })));
const ReportsPage = lazy(() => import('./pages/app/Reports').then((m) => ({ default: m.ReportsPage })));
const DepartmentWorkMod = () => import('./pages/app/DepartmentWork');
const DeptEditListPage = lazy(() => DepartmentWorkMod().then((m) => ({ default: m.DeptEditListPage })));
const DeptAddedPage = lazy(() => DepartmentWorkMod().then((m) => ({ default: m.DeptAddedPage })));
const DeptSubmittedPage = lazy(() => DepartmentWorkMod().then((m) => ({ default: m.DeptSubmittedPage })));
const DeptGuidesPage = lazy(() => DepartmentWorkMod().then((m) => ({ default: m.DeptGuidesPage })));
const DeptReportsPage = lazy(() => DepartmentWorkMod().then((m) => ({ default: m.DeptReportsPage })));
const PracticalQueuePage = lazy(() =>
  import('./pages/app/practical/PracticalQueue').then((m) => ({ default: m.PracticalQueuePage })),
);
const PracticalAppointPage = lazy(() =>
  import('./pages/app/practical/PracticalAppoint').then((m) => ({ default: m.PracticalAppointPage })),
);
const PracticalExaminersMod = () => import('./pages/app/practical/PracticalExaminers');
const PracticalExaminersPage = lazy(() => PracticalExaminersMod().then((m) => ({ default: m.PracticalExaminersPage })));
const PracticalDocsPage = lazy(() => import('./pages/app/practical/PracticalDocs').then((m) => ({ default: m.PracticalDocsPage })));
const PracticalLettersPage = lazy(() =>
  import('./pages/app/practical/PracticalLetters').then((m) => ({ default: m.PracticalLettersPage })),
);
const PracticalPortalPage = lazy(() => import('./pages/PracticalPortal').then((m) => ({ default: m.PracticalPortalPage })));
const TravelMod = () => import('./pages/app/travel/Travel');
const TravelRequestsPage = lazy(() => TravelMod().then((m) => ({ default: m.TravelRequestsPage })));
const TravelAgentsPage = lazy(() => TravelMod().then((m) => ({ default: m.TravelAgentsPage })));
const PRACTICAL_ROLES = ['DEALING', 'AUTHORITY', 'INSTITUTE_ADMIN'];
const EligibleListPage = lazy(() => import('./pages/app/eligible/EligibleList').then((m) => ({ default: m.EligibleListPage })));
const EligibleAddPage = lazy(() => import('./pages/app/eligible/EligibleAdd').then((m) => ({ default: m.EligibleAddPage })));
const EligibleHallsPage = lazy(() => import('./pages/app/eligible/HallMaster').then((m) => ({ default: m.HallMasterPage })));
const SeatAllotmentPage = lazy(() => import('./pages/app/eligible/SeatAllotment').then((m) => ({ default: m.SeatAllotmentPage })));
const SeatAllotmentReportsPage = lazy(() =>
  import('./pages/app/eligible/SeatAllotmentReports').then((m) => ({ default: m.SeatAllotmentReportsPage })),
);
const EligiblePreviousPage = lazy(() =>
  import('./pages/app/eligible/EligiblePrevious').then((m) => ({ default: m.EligiblePreviousPage })),
);
const SupervisorTaskPage = lazy(() => import('./pages/SupervisorTask').then((m) => ({ default: m.SupervisorTaskPage })));
const SupervisorSessionPage = lazy(() =>
  import('./pages/app/supervisor/SupervisorSession').then((m) => ({ default: m.SupervisorSessionPage })),
);
const SupervisorSchedulePage = lazy(() =>
  import('./pages/app/supervisor/SupervisorSchedule').then((m) => ({ default: m.SupervisorSchedulePage })),
);
const SupervisorPeoplePage = lazy(() => import('./pages/app/supervisor/SupervisorPeople').then((m) => ({ default: m.SupervisorPeoplePage })));
const SupervisorListPage = lazy(() => import('./pages/app/supervisor/SupervisorList').then((m) => ({ default: m.SupervisorListPage })));
const SupervisorDayWisePage = lazy(() =>
  import('./pages/app/supervisor/SupervisorDayWise').then((m) => ({ default: m.SupervisorDayWisePage })),
);
const StaffAddPage = lazy(() => import('./pages/app/staff-duty/StaffAdd').then((m) => ({ default: m.StaffAddPage })));
const DutyAssignedPage = lazy(() => import('./pages/app/staff-duty/DutyAssigned').then((m) => ({ default: m.DutyAssignedPage })));
const DutyAllotmentPage = lazy(() => import('./pages/app/staff-duty/DutyAllotment').then((m) => ({ default: m.DutyAllotmentPage })));
const SupervisorLettersPage = lazy(() =>
  import('./pages/app/supervisor/SupervisorLetters').then((m) => ({ default: m.SupervisorLettersPage })),
);
const DepartmentLoginsPage = lazy(() =>
  import('./pages/app/DepartmentLogins').then((m) => ({ default: m.DepartmentLoginsPage })),
);

function Gate({
  children,
  platform,
  roles,
}: {
  children: React.ReactNode;
  platform?: boolean;
  roles?: string[];
}) {
  const { user, loading } = useAuth();
  if (loading) return <div className="main">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/set-password" replace />;
  if (platform && user.role !== 'SUPER_ADMIN') return <Navigate to="/app" replace />;
  if (!platform && user.role === 'SUPER_ADMIN') return <Navigate to="/platform" replace />;
  // Travel Manager only works on the travel pages.
  if (user.role === 'TRAVEL' && !roles?.includes('TRAVEL')) return <Navigate to="/app/travel/requests" replace />;
  if (roles?.length && !roles.map((r) => canonicalUserRole(r)).includes(canonicalUserRole(user.role))) {
    return <Navigate to={user.role === 'INSTITUTE_ADMIN' ? '/app/masters' : '/app'} replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<div className="main">Loading…</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route path="/task/:token/submitted" element={<TaskSubmittedPage />} />
        <Route path="/task/:token" element={<TaskPage />} />
        <Route path="/practical-task/:token" element={<PracticalTaskPage />} />
        <Route path="/practical-portal/:token" element={<PracticalPortalPage />} />
        <Route path="/supervisor-task/:token" element={<SupervisorTaskPage />} />
        <Route
          path="/platform"
          element={
            <Gate platform>
              <PlatformHome />
            </Gate>
          }
        />
        <Route
          path="/platform/institutes"
          element={
            <Gate platform>
              <InstitutesPage />
            </Gate>
          }
        />
        <Route
          path="/platform/institutes/new"
          element={
            <Gate platform>
              <InstituteWizard />
            </Gate>
          }
        />
        <Route
          path="/platform/institutes/:id"
          element={
            <Gate platform>
              <InstituteDetail />
            </Gate>
          }
        />
        <Route
          path="/platform/audit"
          element={
            <Gate platform>
              <AuditPage />
            </Gate>
          }
        />
        <Route
          path="/platform/logs"
          element={
            <Gate platform>
              <LogsPage />
            </Gate>
          }
        />
        <Route
          path="/app"
          element={
            <Gate>
              <AppHome />
            </Gate>
          }
        />
        <Route
          path="/app/inbox"
          element={
            <Gate>
              <InboxPage />
            </Gate>
          }
        />
        <Route
          path="/app/files"
          element={
            <Gate>
              <FilesPage />
            </Gate>
          }
        />
        <Route
          path="/app/files/new"
          element={
            <Gate roles={['COURSE']}>
              <NewThesisPage />
            </Gate>
          }
        />
        <Route
          path="/app/files/:id/edit"
          element={
            <Gate roles={['COURSE']}>
              <NewThesisPage />
            </Gate>
          }
        />
        <Route
          path="/app/files/:id"
          element={
            <Gate>
              <File360Page />
            </Gate>
          }
        />
        <Route
          path="/app/examiner-consents"
          element={
            <Gate roles={['DEALING', 'INSTITUTE_ADMIN']}>
              <ExaminerConsentsPage />
            </Gate>
          }
        />
        <Route
          path="/app/evaluations/accepted"
          element={
            <Gate roles={['DEALING', 'INSTITUTE_ADMIN']}>
              <AcceptedEvaluationsPage />
            </Gate>
          }
        />
        <Route
          path="/app/letters/approved"
          element={
            <Gate roles={['DEALING', 'INSTITUTE_ADMIN']}>
              <ApprovedLettersPage />
            </Gate>
          }
        />
        <Route
          path="/app/masters"
          element={
            <Gate roles={['INSTITUTE_ADMIN']}>
              <MastersPage />
            </Gate>
          }
        />
        <Route
          path="/app/blueprints"
          element={
            <Gate roles={['INSTITUTE_ADMIN']}>
              <BlueprintsPage />
            </Gate>
          }
        />
        <Route
          path="/app/file-numbers"
          element={
            <Gate roles={['DEALING']}>
              <FileNumbersPage />
            </Gate>
          }
        />
        <Route
          path="/app/exam-types"
          element={
            <Gate roles={['DEALING', 'INSTITUTE_ADMIN']}>
              <ExamTypesPage />
            </Gate>
          }
        />
        <Route path="/app/comms" element={<Navigate to="/app/comms/email" replace />} />
        <Route
          path="/app/comms/:channel"
          element={
            <Gate roles={['DEALING']}>
              <CommsPage />
            </Gate>
          }
        />
        <Route
          path="/app/dept/edit"
          element={
            <Gate roles={['COURSE']}>
              <DeptEditListPage />
            </Gate>
          }
        />
        <Route
          path="/app/dept/added"
          element={
            <Gate roles={['COURSE']}>
              <DeptAddedPage />
            </Gate>
          }
        />
        <Route
          path="/app/dept/submitted"
          element={
            <Gate roles={['COURSE']}>
              <DeptSubmittedPage />
            </Gate>
          }
        />
        <Route
          path="/app/dept/guides"
          element={
            <Gate roles={['COURSE', 'DEALING', 'ACADEMIC', 'INSTITUTE_ADMIN', 'SUPER_ADMIN']}>
              <DeptGuidesPage />
            </Gate>
          }
        />
        <Route
          path="/app/guides"
          element={
            <Gate roles={['COURSE', 'DEALING', 'ACADEMIC', 'INSTITUTE_ADMIN', 'SUPER_ADMIN']}>
              <DeptGuidesPage />
            </Gate>
          }
        />
        <Route
          path="/app/dept/reports/:kind"
          element={
            <Gate roles={['COURSE']}>
              <DeptReportsPage />
            </Gate>
          }
        />
        <Route
          path="/app/department-logins"
          element={
            <Gate roles={['INSTITUTE_ADMIN']}>
              <DepartmentLoginsPage />
            </Gate>
          }
        />
        <Route
          path="/app/reports"
          element={
            <Gate>
              <ReportsPage />
            </Gate>
          }
        />
        <Route
          path="/app/results"
          element={
            <Gate>
              <ReportsPage initialTab="results" />
            </Gate>
          }
        />
        <Route path="/app/practical" element={<Navigate to="/app/practical/assigned" replace />} />
        <Route
          path="/app/practical/appoint"
          element={
            <Gate roles={PRACTICAL_ROLES}>
              <PracticalAppointPage />
            </Gate>
          }
        />
        <Route
          path="/app/practical/examiners"
          element={
            <Gate roles={PRACTICAL_ROLES}>
              <PracticalExaminersPage />
            </Gate>
          }
        />
        {(['question-papers', 'documents'] as const).map((p) => (
          <Route
            key={p}
            path={`/app/practical/${p}`}
            element={
              <Gate roles={PRACTICAL_ROLES}>
                <PracticalDocsPage mode={p} />
              </Gate>
            }
          />
        ))}
        <Route
          path="/app/practical/letters"
          element={
            <Gate roles={['DEALING']}>
              <PracticalLettersPage />
            </Gate>
          }
        />
        <Route path="/app/eligible" element={<Navigate to="/app/eligible/eligible" replace />} />
        <Route
          path="/app/eligible/add"
          element={
            <Gate roles={['DEALING']}>
              <EligibleAddPage />
            </Gate>
          }
        />
        <Route
          path="/app/eligible/previous"
          element={
            <Gate roles={['DEALING']}>
              <EligiblePreviousPage />
            </Gate>
          }
        />
        <Route
          path="/app/eligible/halls"
          element={
            <Gate roles={['DEALING']}>
              <EligibleHallsPage />
            </Gate>
          }
        />
        <Route
          path="/app/eligible/seat-allotment"
          element={
            <Gate roles={['DEALING']}>
              <SeatAllotmentPage />
            </Gate>
          }
        />
        <Route
          path="/app/eligible/seat-reports"
          element={
            <Gate roles={['DEALING']}>
              <SeatAllotmentReportsPage />
            </Gate>
          }
        />
        <Route
          path="/app/eligible/:view"
          element={
            <Gate roles={PRACTICAL_ROLES}>
              <EligibleListPage />
            </Gate>
          }
        />
        <Route path="/app/supervisor" element={<Navigate to="/app/supervisor/add" replace />} />
        <Route
          path="/app/supervisor/session"
          element={
            <Gate roles={PRACTICAL_ROLES}>
              <SupervisorSessionPage />
            </Gate>
          }
        />
        <Route
          path="/app/supervisor/schedule"
          element={
            <Gate roles={['DEALING']}>
              <SupervisorSchedulePage />
            </Gate>
          }
        />
        <Route
          path="/app/supervisor/people"
          element={
            <Gate roles={['DEALING']}>
              <SupervisorPeoplePage />
            </Gate>
          }
        />
        <Route
          path="/app/supervisor/day-wise"
          element={
            <Gate roles={PRACTICAL_ROLES}>
              <SupervisorDayWisePage />
            </Gate>
          }
        />
        <Route
          path="/app/supervisor/letters"
          element={
            <Gate roles={['DEALING']}>
              <SupervisorLettersPage />
            </Gate>
          }
        />
        <Route
          path="/app/supervisor/:view"
          element={
            <Gate roles={PRACTICAL_ROLES}>
              <SupervisorListPage />
            </Gate>
          }
        />
        <Route path="/app/staff-duty" element={<Navigate to="/app/staff-duty/allotment" replace />} />
        <Route
          path="/app/staff-duty/staff"
          element={
            <Gate roles={['DEALING']}>
              <StaffAddPage />
            </Gate>
          }
        />
        <Route
          path="/app/staff-duty/assigned"
          element={
            <Gate roles={PRACTICAL_ROLES}>
              <DutyAssignedPage />
            </Gate>
          }
        />
        <Route
          path="/app/staff-duty/allotment"
          element={
            <Gate roles={PRACTICAL_ROLES}>
              <DutyAllotmentPage />
            </Gate>
          }
        />
        <Route path="/app/travel" element={<Navigate to="/app/travel/requests" replace />} />
        <Route
          path="/app/travel/agents"
          element={
            <Gate roles={['TRAVEL']}>
              <TravelAgentsPage />
            </Gate>
          }
        />
        <Route
          path="/app/travel/:view"
          element={
            <Gate roles={['TRAVEL']}>
              <TravelRequestsPage />
            </Gate>
          }
        />
        <Route
          path="/app/practical/:view"
          element={
            <Gate roles={PRACTICAL_ROLES}>
              <PracticalQueuePage />
            </Gate>
          }
        />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}

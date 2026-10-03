import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { useSession } from "./lib/session";
import { Archive } from "./pages/Archive";
import { AuditLog } from "./pages/Audit";
import { CenterIdentity } from "./pages/CenterIdentity";
import { Circles } from "./pages/Circles";
import { Guardians } from "./pages/Guardians";
import { Courses } from "./pages/Courses";
import { CourseDetail } from "./pages/CourseDetail";
import { Daily } from "./pages/Daily";
import { Reports } from "./pages/Reports";
import { Sard } from "./pages/Sard";
import { Tests } from "./pages/Tests";
import { Announcements } from "./pages/Announcements";
import { Honor } from "./pages/Honor";
import { FollowUp } from "./pages/FollowUp";
import { Insights } from "./pages/Insights";
import { Notifications } from "./pages/Notifications";
import { PrayerAdmin } from "./pages/Prayer";
import { PrintStudent } from "./pages/Print";
import { StaffAttendance } from "./pages/StaffAttendance";
import { Dashboard } from "./pages/Dashboard";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { More } from "./pages/More";
import { SettingsPage } from "./pages/Settings";
import { StaffPage } from "./pages/Staff";
import { Students } from "./pages/Students";
import type { Role } from "@shared/constants";
import type { ReactElement } from "react";

function Splash() {
  return (
    <div className="splash">
      <img src="/brand/logo-512.webp" alt="" width={120} height={120} />
      <span className="splash-dots" aria-label="جارٍ التحميل"><i /><i /><i /></span>
    </div>
  );
}

/** يسمح بالصفحة لأدوار محددة فقط (وإلا يعود للرئيسية). الحماية الفعلية في الخادم. */
function Only({ roles, children }: { roles: Role[]; children: ReactElement }) {
  const { me } = useSession();
  return me && roles.includes(me.user.role) ? children : <Navigate to="/app" replace />;
}

export function App() {
  const { me, loading } = useSession();
  if (loading) return <Splash />;

  return (
    <Routes>
      <Route path="/" element={me ? <Navigate to="/app" replace /> : <Landing />} />
      <Route path="/login" element={me ? <Navigate to="/app" replace /> : <Login />} />
      <Route path="/app" element={me ? <Shell /> : <Navigate to="/login" replace />}>
        <Route index element={<Dashboard />} />
        <Route path="students" element={<Only roles={["admin", "secretary", "teacher", "stage_manager", "exam_committee"]}><Students /></Only>} />
        <Route path="follow-up" element={<Only roles={["admin", "secretary", "teacher", "stage_manager", "exam_committee"]}><FollowUp /></Only>} />
        <Route path="daily" element={<Only roles={["admin", "secretary", "teacher", "stage_manager"]}><Daily /></Only>} />
        <Route path="sard" element={<Only roles={["admin", "secretary", "teacher", "stage_manager", "exam_committee"]}><Sard /></Only>} />
        <Route path="tests" element={<Only roles={["admin", "secretary", "teacher", "stage_manager", "exam_committee"]}><Tests /></Only>} />
        <Route path="reports" element={<Only roles={["admin", "secretary", "teacher", "stage_manager", "exam_committee"]}><Reports /></Only>} />
        <Route path="courses" element={<Only roles={["admin", "secretary", "teacher", "stage_manager", "exam_committee"]}><Courses /></Only>} />
        <Route path="courses/:id" element={<Only roles={["admin", "secretary", "teacher", "stage_manager", "exam_committee"]}><CourseDetail /></Only>} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="announcements" element={<Only roles={["admin", "secretary", "teacher", "stage_manager", "exam_committee"]}><Announcements /></Only>} />
        <Route path="honor" element={<Honor />} />
        <Route path="insights" element={<Only roles={["admin", "secretary", "stage_manager", "exam_committee"]}><Insights /></Only>} />
        <Route path="staff-attendance" element={<Only roles={["admin", "secretary", "stage_manager"]}><StaffAttendance /></Only>} />
        <Route path="prayer" element={<Only roles={["admin"]}><PrayerAdmin /></Only>} />
        <Route path="print/:id" element={<Only roles={["admin", "secretary", "teacher", "stage_manager", "exam_committee"]}><PrintStudent /></Only>} />
        <Route path="archive" element={<Only roles={["admin", "secretary"]}><Archive /></Only>} />
        <Route path="circles" element={<Only roles={["admin", "secretary", "teacher", "stage_manager"]}><Circles /></Only>} />
        <Route path="staff" element={<Only roles={["admin", "secretary"]}><StaffPage /></Only>} />
        <Route path="guardians" element={<Only roles={["admin", "secretary", "teacher"]}><Guardians /></Only>} />
        <Route path="settings" element={<Only roles={["admin"]}><SettingsPage /></Only>} />
        <Route path="center" element={<Only roles={["admin"]}><CenterIdentity /></Only>} />
        <Route path="audit" element={<Only roles={["admin"]}><AuditLog /></Only>} />
        <Route path="more" element={<More />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

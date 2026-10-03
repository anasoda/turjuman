import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./env";
import { ajkamRoutes } from "./routes/ajkam";
import { authRoutes } from "./routes/auth";
import { circleRoutes } from "./routes/circles";
import { guardianRoutes } from "./routes/guardians";
import { auditRoutes, centerRoutes, ownerRoutes, publicRoutes, settingsRoutes } from "./routes/misc";
import { courseRoutes, testRoutes } from "./routes/exams";
import { dailyRoutes, sardRoutes } from "./routes/records";
import { portalRoutes, reportRoutes } from "./routes/reports";
import { exportRoutes, honorRoutes, noteRoutes, ownerPanelRoutes, prayerRoutes, publicPrayerRoutes, scheduleRoutes, staffAttendanceRoutes, statsRoutes } from "./routes/extras";
import { absenceRoutes, announcementRoutes, notificationRoutes } from "./routes/notices";
import { staffRoutes } from "./routes/staff";
import { studentRoutes } from "./routes/students";

const app = new Hono<AppEnv>();

// رؤوس الأمان لكل استجابات الـ API. رؤوس صفحات الواجهة في public/_headers.
app.use("/api/*", async (c, next) => {
  await next();
  c.header("cache-control", "no-store");
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "no-referrer");
});

app.route("/api/auth", authRoutes);
app.route("/api/staff", staffRoutes);
app.route("/api/students", studentRoutes);
app.route("/api/circles", circleRoutes);
app.route("/api/guardians", guardianRoutes);
app.route("/api/daily", dailyRoutes);
app.route("/api/sard", sardRoutes);
app.route("/api/tests", testRoutes);
app.route("/api/reports", reportRoutes);
app.route("/api/courses", ajkamRoutes);
app.route("/api/courses", courseRoutes);
app.route("/api/portal", portalRoutes);
app.route("/api/notifications", notificationRoutes);
app.route("/api/announcements", announcementRoutes);
app.route("/api/absences", absenceRoutes);
app.route("/api/prayer", prayerRoutes);
app.route("/api/schedule", scheduleRoutes);
app.route("/api/staff-attendance", staffAttendanceRoutes);
app.route("/api/notes", noteRoutes);
app.route("/api/honor", honorRoutes);
app.route("/api/stats", statsRoutes);
app.route("/api/export", exportRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/center", centerRoutes);
app.route("/api/audit", auditRoutes);
app.route("/api/public", publicRoutes);
app.route("/api/public", publicPrayerRoutes);
app.route("/api/owner", ownerRoutes);
app.route("/api/owner", ownerPanelRoutes);

app.get("/api/health", (c) => c.json({ ok: true, service: "turjuman-v2" }));

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
});
app.notFound((c) => c.json({ error: "غير موجود" }, 404));

export default app;

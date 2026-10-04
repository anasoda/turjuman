// تشغيل اختبارات التكامل على قاعدة محلية نظيفة من الصفر: يوقف بقايا wrangler، يمسح D1 المحلية، يهاجر، يشغّل الخادم، يبذر، يختبر، ثم يوقف الخادم.
// الاستخدام: npm run test:api:fresh   (اختبارات التكامل ليست قابلة للإعادة فوق قاعدة مستعملة، لذلك يلزم هذا المسح قبل كل تشغيل كامل.)
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = process.env.API_BASE || "http://127.0.0.1:8787";
const WIN = process.platform === "win32";
const D1_DIR = ".wrangler/state/v3/d1";

/** يقتل عمليات wrangler/workerd بحسب سطر الأمر (قتل workerd وحده يبقي أب wrangler ممسكاً بالمنفذ وملفات sqlite). */
function killWrangler() {
  if (WIN) {
    const ps = "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|workerd' -and $_.CommandLine -match 'wrangler|workerd' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
    spawnSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "ignore" });
  } else {
    spawnSync("pkill", ["-f", "wrangler|workerd"], { stdio: "ignore" });
  }
}

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  return spawnSync(cmd, { shell: true, stdio: "inherit" }).status ?? 1;
}

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).status === 200) return true; } catch { /* لم يبدأ بعد */ }
    await sleep(2000);
  }
  return false;
}

let server;
let code = 1;
try {
  console.log("1) إيقاف بقايا wrangler");
  killWrangler();
  await sleep(8000); // بعد القتل مباشرة قد يفشل db:migrate بخطأ «bad port»

  console.log("2) مسح D1 المحلية وتطبيق الهجرات");
  rmSync(D1_DIR, { recursive: true, force: true });
  if (run("npm run db:migrate:local") !== 0) {
    await sleep(8000);
    rmSync(D1_DIR, { recursive: true, force: true });
    if (run("npm run db:migrate:local") !== 0) throw new Error("فشل تطبيق الهجرات");
  }

  console.log("3) تشغيل الخادم المحلي");
  server = spawn("npm run dev:api", { shell: true, stdio: "ignore" });
  if (!(await waitHealthy())) throw new Error("لم يصبح الخادم جاهزاً");

  console.log("4) البذر ثم اختبارات التكامل");
  if (run("npm run db:seed:local") !== 0) throw new Error("فشل البذر");
  code = run("npm run test:api");
} catch (e) {
  console.error(`\n✗ ${e.message}`);
} finally {
  if (server?.pid && WIN) spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  killWrangler();
}
console.log(code === 0 ? "\n✓ اختبارات التكامل نجحت على قاعدة نظيفة" : "\n✗ اختبارات التكامل لم تنجح");
process.exit(code);

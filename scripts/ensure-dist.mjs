// wrangler يشترط وجود مجلد dist حتى في التطوير (الواجهة تُخدم من Vite لا منه).
import { mkdirSync } from "node:fs";
mkdirSync("dist", { recursive: true });

const fs = require('fs');
let code = fs.readFileSync('worker/routes/students.ts', 'utf8');

const getPhotoRoute = `
studentRoutes.get("/:id/photo", requireAuth("admin", "secretary", "teacher", "stage_manager"), async (c) => {
  const current = await loadStudent(c, c.req.param("id"));
  const p = await photoOf(c, current.id);
  if (!p || !p.startsWith("data:image/")) return c.body(null, 404);
  const match = p.match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/);
  if (!match) return c.body(null, 404);
  const binary = Uint8Array.from(atob(match[2]), (m) => m.codePointAt(0)!);
  return c.body(binary, 200, {
    "Content-Type": match[1],
    "Cache-Control": "public, max-age=31536000, immutable"
  });
});
`;

code = code.replace(/studentRoutes\.post\("\/:id\/photo"/, getPhotoRoute + '\nstudentRoutes.post("/:id/photo"');

fs.writeFileSync('worker/routes/students.ts', code);

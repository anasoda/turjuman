const fs = require('fs');
let code = fs.readFileSync('src/pages/Students.tsx', 'utf8');

const replacement = `
              <button className="row-main" type="button" onClick={() => setDetail(s)}>
                {s.hasPhoto ? <img src={\`/api/students/\${s.id}/photo\`} alt={s.name} className="avatar" /> : <span className="avatar">{initials(s.name)}</span>}
                <span className="grow">
`;

code = code.replace(/<button className="row-main" type="button" onClick=\{\(\) => setDetail\(s\)\}>\s*<span className="avatar">\{initials\(s\.name\)\}<\/span>\s*<span className="grow">/, replacement);

fs.writeFileSync('src/pages/Students.tsx', code);

const fs = require('fs');
// Fix Shell.tsx
let shellCode = fs.readFileSync('src/components/Shell.tsx', 'utf8');
if (!shellCode.includes('const { confirm } = useUi();')) {
  shellCode = shellCode.replace(/export function Shell\(\) \{/, 'export function Shell() {\n  const { confirm } = useUi();');
  fs.writeFileSync('src/components/Shell.tsx', shellCode);
}
// Fix More.tsx
let moreCode = fs.readFileSync('src/pages/More.tsx', 'utf8');
if (!moreCode.includes('const { confirm } = useUi();')) {
  if (moreCode.includes('useUi()')) {
    moreCode = moreCode.replace(/const \{([^}]+)\} = useUi\(\)/, (m, p1) => `const { confirm, ${p1.trim()} } = useUi()`);
  } else {
    moreCode = moreCode.replace(/import \{ Icons.*\} from "\.\.\/components\/ui";/, 'import { Icons, useUi } from "../components/ui";');
    moreCode = moreCode.replace(/export function More\(\) \{/, 'export function More() {\n  const { confirm } = useUi();');
  }
  fs.writeFileSync('src/pages/More.tsx', moreCode);
}

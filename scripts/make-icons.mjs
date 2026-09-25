// يولّد أيقونات PWA بسيطة (مربع أخضر بحواف مستديرة + مصحف مبسّط) بدون أي مكتبة.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const bg = [18, 76, 60], gold = [196, 154, 90], page = [247, 242, 233];
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const s = size, cx = s / 2, cy = s / 2;
  for (let y = 0; y < s; y++) {
    raw[y * (s * 4 + 1)] = 0;
    for (let x = 0; x < s; x++) {
      let col = bg;
      // كتاب مفتوح: مستطيلان متجاوران، وخط ذهبي في المنتصف
      const bw = s * 0.30, bh = s * 0.40;
      const inLeft = x > cx - bw - s * 0.01 && x < cx - s * 0.01 && Math.abs(y - cy) < bh / 2;
      const inRight = x > cx + s * 0.01 && x < cx + bw + s * 0.01 && Math.abs(y - cy) < bh / 2;
      if (inLeft || inRight) col = page;
      if (Math.abs(x - cx) < s * 0.008 && Math.abs(y - cy) < bh / 2 + s * 0.02) col = gold;
      if (Math.abs(y - (cy + bh / 2 + s * 0.05)) < s * 0.012 && x > cx - bw && x < cx + bw) col = gold;
      const i = y * (s * 4 + 1) + 1 + x * 4;
      raw[i] = col[0]; raw[i + 1] = col[1]; raw[i + 2] = col[2]; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0); ihdr.writeUInt32BE(s, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))
  ]);
}
mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512]) writeFileSync(`public/icons/icon-${size}.png`, png(size));
console.log("icons written");

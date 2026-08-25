// Minimal Code128-B barcode SVG generator (no dependencies).
const PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
];

const START_B = 104;
const STOP = 106;

// Renders a Code128-B barcode as an SVG string. ASCII 32-126 only.
export function code128Svg(text, { height = 44, module = 2 } = {}) {
  const clean = String(text ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, 40);
  const codes = [START_B];
  let checksum = START_B;
  for (let i = 0; i < clean.length; i++) {
    const v = clean.charCodeAt(i) - 32;
    codes.push(v);
    checksum += (i + 1) * v;
  }
  codes.push(checksum % 103);
  codes.push(STOP);

  const widths = [];
  for (const c of codes) {
    for (const d of PATTERNS[c]) widths.push(Number(d));
  }

  const totalUnits = widths.reduce((a, b) => a + b, 0);
  const width = totalUnits * module;
  const svgWidth = Math.max(width, 1);
  let x = 0;
  let bars = '';
  widths.forEach((w, i) => {
    if (i % 2 === 0) {
      bars += `<rect x="${x}" y="0" width="${w * module}" height="${height}" fill="#000"/>`;
    }
    x += w * module;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${height}" width="${svgWidth}" height="${height}" role="img" aria-label="barcode">${bars}</svg>`;
}

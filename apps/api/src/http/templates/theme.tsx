// src/http/templates/theme.ts
// phase-4 — string-builder به‌جای JSX: پیش‌نیاز cross-package typing
// (web با react-jsx «class» را تایپ‌رد می‌کند). esc() صریح = همان امنیت XSS.

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export { esc }

export function Page(props: { title: string; subtitle?: string; children: string }): string {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(props.title)} | سین‌شین</title>
<style>${CSS}</style>
</head>
<body>
<div class="header">
<h1>${esc(props.title)}</h1>
 ${props.subtitle ? `<p class="subtitle">${esc(props.subtitle)}</p>` : ''}
</div>
<div class="toolbar">
<button onclick="window.print()">🖨 چاپ / PDF</button>
</div>
<main>${props.children}</main>
<footer><p>سین‌شین فودپارک — تولیدشده در ${esc(new Date().toLocaleString('fa-IR'))}</p></footer>
</body>
</html>`
}

export function Table(props: { head: string[]; rows: string[][] }): string {
  const head = props.head.map((h) => `<th>${esc(h)}</th>`).join('')
  const body = props.rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('\n')
  return `<table>
<thead>
<tr>${head}</tr>
</thead>
<tbody>
 ${body}
</tbody>
</table>`
}

export function Stat(props: { label: string; value: string }): string {
  return `<div class="stat"><span class="stat-label">${esc(props.label)}</span><span class="stat-value">${esc(props.value)}</span></div>`
}

const CSS = `
* { box-sizing: border-box; }
body { font-family: Vazirmatn, Tahoma, 'Segoe UI', sans-serif; direction: rtl; margin: 0; background: #faf7f8; color: #1a0a0e; }
.header { background: linear-gradient(135deg, #f6339a, #d81b72); color: white; padding: 28px 40px; }
.header h1 { margin: 0; font-size: 24px; }
.subtitle { margin: 8px 0 0; opacity: 0.9; font-size: 14px; }
.toolbar { padding: 12px 40px; display: flex; gap: 8px; }
.toolbar button, .toolbar .btn { background: white; border: 1px solid #f0c; padding: 8px 18px; border-radius: 10px; cursor: pointer; font-family: inherit; font-size: 13px; text-decoration: none; color: #1a0a0e; display: inline-block; }
.toolbar button:hover, .toolbar .btn:hover { background: #fdf2f8; }
main { padding: 0 40px 30px; }
section { background: white; border-radius: 14px; padding: 18px 22px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
section h2 { font-size: 16px; margin: 0 0 12px; color: #d81b72; border-bottom: 1px solid #fde7f2; padding-bottom: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: right; padding: 8px 10px; background: #fdf2f8; color: #9d174d; font-weight: 600; }
td { padding: 8px 10px; border-bottom: 1px solid #f5f0f2; }
tr:nth-child(even) td { background: #fcf9fa; }
.stats { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 20px; }
.stat { background: white; border-radius: 14px; padding: 14px 20px; min-width: 140px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.stat-label { display: block; font-size: 12px; color: #888; margin-bottom: 4px; }
.stat-value { display: block; font-size: 20px; font-weight: 700; color: #d81b72; }
footer { text-align: center; padding: 20px; color: #aaa; font-size: 12px; }
@media print {
  .toolbar { display: none; }
  body { background: white; }
  section { box-shadow: none; }
}`
// src/http/templates/mini-report.ts
// phase-4 — string-builder (همان قرارداد؛ JSX حذف برای cross-package typing)
import { esc, Page, Stat, Table } from './theme'

export interface MiniReportViewModel {
  title: string
  subtitle: string
  stats?: { label: string; value: string }[]
  tables: { title: string; head: string[]; rows: string[][] }[]
}

/** گزارش صفحه‌ای پنل‌ها */
export function MiniReportPage(vm: MiniReportViewModel): string {
  const stats =
    vm.stats && vm.stats.length > 0
      ? `<div class="stats">${vm.stats.map((s) => Stat(s)).join('')}</div>`
      : ''
  const tables = vm.tables
    .map(
      (t) =>
        `<section><h2>${esc(t.title)}</h2>${Table({ head: t.head, rows: t.rows })}</section>`,
    )
    .join('')
  return Page({ title: vm.title, subtitle: vm.subtitle, children: stats + tables })
}
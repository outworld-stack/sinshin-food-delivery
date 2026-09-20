// src/http/templates/report.ts
// phase-4 — string-builder به‌جای JSX (آخرین فایل JSX بک‌اند)
import { esc, Page, Stat, Table } from './theme'

export interface ReportViewModel {
  title: string
  subtitle: string
  range: 'yesterday' | 'today' | 'week'
  csvUrl: string
  stats: { label: string; value: string }[]
  orders: { head: string[]; rows: string[][] }
  wallet: { head: string[]; rows: string[][] }
  reconcile?: { head: string[]; rows: string[][] } | null
}

/** صفحه‌ی گزارش کامل — روزانه/هفتگی */
export function ReportPage(vm: ReportViewModel): string {
  const toolbar = `<div class="toolbar"><a class="btn" href="${esc(vm.csvUrl)}?range=${esc(vm.range)}">📊 خروجی CSV (اکسل)</a></div>`
  const stats = `<div class="stats">${vm.stats.map((s) => Stat(s)).join('')}</div>`
  const reconcile = vm.reconcile
    ? `<section><h2>مغایرت‌ها</h2>${Table({ head: vm.reconcile.head, rows: vm.reconcile.rows })}</section>`
    : ''

  return Page({
    title: vm.title,
    subtitle: vm.subtitle,
    children:
      toolbar +
      stats +
      `<section><h2>سفارشات</h2>${Table({ head: vm.orders.head, rows: vm.orders.rows })}</section>` +
      `<section><h2>کیف پول</h2>${Table({ head: vm.wallet.head, rows: vm.wallet.rows })}</section>` +
      reconcile,
  })
}
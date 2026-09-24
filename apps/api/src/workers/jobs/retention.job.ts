// src/workers/jobs/retention.job.ts
import { sql } from 'drizzle-orm'

import type { Db } from '#/infra/db/client'
import type { DailyJob } from '#/workers/scheduler'

/**
 * round-16 — نگهداشت جدول‌های رشد-بی‌سقف (پایداری بلندمدت):
 *
 * audit_logs / device_events / admin2_activities / admin2_sessions و
 * نشست‌های مرده‌ی کاربران برای همیشه رشد می‌کنند؛ بدون پاک‌سازی دوره‌ای،
 * کوئری‌های لاگ/گزارش به‌مرور کند می‌شوند و دیسک پر می‌شود — چیزی که
 * بعد از ماه‌ها به‌شکل «بک‌اند کند/کرش شده» حس می‌شود.
 *
 *  • حذف‌ها Bounded هستند: حداکثر ۵٬۰۰۰ ردیف به‌ازای هر جدول در هر اجرا؛
 *    اگر بیشتر باشد، روز بعد ادامه می‌یابد (بدون تراکنش طولانی/قفل سنگین).
 *  • داده‌ی مالی (سفارش‌ها/کیف پول/پرداخت‌ها) هرگز لمس نمی‌شود.
 *  • نشست مرده = منقضی‌شده یا باطل‌شده‌ای که ۹۰ روز از مرگش گذشته.
 *
 * round-20 — checkout_idempotency: پنجرهٔ replay چک‌اوت؛ ردیف‌های
 * ۴۸-ساعته (تکمیل‌شده یا رهاشده) حذف می‌شوند — ادعای زنده هرگز
 * این‌قدر قدیمی نیست (تصرف خودکار بعد از ۶۰ ثانیه).
 */
export class RetentionJob implements DailyJob {
  readonly name = 'retention'
  readonly time = '04:30'
  readonly catchUp = true

  constructor(private readonly deps: { db: Db }) {}

  async run(): Promise<void> {
    const logCutoff = sql`now() - interval '180 days'`
    const deadSessionCutoff = sql`now() - interval '90 days'`
    const BATCH = 5000

    const targets: Array<{ label: string; stmt: ReturnType<typeof sql> }> = [
      {
        label: 'audit_logs',
        stmt: sql`
          delete from audit_logs
          where id in (
            select id from audit_logs where created_at < ${logCutoff} limit ${BATCH}
          )
        `,
      },
      {
        label: 'device_events',
        stmt: sql`
          delete from device_events
          where id in (
            select id from device_events where created_at < ${logCutoff} limit ${BATCH}
          )
        `,
      },
      {
        label: 'admin2_activities',
        stmt: sql`
          delete from admin2_activities
          where id in (
            select id from admin2_activities where created_at < ${logCutoff} limit ${BATCH}
          )
        `,
      },
      {
        label: 'admin2_sessions',
        stmt: sql`
          delete from admin2_sessions
          where id in (
            select id from admin2_sessions
            where login_at < ${logCutoff}
              and (logout_at is not null or login_at < now() - interval '2 days')
            limit ${BATCH}
          )
        `,
      },
      {
        label: 'sessions (dead)',
        stmt: sql`
          delete from sessions
          where id in (
            select id from sessions
            where (expires_at < ${deadSessionCutoff})
               or (revoked_at is not null and revoked_at < ${deadSessionCutoff})
            limit ${BATCH}
          )
        `,
      },
      {
        // ctid — شناسهٔ فیزیکی ردیف؛ PK این جدول مرکب است و ctid از
        // تکرار شرط کلید در delete بی‌نیاز می‌کند (همان الگوی id ساده)
        label: 'checkout_idempotency',
        stmt: sql`
          delete from checkout_idempotency
          where ctid in (
            select ctid from checkout_idempotency
            where updated_at < now() - interval '48 hours'
            limit ${BATCH}
          )
        `,
      },
    ]

    for (const t of targets) {
      try {
        await this.deps.db.execute(t.stmt)
      } catch (err) {
        // یک جدول شکست بخورد → بقیه ادامه می‌یابند؛ خطا در لاگ cron دیده می‌شود
        console.error(`[retention] "${t.label}" cleanup failed:`, err)
      }
    }
  }
}

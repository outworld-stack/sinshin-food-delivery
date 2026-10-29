# SMS reports and database backups

The daily 01:00 and Saturday 01:05 Tehran SMS jobs deliver report ZIPs. Daily ZIPs contain orders, new users, a summary and Docker logs (or an explicit explanation when logs are unavailable). Weekly ZIPs contain that week's orders, new users and a summary. These are exports, not full database backups.

The separate `backup` container runs `pg_dump` at `BACKUP_HOUR` (05:00 Tehran by default), saving `.sql.gz` files to `BACKUP_DIR_HOST`. It does not send the SMS links.

## Confirmed defects and fixes

| Problem | Correction |
| --- | --- |
| SMS.ir parameters were truncated to 25 characters, destroying the much longer signed report token. | New authenticated tokens are 24 URL-safe characters. Oversized or malformed report tokens are rejected before sending. |
| Jobs sent links without first creating a ZIP. Downloads recalculated yesterday/last week at click time. | ZIP, CSV and report view are saved and verified before SMS. The exact report period and bytes remain fixed across midnight, database changes and API restarts. |
| Weekly SQL boundaries and displayed dates depended on the server timezone. | Weekly boundaries explicitly use Tehran midnight, and date labels show the inclusive Tehran calendar period. |
| Docker's binary log response was parsed as JSON. | Log streams are read as bytes and decoded correctly. |
| Failed log writes advanced the collection marker, and truncating live logs could lose newer lines. | The marker advances only after the saved report and successful delivery. Reporting no longer truncates live logs; Docker log rotation handles retention. |
| Exports silently stopped at 10,000 rows. | Saved report exports include all matching rows. |
| Missed weekly runs and failed report runs could remain unsent. Later restarts could resend completed daily runs. | Report jobs recover within their daily/weekly period, retry failures after five minutes, and use atomic Redis ownership and completion markers. |
| Backup publication errors could still log success and prune earlier copies. | Dump completion, gzip integrity and publication must succeed before retention runs. |
| The backup daemon required the exact scheduled minute and did not retry failed dumps or offsite uploads. | It catches up later the same day and retries failures every five minutes. Offsite retries reuse the validated saved archive. |
| Restore drills ignored SQL errors and could exit successfully on failure. | Strict decompression and SQL error checks, core-table checks, nonzero failure status and isolated containers. |
| Offsite copies could skip fresh files or fall back to plaintext after encryption failure. | Fresh copies are attempted immediately; requested encryption failures stop offsite upload and preserve the local backup. |

## Storage and download behavior

Report snapshots live in `UPLOAD_DIR/.reports/bundles` on the existing persistent uploads volume, with private permissions. Public image-serving routes cannot serve these files. Downloads require a valid expiring report token, verify stored hashes, and return ZIP attachment headers, a filename, content length and `no-store`. Missing/corrupt files return an explicit error.

`REPORT_TOKEN_TTL_HOURS` remains 24 hours by default. New tokens retain their original expiry even if this setting changes. Expired snapshots are pruned on later report generation. Already downloaded files remain ordinary local ZIPs and do not expire.

SMS.ir daily and weekly templates must contain:

```text
https://YOUR_DOMAIN/api/reports/download/#TOKEN#
```

Existing truncated SMS URLs cannot be reconstructed. After deploying the updated API, the next scheduled report supplies a working link. An authenticated main admin can also request a fresh report with `POST /api/reports/send/daily` or `POST /api/reports/send/weekly`. Those endpoints send real SMS in production. Level 2 admins and ordinary users cannot trigger them.

Deploy the updated API and restart the backup container so its long-running shell reloads the updated script. Keep the persistent uploads volume. Report downloads do not require a frontend rebuild.

## Verification

```sh
cd apps/api
bun run typecheck
bun run test:reports
bun run db:test:reports
```

Database tests require local PostgreSQL and scheduler tests use isolated local Redis keys. SMS transports are mocked; no real SMS is sent. Report download tests save synthetic ZIPs for independent extraction checks.

Local verification passed: API and web type checks, token/SMS and scheduler checks, six report-download groups, four Docker-log groups, eleven financial regression groups, and all twelve backup/restore groups. The three saved synthetic ZIPs also passed independent `unzip -t` checks. Production SMS templates, live delivery and deployment were not accessed.

From the repository root:

```sh
sh deploy/backup/test-backup.sh --docker
```

This exercises injected backup/restore failures and a real PostgreSQL dump → compressed file → separate restore. It uses temporary files and containers, leaving existing databases and backups untouched.

For a manual production backup, `docker compose exec backup /bin/sh /usr/local/bin/sinshin-backup --once` creates and validates a new backup using the configured retention. Run `deploy/backup/restore-drill.sh` on the host to restore the latest archive into a temporary isolated database; failure exits nonzero.

The default PostgreSQL backup image does not contain `rclone` or `age`. Offsite backup needs those tools, a configured destination and credentials, and outbound networking on the host or a custom container; setting root `.env` variables alone is insufficient.

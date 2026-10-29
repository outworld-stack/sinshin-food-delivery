#!/bin/sh
# Isolated filesystem/process regressions; no existing backups or SMS are touched.
# --docker also exercises pg_dump and restoration with PostgreSQL.
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
TEMP_ROOT="$(CDPATH= cd -- "${TMPDIR:-/tmp}" && pwd -P)"
WORK="$(mktemp -d "$TEMP_ROOT/sinshin-backup-test.XXXXXX")"
WORK="$(CDPATH= cd -- "$WORK" && pwd -P)"
case "$WORK" in "$TEMP_ROOT"/sinshin-backup-test.*) ;; *) exit 1 ;; esac
ORIGINAL_PATH="$PATH"
REAL_GZIP="$(command -v gzip)"
REAL_MV="$(command -v mv)"
REAL_DOCKER="$(command -v docker || true)"
SOURCE_ID=''
cleanup() {
    if [ -n "$SOURCE_ID" ]; then "$REAL_DOCKER" rm -fv "$SOURCE_ID" >/dev/null 2>&1 || true; fi
    # WORK was resolved and checked against the task's own temporary prefix above.
    rm -rf "$WORK"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM
mkdir "$WORK/bin"
export REAL_GZIP REAL_MV REAL_DOCKER
FIXTURE="$WORK/fixture.sql"
export FIXTURE
printf '%s\n' '-- PostgreSQL database dump' > "$FIXTURE"
for table in users orders wallet_transactions t01 t02 t03 t04 t05 t06 t07 t08 t09; do
    printf 'CREATE TABLE public.%s (id integer);\n' "$table" >> "$FIXTURE"
done
printf '%s\n' 'INSERT INTO public.users VALUES (123456789);' '-- PostgreSQL database dump complete' >> "$FIXTURE"

cat > "$WORK/bin/pg_dump" <<'SH'
#!/bin/sh
cat "$CLOCK_FILE" >> "$DUMP_LOG"
case "${DUMP_MODE:-ok}" in
    fail) printf 'partial'; exit 1 ;;
    empty) exit 0 ;;
    incomplete) printf '%s\n' '-- PostgreSQL database dump'; exit 0 ;;
    fail-once) [ "$(wc -l < "$DUMP_LOG")" -gt 1 ] || exit 1 ;;
esac
cat "$FIXTURE"
SH
cat > "$WORK/bin/gzip" <<'SH'
#!/bin/sh
[ "${1:-}" != -t ] || printf 'test\n' >> "$GZIP_TEST_LOG"
if [ "${1:-}" = -9 ]; then
    case "${GZIP_MODE:-ok}" in fail) exit 1 ;; corrupt) printf broken; exit 0 ;; esac
fi
exec "$REAL_GZIP" "$@"
SH
cat > "$WORK/bin/mv" <<'SH'
#!/bin/sh
[ "${MV_MODE:-ok}" = ok ] || exit 1
exec "$REAL_MV" "$@"
SH
cat > "$WORK/bin/date" <<'SH'
#!/bin/sh
case "${1:-}" in
    +%Y-%m-%d_%H%M) cat "$CLOCK_FILE" ;;
    +%Y-%m-%d) printf '2026-10-29\n' ;;
    +%H%M) printf '1200\n' ;;
    *) printf '2026-10-29 12:00:00\n' ;;
esac
SH
cat > "$WORK/bin/sleep" <<'SH'
#!/bin/sh
printf '%s\n' "$1" >> "$SLEEP_LOG"
case "${SLEEP_MODE:-noop}" in
    stop) kill -TERM "$PPID" ;;
    sequence)
        STEP="$(wc -l < "$SLEEP_LOG")"
        NEXT="$(sed -n "${STEP}p" "$SLEEP_SEQUENCE")"
        [ -z "$NEXT" ] || printf '%s\n' "$NEXT" > "$CLOCK_FILE"
        [ "$STEP" -lt "$STOP_AFTER" ] || kill -TERM "$PPID"
        ;;
esac
SH
cat > "$WORK/bin/rclone" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$RCLONE_LOG"
case "$*" in *--min-age*) exit 1 ;; esac
case "${COPY_MODE:-ok}" in
    ok) exit 0 ;;
    fail-once) [ "$(wc -l < "$RCLONE_LOG")" -gt 1 ] ;;
    *) exit 1 ;;
esac
SH
cat > "$WORK/bin/age" <<'SH'
#!/bin/sh
[ "${AGE_MODE:-ok}" = ok ] || exit 1
printf encrypted
SH
cat > "$WORK/bin/docker" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$DOCKER_LOG"
case "${1:-}" in
    create) [ "${DOCKER_MODE:-ok}" != create-fail ] || exit 1; printf 'scratch-container-id\n' ;;
    start) [ "${DOCKER_MODE:-ok}" != start-fail ] ;;
    exec)
        case "$*" in
            *pg_isready*) [ "${DOCKER_MODE:-ok}" != not-ready ] ;;
            *-tAc*)
                [ "${DOCKER_MODE:-ok}" != query-fail ] || exit 1
                case "$*" in *table_name*) printf '%s\n' "${CORE_TABLES:-3}" ;; *) printf '%s\n' "${TOTAL_TABLES:-12}" ;; esac
                ;;
            *)
                case "$*" in *ON_ERROR_STOP=1*) ;; *) exit 1 ;; esac
                cat >/dev/null
                [ "${DOCKER_MODE:-ok}" != sql-fail ]
                ;;
        esac
        ;;
    rm) [ "${3:-}" = scratch-container-id ] ;;
    *) exit 1 ;;
esac
SH
chmod +x "$WORK/bin/"*
PATH="$WORK/bin:$PATH"
export PATH

CASE=0
PASSED=0
pass() { PASSED=$((PASSED + 1)); printf 'PASS %s\n' "$*"; }
new_case() {
    CASE=$((CASE + 1))
    BACKUP_DIR="$WORK/case-$CASE"
    mkdir "$BACKUP_DIR"
    BACKUP_KEEP=2 BACKUP_HOUR=5
    DUMP_MODE=ok GZIP_MODE=ok MV_MODE=ok AGE_MODE=ok COPY_MODE=ok SLEEP_MODE=noop
    BACKUP_RCLONE_REMOTE='' BACKUP_AGE_PUBKEY=''
    DOCKER_MODE=ok CORE_TABLES=3 TOTAL_TABLES=12
    RCLONE_LOG="$WORK/rclone-$CASE.log" DOCKER_LOG="$WORK/docker-$CASE.log"
    RESTORE_DRILL_LOG_FILE="$WORK/restore-$CASE.log"
    CLOCK_FILE="$WORK/clock-$CASE" DUMP_LOG="$WORK/dump-$CASE.log" GZIP_TEST_LOG="$WORK/gzip-$CASE.log"
    SLEEP_LOG="$WORK/sleep-$CASE.log" SLEEP_SEQUENCE="$WORK/sequence-$CASE" STOP_AFTER=3
    printf '2026-10-29_1200\n' > "$CLOCK_FILE"
    : > "$SLEEP_SEQUENCE"
    export BACKUP_DIR BACKUP_KEEP BACKUP_HOUR DUMP_MODE GZIP_MODE MV_MODE AGE_MODE COPY_MODE SLEEP_MODE
    export BACKUP_RCLONE_REMOTE BACKUP_AGE_PUBKEY RCLONE_LOG DOCKER_MODE CORE_TABLES TOTAL_TABLES DOCKER_LOG RESTORE_DRILL_LOG_FILE
    export CLOCK_FILE DUMP_LOG GZIP_TEST_LOG SLEEP_LOG SLEEP_SEQUENCE STOP_AFTER
}
old_copies() {
    for day in 01 02 03; do
        "$REAL_GZIP" -c "$FIXTURE" > "$BACKUP_DIR/sinshin-2000-01-${day}_0500.sql.gz"
        touch -t "200001${day}0500" "$BACKUP_DIR/sinshin-2000-01-${day}_0500.sql.gz"
    done
}
count_copies() { find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.sql.gz' | wc -l; }
expect_backup_failure() {
    if sh "$SCRIPT_DIR/backup.sh" --once > "$WORK/output" 2>&1; then
        cat "$WORK/output" >&2; printf 'Unexpected backup success\n' >&2; exit 1
    fi
}
expect_restore_failure() {
    if sh "$SCRIPT_DIR/restore-drill.sh" "$BACKUP_DIR" > "$WORK/output" 2>&1; then
        cat "$WORK/output" >&2; printf 'Unexpected restore success\n' >&2; exit 1
    fi
    grep -q FAIL "$RESTORE_DRILL_LOG_FILE"
}
valid_copy() { "$REAL_GZIP" -c "$FIXTURE" > "$BACKUP_DIR/sinshin-2026-10-29_1200.sql.gz"; }

new_case
old_copies
sh "$SCRIPT_DIR/backup.sh" --once > "$WORK/output" 2>&1
[ "$(count_copies)" -eq 2 ]
gzip -cd "$BACKUP_DIR/sinshin-2026-10-29_1200.sql.gz" > "$WORK/restored.sql"
cmp "$FIXTURE" "$WORK/restored.sql"
pass 'complete gzip archive round-trips and retention keeps the newest copies'

for failure in dump-fail dump-empty dump-incomplete gzip-fail gzip-corrupt publication-fail; do
    new_case
    old_copies
    BACKUP_KEEP=1
    case "$failure" in
        dump-*) DUMP_MODE="${failure#dump-}" ;;
        gzip-*) GZIP_MODE="${failure#gzip-}" ;;
        publication-fail) MV_MODE=fail ;;
    esac
    expect_backup_failure
    [ "$(count_copies)" -eq 3 ]
    [ ! -e "$BACKUP_DIR/sinshin-2026-10-29_1200.sql.gz" ]
    [ "$(find "$BACKUP_DIR" -mindepth 1 -type d | wc -l)" -eq 0 ]
done
pass 'dump, empty/truncated output, gzip, integrity and publication failures preserve prior backups'

for keep in 0 -1 abc 999999999999999999999; do
    new_case; old_copies; BACKUP_KEEP="$keep"; expect_backup_failure
    [ "$(count_copies)" -eq 3 ]
done
new_case; BACKUP_HOUR=24; expect_backup_failure
pass 'invalid retention and schedule settings fail without deleting backups'

for kind in corrupt empty valid; do
    new_case
    case "$kind" in
        corrupt) printf broken > "$BACKUP_DIR/sinshin-2026-10-29_1200.sql.gz" ;;
        empty) printf '' | "$REAL_GZIP" -c > "$BACKUP_DIR/sinshin-2026-10-29_1200.sql.gz" ;;
        valid) valid_copy ;;
    esac
    SLEEP_MODE=stop
    { sh "$SCRIPT_DIR/backup.sh"; } > "$WORK/output" 2>&1 || true
    gzip -cd "$BACKUP_DIR/sinshin-2026-10-29_1200.sql.gz" > "$WORK/restored.sql"
    cmp "$FIXTURE" "$WORK/restored.sql"
    if [ "$kind" = valid ]; then ! grep -q 'pg_dump شروع' "$WORK/output"; fi
done
pass 'startup replaces corrupt/empty archives and recognizes a valid existing daily backup'

new_case
DUMP_MODE=fail-once SLEEP_MODE=sequence
printf '2026-10-29_0503\n' > "$CLOCK_FILE"
printf '2026-10-29_0508\n2026-10-29_0510\n' > "$SLEEP_SEQUENCE"
{ sh "$SCRIPT_DIR/backup.sh"; } > "$WORK/output" 2>&1 || true
[ "$(wc -l < "$DUMP_LOG")" -eq 2 ]
[ "$(sed -n '1p' "$SLEEP_LOG")" = 300 ]
[ "$(sed -n '2p' "$DUMP_LOG")" = 2026-10-29_0508 ]
[ "$(count_copies)" -eq 1 ]
gzip -t "$BACKUP_DIR/sinshin-2026-10-29_0508.sql.gz"
pass 'a transient dump failure retries after five minutes and succeeds after the scheduled minute'

new_case
SLEEP_MODE=sequence STOP_AFTER=5
printf '2026-10-29_0459\n' > "$CLOCK_FILE"
printf '2026-10-29_0504\n2026-10-29_1800\n2026-10-30_0507\n2026-10-30_1300\n' > "$SLEEP_SEQUENCE"
{ sh "$SCRIPT_DIR/backup.sh"; } > "$WORK/output" 2>&1 || true
[ "$(wc -l < "$DUMP_LOG")" -eq 2 ]
[ -f "$BACKUP_DIR/sinshin-2026-10-29_0504.sql.gz" ]
[ -f "$BACKUP_DIR/sinshin-2026-10-30_0507.sql.gz" ]
[ "$(wc -l < "$GZIP_TEST_LOG")" -eq 2 ]
pass 'a running scheduler recovers missed minutes, generates the next day, and caches completed-day validation'

new_case
valid_copy
SLEEP_MODE=sequence STOP_AFTER=4
{ sh "$SCRIPT_DIR/backup.sh"; } > "$WORK/output" 2>&1 || true
[ ! -e "$DUMP_LOG" ]
[ "$(wc -l < "$GZIP_TEST_LOG")" -eq 1 ]
pass 'an existing valid daily archive is checked once rather than inflated on every poll'

new_case
BACKUP_RCLONE_REMOTE=test:backups COPY_MODE=fail-once SLEEP_MODE=sequence
printf '2026-10-29_1205\n2026-10-29_1207\n' > "$SLEEP_SEQUENCE"
{ sh "$SCRIPT_DIR/backup.sh"; } > "$WORK/output" 2>&1 || true
[ "$(wc -l < "$DUMP_LOG")" -eq 1 ]
[ "$(wc -l < "$RCLONE_LOG")" -eq 2 ]
[ "$(sed -n '1p' "$SLEEP_LOG")" = 300 ]
[ "$(count_copies)" -eq 1 ]
[ -f "$BACKUP_DIR/sinshin-2026-10-29_1200.sql.gz" ]
pass 'a transient offsite failure retries the saved archive without generating or pruning another local snapshot'

new_case
BACKUP_RCLONE_REMOTE=test:backups
sh "$SCRIPT_DIR/backup.sh" --once > "$WORK/output" 2>&1
grep -q '^copy ' "$RCLONE_LOG"
! grep -q -- --min-age "$RCLONE_LOG"
new_case
BACKUP_RCLONE_REMOTE=test:backups BACKUP_AGE_PUBKEY=test-key AGE_MODE=fail
expect_backup_failure
[ ! -e "$RCLONE_LOG" ]
[ "$(count_copies)" -eq 1 ]
new_case
BACKUP_RCLONE_REMOTE=test:backups COPY_MODE=fail
expect_backup_failure
[ "$(count_copies)" -eq 1 ]
pass 'fresh offsite copies are not skipped; failed encryption never sends plaintext; copy failures retain local backups'

new_case; valid_copy
sh "$SCRIPT_DIR/restore-drill.sh" "$BACKUP_DIR" > "$WORK/output" 2>&1
grep -q PASS "$RESTORE_DRILL_LOG_FILE"
grep -q -- '--network none' "$DOCKER_LOG"
grep -q '^rm -fv scratch-container-id$' "$DOCKER_LOG"
pass 'restore uses strict SQL error handling, checks core tables, and cleans only its own container and volume'

for failure in corrupt empty incomplete sql-fail query-fail not-ready start-fail create-fail missing-core missing-tables; do
    new_case
    case "$failure" in
        corrupt) printf broken > "$BACKUP_DIR/sinshin-2026-10-29_1200.sql.gz" ;;
        empty) printf '' | "$REAL_GZIP" -c > "$BACKUP_DIR/sinshin-2026-10-29_1200.sql.gz" ;;
        incomplete) printf 'select 1;' | "$REAL_GZIP" -c > "$BACKUP_DIR/sinshin-2026-10-29_1200.sql.gz" ;;
        missing-core) valid_copy; CORE_TABLES=0 ;;
        missing-tables) valid_copy; TOTAL_TABLES=2 ;;
        *) valid_copy; DOCKER_MODE="$failure" ;;
    esac
    expect_restore_failure
    case "$failure" in
        corrupt|empty|incomplete) [ ! -e "$DOCKER_LOG" ] ;;
        create-fail) ! grep -q '^rm ' "$DOCKER_LOG" ;;
        *) grep -q '^rm -fv scratch-container-id$' "$DOCKER_LOG" ;;
    esac
done
pass 'corrupt archives, SQL errors, unavailable databases and missing tables make restore drills fail'

if [ "${1:-}" = --docker ]; then
    [ -n "$REAL_DOCKER" ]
    "$REAL_DOCKER" image inspect postgres:18.6-alpine >/dev/null
    SOURCE_ID="$("$REAL_DOCKER" create --network none -e POSTGRES_PASSWORD=drill -e POSTGRES_USER=drill -e POSTGRES_DB=drill postgres:18.6-alpine)"
    "$REAL_DOCKER" start "$SOURCE_ID" >/dev/null
    READY=0
    for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
        if "$REAL_DOCKER" exec "$SOURCE_ID" pg_isready -h 127.0.0.1 -U drill -d drill >/dev/null 2>&1; then READY=1; break; fi
        PATH="$ORIGINAL_PATH" sleep 1
    done
    [ "$READY" = 1 ]
    "$REAL_DOCKER" exec -i "$SOURCE_ID" psql -X -U drill -d drill -v ON_ERROR_STOP=1 < "$FIXTURE" >/dev/null
    mkdir "$WORK/real-bin"
    cat > "$WORK/real-bin/pg_dump" <<'SH'
#!/bin/sh
exec "$REAL_DOCKER" exec "$SOURCE_ID" pg_dump -U drill -d drill "$@"
SH
    chmod +x "$WORK/real-bin/pg_dump"
    export SOURCE_ID
    new_case
    PATH="$WORK/real-bin:$ORIGINAL_PATH" sh "$SCRIPT_DIR/backup.sh" --once > "$WORK/output" 2>&1
    [ "$(count_copies)" -eq 1 ]
    PATH="$ORIGINAL_PATH" sh "$SCRIPT_DIR/restore-drill.sh" "$BACKUP_DIR" > "$WORK/output" 2>&1
    grep -q PASS "$RESTORE_DRILL_LOG_FILE"
    pass 'real PostgreSQL pg_dump archive restores successfully in a separate isolated PostgreSQL instance'
fi
printf 'Backup script safety: %s groups passed\n' "$PASSED"

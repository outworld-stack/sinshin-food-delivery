# Phase 7 — reconcile verification. Self-cleaning. UTF-8 with BOM.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
 $ErrorActionPreference = 'Stop'
 $base = 'http://localhost:3000'

function Send-Json($method, $url, $obj, $headers) {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $irm = @{ Method = $method; ContentType = 'application/json; charset=utf-8'; Body = $bytes }
  if ($headers) { $irm.Headers = $headers }
  try { return Invoke-RestMethod $url @irm }
  catch {
    $code = 0
    try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    $parsed = $null
    try { if ($_.ErrorDetails.Message) { $parsed = $_.ErrorDetails.Message | ConvertFrom-Json } } catch { }
    return [pscustomobject]@{ error = $parsed; __status = $code }
  }
}

function LoginPhone($phone, $devObj) {
  $r = Send-Json Post "$base/api/auth/otp/request" @{ phone = $phone } $null
  if ($r.__status -eq 429 -or -not $r.devCode) {
    Start-Sleep -Seconds 62
    $r = Send-Json Post "$base/api/auth/otp/request" @{ phone = $phone } $null
  }
  if (-not $r.devCode) { return $r }
  Send-Json Post "$base/api/auth/otp/verify" @{
    phone = $phone; code = $r.devCode; device = $devObj
    termsAccepted = $true; termsVersion = '1'
  } $null
}

function DevObj($id) {
  function FpHash($salt) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $b = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("${salt}:${id}"))
    ($b | ForEach-Object { $_.ToString('x2') }) -join ''
  }
  @{ clientId = $id; canvasHash = FpHash 'canvas'; webglHash = FpHash 'webgl'
     audioHash = FpHash 'audio'; fontsHash = FpHash 'fonts'
     screen = '1920x1080x24@1'; platform = 'Windows'
     timezone = 'Asia/Tehran'; language = 'fa-IR'; hardwareConcurrency = 8
     deviceMemory = 8; touch = $false; label = $id }
}

function P($name, $ok, $extra) {
  if ($ok) { Write-Host "PASS: $name $extra" -ForegroundColor Green }
  else { Write-Host "FAIL: $name $extra" -ForegroundColor Red; $script:failed = $true }
}
 $script:failed = $false

function OK($r) { $null -eq $r.__status }

function Pg($sql) {
  (podman compose -f compose.dev.yml exec postgres psql -U sinshin -d sinshin -t -c $sql) -join ''
}

# ============ self-clean ============
Write-Host '== cleanup ==' -ForegroundColor Cyan
 $sqls = @(
  'DELETE FROM reconcile_findings',
  'DELETE FROM coupon_nudges', 'DELETE FROM coupon_grants', 'DELETE FROM coupon_redemptions',
  'DELETE FROM coupon_conditions', "DELETE FROM coupons WHERE code <> 'SINSHIN20'",
  "UPDATE coupons SET used_count = 0 WHERE code = 'SINSHIN20'",
  'DELETE FROM admin2_activities', 'DELETE FROM admin2_sessions', 'DELETE FROM admin2_profiles',
  'DELETE FROM wallet_transactions', 'DELETE FROM referral_profits', 'DELETE FROM payments',
  'DELETE FROM order_items', 'DELETE FROM courier_deliveries', 'DELETE FROM courier_trips',
  'DELETE FROM orders', 'DELETE FROM reviews', 'DELETE FROM addresses',
  'DELETE FROM device_identities', 'DELETE FROM device_events', 'DELETE FROM devices',
  'DELETE FROM sessions', "DELETE FROM users WHERE phone <> '09120000000'",
  "DELETE FROM couriers WHERE phone = '09120000099'"
)
foreach ($s in $sqls) { Pg $s | Out-Null }
podman compose -f compose.dev.yml exec redis redis-cli FLUSHALL | Out-Null
Write-Host 'cleanup done' -ForegroundColor Cyan

# ============ setup ============
 $admin = LoginPhone '09120000000' (DevObj 'p7-admin')
 $H = @{ authorization = "Bearer $($admin.accessToken)" }

 $buyer = LoginPhone '09120000050' (DevObj 'p7-buyer')
 $HB = @{ authorization = "Bearer $($buyer.accessToken)" }

 $fast = Invoke-RestMethod "$base/api/menu/mains/fastfood/products"
 $burger = @($fast.products | Where-Object { $_.name -like '*برگر*' })[0]

# سفارش سالم اول — پایه‌ی مغایرت‌سازی
 $co = Send-Json Post "$base/api/orders/checkout" @{
  items = @(@{ productId = $burger.id; quantity = 1 }); deliveryType = 'DINE_IN'
  useWallet = $false; gatewayId = 'MOCK'
} $HB
 $null = Send-Json Post ($base + $co.paymentUrl) @{ success = $true } $null
P 'setup healthy order' ((OK $co) -and $null -ne $co.orderId) ''

# ============ T1: اجرای تمیز — صفر finding ============
 $run1 = Send-Json Post "$base/api/admin/reconcile/run" @{} $H
P 'T1 clean run totalOpen=0' ((OK $run1) -and $run1.totalOpen -eq 0) "total=$($run1.totalOpen)"

# ============ ساخت مغایرت‌های عمدی ============

# M1: R2 — order.paymentStatus=SUCCESS اما payment موفق ندارد
 $null = Pg "UPDATE orders SET payment_status = 'SUCCESS' WHERE display_id = '$($co.orderId)'"
 $null = Pg "UPDATE payments SET status = 'FAILED' WHERE order_id = (SELECT id FROM orders WHERE display_id = '$($co.orderId)')"

# M2: R3 — با INSERT جعلیِ تراکنشِ اضافه (عدد ناهمسان با breakdown)
# سفارش settle-شده walletDeduction=0 دارد؛ یک WITHDRAW جعلی 50000 به آن بچسبان → mismatch قطعی
 $m2ins = 'INSERT INTO wallet_transactions (user_id, type, amount, description, order_id) SELECT user_id, ''WITHDRAW'', 50000, ''reconcile-test-fake'', id FROM orders WHERE display_id = ''' + $co.orderId + ''''
 $m2ins | podman compose -f compose.dev.yml exec -T postgres psql -U sinshin -d sinshin

# M3: R10 — سفارش stuck در PENDING_PAYMENT بیش از ۳۰ دقیقه
 $stuck = Send-Json Post "$base/api/orders/checkout" @{
  items = @(@{ productId = $burger.id; quantity = 1 }); deliveryType = 'DINE_IN'
  useWallet = $false; gatewayId = 'MOCK'
} $HB
 $null = Pg "UPDATE orders SET created_at = now() - interval '2 hours' WHERE display_id = '$($stuck.orderId)'"

# ============ T2: اجرا با مغایرت‌ها ============
 $run2 = Send-Json Post "$base/api/admin/reconcile/run" @{} $H
P 'T2 run detects findings' ((OK $run2) -and $run2.totalOpen -ge 3) "total=$($run2.totalOpen)"

 $byCheck = @{}
foreach ($c in $run2.checks) { $byCheck[$c.checkId] = $c.findings }
P 'T2 R2 detected' ($byCheck['R2'] -ge 1) "c=$($byCheck['R2'])"
P 'T2 R3 detected' ($byCheck['R3'] -ge 1) "c=$($byCheck['R3'])"
P 'T2 R10 detected' ($byCheck['R10'] -ge 1) "c=$($byCheck['R10'])"

# ============ T3: dry-run — R1 wouldFix اما settle نمی‌زند ============
# سناریو: سفارش سالم + payment موفق + order دستی PENDING (شبیه crash وسط tx)

# سفارش سالم دوم
 $co2 = Send-Json Post "$base/api/orders/checkout" @{
  items = @(@{ productId = $burger.id; quantity = 1 }); deliveryType = 'DINE_IN'
  useWallet = $false; gatewayId = 'MOCK'
} $HB

# mock-pay موفق — پاسخ را نگه دار تا مطمئن شویم رخ داده
 $pay2 = Send-Json Post ($base + $co2.paymentUrl) @{ success = $true } $null
Write-Host "T3 pay2 status: $($pay2.paymentStatus)" -ForegroundColor Yellow

# order را PENDING برگردان (stdin-pipe — کوتیشن‌ها سالم)
 $upSql = @"
UPDATE orders SET status = 'PENDING_PAYMENT' WHERE display_id = '$($co2.orderId)';
"@
 $upSql | podman compose -f compose.dev.yml exec -T postgres psql -U sinshin -d sinshin

# دیاگنوستیک — وضعیت واقعی برای R1 (stdin-pipe)
 $dg = 'SELECT p.status || '' | '' || o.status || '' | '' || p.amount::text || '' | '' || (o.breakdown->>''amountPaidOnline'') FROM payments p JOIN orders o ON o.id = p.order_id WHERE display_id = ''' + $co2.orderId + ''''
 $diagOut = $dg | podman compose -f compose.dev.yml exec -T postgres psql -U sinshin -d sinshin -t
Write-Host "T3 diag: $diagOut" -ForegroundColor Yellow

# اجرای reconcile — R1 باید wouldFix=1 بدهد
 $run3 = Send-Json Post "$base/api/admin/reconcile/run" @{} $H
 $r1check = @($run3.checks | Where-Object { $_.checkId -eq 'R1' })[0]
P 'T3 R1 wouldFix=1' ($r1check.wouldFix -eq 1) "wf=$($r1check.wouldFix)"

# auto-fix خاموش → سفارش هنوز PENDING
 $statusSql = @"
SELECT status FROM orders WHERE display_id = '$($co2.orderId)';
"@
 $statusOut = $statusSql | podman compose -f compose.dev.yml exec -T postgres psql -U sinshin -d sinshin -t
P 'T3 auto-fix off still PENDING' ("$statusOut".Trim() -eq 'PENDING_PAYMENT') "s=$statusOut"

# ============ T4: findings API + acknowledge ============
 $findings = Invoke-RestMethod "$base/api/admin/reconcile/findings?status=open" -Headers $H
P 'T4 findings listed' (@($findings).Count -ge 4) "n=$(@($findings).Count)"

 $firstFinding = @($findings)[0]
 $null = Send-Json Post "$base/api/admin/reconcile/findings/$($firstFinding.id)/acknowledge" @{} $H
 $after = Invoke-RestMethod "$base/api/admin/reconcile/findings?status=acknowledged" -Headers $H
P 'T4 acknowledge works' (@($after).Count -eq 1) "n=$(@($after).Count)"

# ============ T5: summary ============
 $sum = Invoke-RestMethod "$base/api/admin/reconcile/summary" -Headers $H
P 'T5 summary open>=3' ($sum.open -ge 3) "open=$($sum.open)"

if ($script:failed) { Write-Host '=== SOME TESTS FAILED ===' -ForegroundColor Red }
else { Write-Host '=== ALL PASS ===' -ForegroundColor Green }
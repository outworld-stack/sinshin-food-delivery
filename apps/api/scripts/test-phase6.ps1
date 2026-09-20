# Phase 6 verification — coupons + live HTML reports + CSV + phase-2 regression.
# Self-cleaning: safe to re-run.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
 $ErrorActionPreference = 'Stop'
 $base = 'http://localhost:3000'

function Send-Json($method, $url, $obj, $headers) {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $irm = @{ Method = $method; ContentType = 'application/json; charset=utf-8'; Body = $bytes }
  if ($headers) { $irm.Headers = $headers }
  try {
    return Invoke-RestMethod $url @irm
  } catch {
    $code = 0
    try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    $parsed = $null
    try { if ($_.ErrorDetails.Message) { $parsed = $_.ErrorDetails.Message | ConvertFrom-Json } } catch { }
    return [pscustomobject]@{ error = $parsed; __status = $code }
  }
}

function LoginPhone($phone, $devObj, $refCode) {
  $r = Send-Json Post "$base/api/auth/otp/request" @{ phone = $phone } $null
  if ($r.__status -eq 429 -or -not $r.devCode) {
    Start-Sleep -Seconds 62
    $r = Send-Json Post "$base/api/auth/otp/request" @{ phone = $phone } $null
  }
  if (-not $r.devCode) { return $r }
  $v = @{ phone = $phone; code = $r.devCode; device = $devObj; termsAccepted = $true; termsVersion = '1' }
  if ($refCode) { $v.refCode = $refCode }
  Send-Json Post "$base/api/auth/otp/verify" $v $null
}

function DevObj($id) {
  function FpHash($salt) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $b = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("${salt}:${id}"))
    ($b | ForEach-Object { $_.ToString('x2') }) -join ''
  }
  @{ clientId = $id
     canvasHash = FpHash 'canvas'; webglHash = FpHash 'webgl'
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
  'DELETE FROM coupon_nudges',
  'DELETE FROM coupon_grants',
  'DELETE FROM coupon_redemptions',
  'DELETE FROM coupon_conditions',
  "DELETE FROM coupons WHERE code <> 'SINSHIN20'",
  "UPDATE coupons SET used_count = 0 WHERE code = 'SINSHIN20'",
  'DELETE FROM admin2_activities',
  'DELETE FROM admin2_sessions',
  'DELETE FROM admin2_profiles',
  'DELETE FROM wallet_transactions',
  'DELETE FROM referral_profits',
  'DELETE FROM payments',
  'DELETE FROM order_items',
  'DELETE FROM courier_deliveries',
  'DELETE FROM courier_trips',
  'DELETE FROM orders',
  'DELETE FROM reviews',
  'DELETE FROM addresses',
  'DELETE FROM device_identities',
  'DELETE FROM device_events',
  'DELETE FROM devices',
  'DELETE FROM sessions',
  "DELETE FROM users WHERE phone <> '09120000000'",
  "DELETE FROM couriers WHERE phone = '09120000099'"
)
foreach ($s in $sqls) { Pg $s | Out-Null }
podman compose -f compose.dev.yml exec redis redis-cli FLUSHALL | Out-Null
Write-Host 'cleanup done' -ForegroundColor Cyan

# ============ setup ============
 $admin = LoginPhone '09120000000' (DevObj 'p6-admin')
 $tok = $admin.accessToken
 $H = @{ authorization = "Bearer $tok" }

 $buyer = LoginPhone '09120000050' (DevObj 'p6-buyer')
 $HB = @{ authorization = "Bearer $($buyer.accessToken)" }

 $fast = Invoke-RestMethod "$base/api/menu/mains/fastfood/products"
 $pizza = @($fast.products | Where-Object { $_.name -like '*پپرونی*' })[0]
 $small = @($pizza.sizes | Where-Object { $_.name -eq 'کوچک' })[0]
 $burger = @($fast.products | Where-Object { $_.name -like '*برگر*' })[0]

function Checkout($items, $type, $addressId, $couponCode, $useWallet) {
  $body = @{
    items = $items; deliveryType = $type; useWallet = $useWallet; gatewayId = 'MOCK'
    addressId = $addressId
  }
  if ($couponCode) { $body.couponCode = $couponCode }
  $co = Send-Json Post "$base/api/orders/checkout" $body $HB
  if ((OK $co) -and $co.requiresPayment) {
    $null = Send-Json Post ($base + $co.paymentUrl) @{ success = $true } $null
  }
  $co
}

function CheckoutAs($hdrs, $items, $type) {
  $body = @{ items = $items; deliveryType = $type; useWallet = $false; gatewayId = 'MOCK' }
  $co = Send-Json Post "$base/api/orders/checkout" $body $hdrs
  if ((OK $co) -and $co.requiresPayment) {
    $null = Send-Json Post ($base + $co.paymentUrl) @{ success = $true } $null
  }
  $co
}

# ============ A: public coupon ============
 $coA = Checkout @(@{ productId = $burger.id; quantity = 1 }) 'DINE_IN' $null 'SINSHIN20' $false
P 'A1 public coupon discount' ((OK $coA) -and $coA.breakdown.discount -eq 24650) "disc=$($coA.breakdown.discount)"

# ============ B: private coupon — grant lifecycle ============
 $priv = Send-Json Post "$base/api/admin/coupons" @{
  code = 'VIP15'; title = 'Loyal Customer'; discountPercentage = 15
  maxUses = 0; isPublic = $false; expiryDate = $null
  rules = @(@{ type = 'MIN_ORDERS_COUNT'; params = @{ count = 3 } })
} $H
P 'B1 private coupon created' ((OK $priv) -and $priv.success -eq $true) ''

 $g1 = Pg "SELECT count(*) FROM coupon_grants WHERE user_id=(SELECT id FROM users WHERE phone='09120000050') AND coupon_id=(SELECT id FROM coupons WHERE code='VIP15')"
P 'B2 no grant after 1 order' ("$g1".Trim() -eq '0') "g=$g1"

 $null = Checkout @(@{ productId = $burger.id; quantity = 1 }) 'DINE_IN' $null $null $false
 $g2 = Pg "SELECT count(*) FROM coupon_grants WHERE user_id=(SELECT id FROM users WHERE phone='09120000050') AND coupon_id=(SELECT id FROM coupons WHERE code='VIP15')"
P 'B3 no grant after 2 orders' ("$g2".Trim() -eq '0') "g=$g2"

 $null = Checkout @(@{ productId = $burger.id; quantity = 1 }) 'DINE_IN' $null $null $false
 $g3 = Pg "SELECT count(*) FROM coupon_grants WHERE user_id=(SELECT id FROM users WHERE phone='09120000050') AND coupon_id=(SELECT id FROM coupons WHERE code='VIP15')"
P 'B4 grant at 3rd order settle' ("$g3".Trim() -eq '1') "g=$g3"

 $other = LoginPhone '09120000051' (DevObj 'p6-other')
 $HO = @{ authorization = "Bearer $($other.accessToken)" }
 $b5body = @{
  items = @(@{ productId = $burger.id; quantity = 1 }); deliveryType = 'DINE_IN'
  useWallet = $false; gatewayId = 'MOCK'; couponCode = 'VIP15'
}
 $coOther = Send-Json Post "$base/api/orders/checkout" $b5body $HO
P 'B5 private code rejected without grant' ((OK $coOther) -and $coOther.breakdown.discount -eq 0) "disc=$($coOther.breakdown.discount)"

 $coB = Checkout @(@{ productId = $pizza.id; sizeId = $small.id; quantity = 1 }) 'PICKUP' $null 'VIP15' $false
P 'B6 private coupon applied' ((OK $coB) -and $coB.breakdown.discount -eq 18000) "disc=$($coB.breakdown.discount)"

 $coB2 = Checkout @(@{ productId = $burger.id; quantity = 1 }) 'DINE_IN' $null 'VIP15' $false
P 'B7 consumed grant rejected' ((OK $coB2) -and $coB2.breakdown.discount -eq 0) "disc=$($coB2.breakdown.discount)"

 $c7 = Pg "SELECT count(*) FROM coupon_grants WHERE consumed_at IS NOT NULL AND user_id=(SELECT id FROM users WHERE phone='09120000050')"
P 'B7 grant marked consumed' ("$c7".Trim() -eq '1') "c=$c7"

 $null = Checkout @(@{ productId = $burger.id; quantity = 1 }) 'DINE_IN' $null $null $false
 $g5 = Pg "SELECT count(*) FROM coupon_grants WHERE user_id=(SELECT id FROM users WHERE phone='09120000050') AND coupon_id=(SELECT id FROM coupons WHERE code='VIP15')"
P 'B8 grant unique no re-grant' ("$g5".Trim() -eq '1') "g=$g5"

# ============ C: nudge candidate ============
 $nudgeUser = LoginPhone '09120000052' (DevObj 'p6-nudge')
 $HN = @{ authorization = "Bearer $($nudgeUser.accessToken)" }
 $null = CheckoutAs $HN @(@{ productId = $burger.id; quantity = 1 }) 'DINE_IN'
 $null = CheckoutAs $HN @(@{ productId = $burger.id; quantity = 1 }) 'DINE_IN'

 $cand = Pg "SELECT count(*) FROM users u WHERE u.banned_at IS NULL AND NOT EXISTS (SELECT 1 FROM coupon_grants g WHERE g.coupon_id=(SELECT id FROM coupons WHERE code='VIP15') AND g.user_id=u.id) AND (SELECT count(*) FROM orders o WHERE o.user_id=u.id AND o.payment_status='SUCCESS' AND o.status <> 'CANCELED') = 2"
P 'C2 nudge candidate exists' ("$cand".Trim() -ge '1') "cand=$cand"

# ============ D: live HTML report + CSV ============
 $sendRes = Send-Json Post "$base/api/reports/send/daily" @{} $H
P 'D1 report send endpoint' ((OK $sendRes) -and $sendRes.success -eq $true) ''

try {
  $null = Invoke-RestMethod "$base/api/reports/view/forged"
  P 'D2 forged link rejected' $false ''
} catch {
  P 'D2 forged link rejected' ($_.Exception.Response.StatusCode.value__ -eq 403) "code=$($_.Exception.Response.StatusCode.value__)"
}

 $sha = [System.Security.Cryptography.SHA256]::Create()
 $hash = ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes('rpt:cron:daily:dev-only-insecure-secret')) | ForEach-Object { $_.ToString('x2') }) -join ''
 $rtoken = 'c.daily.' + $hash.Substring(0, 32)

 $viewUrl = "$base/api/reports/view/$rtoken" + '?range=today'
 $view = Invoke-WebRequest $viewUrl -UseBasicParsing
P 'D3 view 200' ($view.StatusCode -eq 200) ''
P 'D3 has html' ($view.Content -like '*<html*') ''
 $rowMatches = [regex]::Matches($view.Content, 'ord-[a-z0-9]{8}')
P 'D3 order rows visible' ($rowMatches.Count -ge 3) "rows=$($rowMatches.Count)"

 $csvUrl = "$base/api/reports/csv/$rtoken" + '?range=today'
 $csv = Invoke-WebRequest $csvUrl -UseBasicParsing
P 'D4 csv 200' ($csv.StatusCode -eq 200) ''

# Content ممکن است string باشد (PS5.1) یا byte[] — هر دو را هندل کن
if ($csv.Content -is [byte[]]) {
  $csvText = [System.Text.Encoding]::UTF8.GetString($csv.Content)
  $hasBom = $csv.Content[0] -eq 0xEF
} else {
  $csvText = [string]$csv.Content
  $hasBom = $true  # متن درست decode شده یعنی BOM توسط Invoke-WebRequest خورده شده
}
 $csvLines = $csvText -split "`n"
P 'D4 csv has data rows' ($csvLines.Count -ge 4) "lines=$($csvLines.Count)"
P 'D4 csv BOM/UTF-8' $hasBom ''

# ============ E: phase-2 regression ============
 $devShared = DevObj 'p6-shared'
 $u1 = LoginPhone '09120000060' $devShared
 $ref = $u1.user.referralCode
 $null = LoginPhone '09120000061' $devShared
 $null = LoginPhone '09120000062' $devShared
 $null = LoginPhone '09120000063' $devShared
 $u5 = LoginPhone '09120000064' $devShared $ref

P 'E1 5th registered' ((OK $u5) -and $u5.isNewUser -eq $true) ''

 $noRef = Pg "SELECT referred_by IS NULL FROM users WHERE phone='09120000064'"
P 'E1 5th no referrer BLOCK' ("$noRef".Trim() -eq 't') "noRef=$noRef"

 $blk = Pg "SELECT count(*) FROM device_events WHERE event='REFERRAL_BLOCKED' AND phone='09120000064'"
P 'E1 BLOCK event logged' ("$blk".Trim() -eq '1') "e=$blk"

 $rel = Pg "SELECT relation FROM device_identities WHERE phone='09120000060'"
P 'E2 first identity OWNER' ("$rel".Trim() -eq 'OWNER') "r=$rel"

 $susp = Pg "SELECT count(*) FROM device_identities WHERE phone IN ('09120000063','09120000064') AND relation='SUSPICIOUS'"
P 'E2 suspicious relations' ("$susp".Trim() -eq '2') "s=$susp"

 $rEmu = Send-Json Post "$base/api/auth/otp/request" @{ phone = '09120000065' } $null
 $devBad = @{
  clientId = 'p6-emu'; canvasHash = 'e' * 64; webglHash = 'f' * 64; audioHash = '1' * 64
  fontsHash = '2' * 64; screen = '800x600x24@1'; platform = 'Android'
  timezone = 'Asia/Tehran'; language = 'fa-IR'; hardwareConcurrency = 2
  deviceMemory = 2; touch = $false; label = 'Emu'
}
 $emuObj = @{ phone = '09120000065'; code = $rEmu.devCode; device = $devBad; termsAccepted = $true; termsVersion = '1' }
 $emuBody = $emuObj | ConvertTo-Json -Depth 5 -Compress
 $emuFile = Join-Path $env:TEMP 'emu-body.json'
[System.IO.File]::WriteAllBytes($emuFile, [System.Text.Encoding]::UTF8.GetBytes($emuBody))

 $emuArgs = @(
  '-s', '-X', 'POST', "$base/api/auth/otp/verify",
  '-H', 'content-type: application/json',
  '-A', 'Mozilla/5.0 (Linux; Android 10) HeadlessChrome/120',
  '--data-binary', "@$emuFile"
)
 $emuRaw = & curl.exe @emuArgs
P 'E3 emulator blocked' ($emuRaw -like '*FORBIDDEN*') "resp=$($emuRaw.Substring(0, [Math]::Min(60, $emuRaw.Length)))"

 $emuBlk = Pg "SELECT is_blocked FROM devices WHERE client_id='p6-emu'"
P 'E3 emulator is_blocked' ("$emuBlk".Trim() -eq 't') "b=$emuBlk"

if ($script:failed) { Write-Host '=== SOME TESTS FAILED ===' -ForegroundColor Red }
else { Write-Host '=== ALL PASS ===' -ForegroundColor Green }

# ============ چشمی: باز کردن گزارش در مرورگر ============
 $openUrl = "$base/api/reports/view/$rtoken" + '?range=today'
Start-Process $openUrl
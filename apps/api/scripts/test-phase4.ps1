# Phase 4 verification v3 — self-cleaning: safe to re-run any number of times.
# Save as UTF-8 with BOM. Usage: powershell -File scripts\test-phase4.ps1

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
 $ErrorActionPreference = 'Stop'
 $base = 'http://localhost:3000'

function Send-Json($method, $url, $obj, $headers) {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $irm = @{ Method = $method; ContentType = 'application/json; charset=utf-8'; Body = $bytes }
  if ($headers) { $irm.Headers = $headers }
  Invoke-RestMethod $url @irm
}

function LoginPhone($phone, $devObj, $refCode) {
  $r = Send-Json Post "$base/api/auth/otp/request" @{ phone = $phone } $null
  $v = @{ phone = $phone; code = $r.devCode; device = $devObj; termsAccepted = $true; termsVersion = '1' }
  if ($refCode) { $v.refCode = $refCode }
  Send-Json Post "$base/api/auth/otp/verify" $v $null
}

function DevObj($id) {
  @{ clientId = $id; canvasHash = 'a' * 64; webglHash = 'b' * 64; audioHash = 'c' * 64
     fontsHash = 'd' * 64; screen = '1920x1080x24@1'; platform = 'Windows'
     timezone = 'Asia/Tehran'; language = 'fa-IR'; hardwareConcurrency = 8
     deviceMemory = 8; touch = $false; label = $id }
}

function P($name, $ok, $extra) {
  if ($ok) { Write-Host "PASS: $name $extra" -ForegroundColor Green }
  else { Write-Host "FAIL: $name $extra" -ForegroundColor Red; $script:failed = $true }
}
 $script:failed = $false

# ══ self-clean: آثار اجراهای قبلی — اسکریپت را idempotent می‌کند ══
Write-Host '== cleanup previous run ==' -ForegroundColor Cyan
  function Pg($sql) {
    (podman compose -f compose.dev.yml exec postgres psql -U sinshin -d sinshin -t -c $sql) -join ''
  }
 $sqls = @(
  "DELETE FROM wallet_transactions WHERE user_id IN (SELECT id FROM users WHERE phone IN ('09120000010','09120000011'))",
  "DELETE FROM referral_profits WHERE referrer_id IN (SELECT id FROM users WHERE phone IN ('09120000010','09120000011')) OR buyer_id IN (SELECT id FROM users WHERE phone IN ('09120000010','09120000011'))",
  "DELETE FROM payments WHERE user_id IN (SELECT id FROM users WHERE phone IN ('09120000010','09120000011'))",
  "DELETE FROM coupon_redemptions WHERE user_id IN (SELECT id FROM users WHERE phone IN ('09120000010','09120000011'))",
  "DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE phone IN ('09120000010','09120000011')))",
  "DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE phone IN ('09120000010','09120000011'))",
  "DELETE FROM addresses WHERE user_id IN (SELECT id FROM users WHERE phone IN ('09120000010','09120000011'))",
  "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE phone IN ('09120000010','09120000011'))",
  "DELETE FROM device_identities WHERE phone IN ('09120000010','09120000011')",
  "DELETE FROM device_events WHERE phone IN ('09120000010','09120000011')",
  "DELETE FROM users WHERE phone IN ('09120000010','09120000011')",
  "DELETE FROM coupon_redemptions WHERE coupon_id = (SELECT id FROM coupons WHERE code = 'SINSHIN20')",
  "UPDATE coupons SET used_count = 0 WHERE code = 'SINSHIN20'"
)
foreach ($s in $sqls) { Pg $s | Out-Null }
podman compose -f compose.dev.yml exec redis redis-cli FLUSHALL | Out-Null
Write-Host 'cleanup done' -ForegroundColor Cyan

# ══ setup ══
 $admin = LoginPhone '09120000000' (DevObj 'p4-admin')
 $tok = $admin.accessToken
 $H = @{ authorization = "Bearer $tok" }

 $a = LoginPhone '09120000010' (DevObj 'p4-a')
 $HA = @{ authorization = "Bearer $($a.accessToken)" }
 $b = LoginPhone '09120000011' (DevObj 'p4-b') $a.user.referralCode
 $HB = @{ authorization = "Bearer $($b.accessToken)" }
P 'buyer referred' ($null -ne $b.user.referralCode) ''

 $addr = Send-Json Post "$base/api/addresses" @{ title = 'home'; address = 'Tehran'; lat = 35.7; lng = 51.4 } $HB

 $fast = Invoke-RestMethod "$base/api/menu/mains/fastfood/products"
 $pizza = @($fast.products | Where-Object { $_.name -like '*پپرونی*' })[0]
 $small = @($pizza.sizes | Where-Object { $_.name -eq 'کوچک' })[0]
 $burger = @($fast.products | Where-Object { $_.name -like '*برگر*' })[0]
 $coke = @($fast.products | Where-Object { $_.name -like '*کوکا*' })[0]

# ── TEST 1: checkout DELIVERY + mock SUCCESS + referral profit ──
 $co = Send-Json Post "$base/api/orders/checkout" @{
  items = @(
    @{ productId = $pizza.id; sizeId = $small.id; quantity = 2 },
    @{ productId = $burger.id; quantity = 1 }
  )
  deliveryType = 'DELIVERY'; useWallet = $false
  addressId = $addr.id; gatewayId = 'MOCK'
} $HB

 $food = 2 * 120000 + 123250
 $fee = 35000
 $online = $food + $fee
 $expectedProfit = [math]::Round($food * 10 / 100)

P 'T1 delivery fee (zone)' ($co.breakdown.deliveryFee -eq $fee) "fee=$($co.breakdown.deliveryFee)"
P 'T1 online amount' ($co.breakdown.amountPaidOnline -eq $online) "online=$($co.breakdown.amountPaidOnline)"
P 'T1 requires payment' ($co.requiresPayment -eq $true) ''

 $pay = Send-Json Post ($base + $co.paymentUrl) @{ success = $true } $null
P 'T1 mock pay success' ($pay.paymentStatus -eq 'SUCCESS') ''

 $order = Invoke-RestMethod "$base/api/orders/$($co.orderId)" -Headers $HB
P 'T1 order PAID' ($order.status -eq 'PAID') ''
P 'T1 not queued (open)' ($order.queued -eq $false) ''
P 'T1 buyer sees referralProfit' ($order.referralProfit -eq $expectedProfit) "profit=$($order.referralProfit)"

 $profA = Invoke-RestMethod "$base/api/orders/profile" -Headers $HA
P 'T1 referrer wallet credited' ($profA.walletBalance -eq $expectedProfit) "bal=$($profA.walletBalance) expect=$expectedProfit"
P 'T1 referrer totalProfit' ($profA.totalReferralProfit -eq $expectedProfit) ''
P 'T1 myReferrals count' (@($profA.myReferrals).Count -eq 1) ''

# ── TEST 2: mock FAILED ──
 $co2 = Send-Json Post "$base/api/orders/checkout" @{
  items = @(@{ productId = $burger.id; quantity = 1 })
  deliveryType = 'DINE_IN'; useWallet = $false; gatewayId = 'MOCK'
} $HB
 $pay2 = Send-Json Post ($base + $co2.paymentUrl) @{ success = $false } $null
P 'T2 failed payment recorded' ($pay2.paymentStatus -eq 'FAILED') ''
 $o2 = Invoke-RestMethod "$base/api/orders/$($co2.orderId)" -Headers $HB
P 'T2 order CANCELED' ($o2.status -eq 'CANCELED') ''
P 'T2 paymentStatus FAILED' ($o2.paymentStatus -eq 'FAILED') ''

# ── TEST 2b: FAILED با کوپن → رزرو آزاد شود ──
 $co2b = Send-Json Post "$base/api/orders/checkout" @{
  items = @(@{ productId = $burger.id; quantity = 1 })
  deliveryType = 'DINE_IN'; useWallet = $false
  couponCode = 'SINSHIN20'; gatewayId = 'MOCK'
} $HB
 $null = Send-Json Post ($base + $co2b.paymentUrl) @{ success = $false } $null

# ── TEST 3: کوپن + کیف پول → پوشش کامل (settle فوری) ──
 $coA = Send-Json Post "$base/api/orders/checkout" @{
  items = @(@{ productId = $coke.id; quantity = 1 })
  deliveryType = 'DINE_IN'; useWallet = $true
  couponCode = 'SINSHIN20'; gatewayId = 'MOCK'
} $HA
P 'T3 full cover (wallet-only)' ($coA.orderCompleted -eq $true) "online=$($coA.breakdown.amountPaidOnline)"
P 'T3 coupon discount' ($coA.breakdown.discount -eq 5000) "discount=$($coA.breakdown.discount)"

 $profA2 = Invoke-RestMethod "$base/api/orders/profile" -Headers $HA
P 'T3 wallet deducted' ($profA2.walletBalance -eq ($expectedProfit - 20000)) "bal=$($profA2.walletBalance)"

# ── TEST 4: صف رستوران بسته ──
Send-Json Post "$base/api/admin/settings/restaurant" @{ isOpen = $false; nextOpenTime = '۱۱:۰۰ صبح' } $H | Out-Null
 $co3 = Send-Json Post "$base/api/orders/checkout" @{
  items = @(@{ productId = $burger.id; quantity = 1 })
  deliveryType = 'DINE_IN'; useWallet = $false; gatewayId = 'MOCK'
} $HB
 $null = Send-Json Post ($base + $co3.paymentUrl) @{ success = $true } $null
 $o3 = Invoke-RestMethod "$base/api/orders/$($co3.orderId)" -Headers $HB
P 'T4 closed restaurant queues order' ($o3.queued -eq $true) ''
Send-Json Post "$base/api/admin/settings/restaurant" @{ isOpen = $true } $H | Out-Null

# ── TEST 5: ردیابی snapshot ──
 $tr0 = Invoke-RestMethod "$base/api/orders/$($co.orderId)/tracking" -Headers $HB
P 'T5 old order tracking off' ($tr0.isEnabled -eq $false) ''
Send-Json Post "$base/api/admin/settings/live-tracking" @{ enabled = $true } $H | Out-Null
 $co4 = Send-Json Post "$base/api/orders/checkout" @{
  items = @(@{ productId = $burger.id; quantity = 1 })
  deliveryType = 'DINE_IN'; useWallet = $false; gatewayId = 'MOCK'
} $HB
 $null = Send-Json Post ($base + $co4.paymentUrl) @{ success = $true } $null
 $tr4 = Invoke-RestMethod "$base/api/orders/$($co4.orderId)/tracking" -Headers $HB
P 'T5 new order tracking on' ($tr4.isEnabled -eq $true) ''
 $tr0b = Invoke-RestMethod "$base/api/orders/$($co.orderId)/tracking" -Headers $HB
P 'T5 old order STILL off' ($tr0b.isEnabled -eq $false) ''
Send-Json Post "$base/api/admin/settings/live-tracking" @{ enabled = $false } $H | Out-Null

# ── TEST 6: تایید تحویل ──
Send-Json Post "$base/api/orders/$($co.orderId)/deliver" @{} $HB | Out-Null
 $o1b = Invoke-RestMethod "$base/api/orders/$($co.orderId)" -Headers $HB
P 'T6 delivery confirmed' ($o1b.status -eq 'DELIVERED') ''

# ── TEST 7: آپلود + سرو ──
 $png = [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) + (New-Object byte[] 100)
 $tmp = "$env:TEMP\sinshin-test.png"
[System.IO.File]::WriteAllBytes($tmp, $png)

 $raw = & curl.exe -s -w "`n%{http_code}" -X POST "$base/api/uploads" -H "Authorization: Bearer $tok" -F "file=@$tmp;type=image/png"
 $lines = @($raw | Where-Object { $_ -ne '' })
 $httpCode = $lines[-1]
 $bodyLine = ($lines | Select-Object -First ($lines.Count - 1)) -join ''
if ($httpCode -ne '200') { Write-Host "T7 error body: $bodyLine" -ForegroundColor Yellow }
P 'T7 upload http 200' ($httpCode -eq '200') "code=$httpCode"
 $up = $null
try { $up = $bodyLine | ConvertFrom-Json } catch { }
P 'T7 upload ok' ($null -ne $up -and $null -ne $up.url -and $up.url -like '/uploads/*') "url=$($up.url)"

if ($up -and $up.url) {
  $img = Invoke-WebRequest ($base + $up.url) -UseBasicParsing
  P 'T7 file served (real url)' ($img.StatusCode -eq 200 -and $img.RawContentLength -eq 108) "len=$($img.RawContentLength)"
} else {
  P 'T7 file served (real url)' $false 'no url'
}
Remove-Item $tmp -ErrorAction SilentlyContinue

# ── TEST 8: state جعلی ──
try {
  $null = Send-Json Post "$base/api/payments/mock/00000000-0000-0000-0000-000000000000.deadbeef" @{ success = $true } $null
  P 'T8 forged state rejected' $false ''
} catch {
  P 'T8 forged state rejected' ($_.Exception.Response.StatusCode.value__ -eq 403) ''
}

# ── TEST 9: صحت نهایی دیتابیس (انتظارهای absolute — بعد از self-clean) ──
 $couponUsed = Pg "SELECT used_count FROM coupons WHERE code='SINSHIN20'"
P 'T9 coupon usedCount=1' ("$couponUsed".Trim() -eq '1') "used=$couponUsed"

 $deposits = Pg "SELECT count(*) FROM wallet_transactions WHERE user_id=(SELECT id FROM users WHERE phone='09120000010') AND type='DEPOSIT'"
 $withdraws = Pg "SELECT count(*) FROM wallet_transactions WHERE user_id=(SELECT id FROM users WHERE phone='09120000010') AND type='WITHDRAW'"
P 'T9 referrer deposits=3' ("$deposits".Trim() -eq '3') "dep=$deposits"
P 'T9 referrer withdraws=1' ("$withdraws".Trim() -eq '1') "wd=$withdraws"

 $finalBal = Pg "SELECT coalesce(sum(case when type='DEPOSIT' then amount else -amount end),0) FROM wallet_transactions WHERE user_id=(SELECT id FROM users WHERE phone='09120000010')"
P 'T9 ledger balance=40975' ("$finalBal".Trim() -eq '40975') "bal=$finalBal"

if ($script:failed) { Write-Host '=== SOME TESTS FAILED ===' -ForegroundColor Red }
else { Write-Host '=== ALL PASS ===' -ForegroundColor Green }
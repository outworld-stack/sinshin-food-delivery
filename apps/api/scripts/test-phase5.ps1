# Phase 5 verification — multi-admin2 / scopes / queue / confirm / courier-security / location / review / activity / temp-close.
# Self-cleaning: safe to re-run. Save as UTF-8 with BOM.

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
    # cooldown فعال — صبر و یک‌بار تلاش مجدد
    Start-Sleep -Seconds 62
    $r = Send-Json Post "$base/api/auth/otp/request" @{ phone = $phone } $null
  }
  if (-not $r.devCode) { return $r }  # خطا را برگردان تا تست قضاوت کند
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

function OK($r) { $null -eq $r.__status }

function P($name, $ok, $extra) {
  if ($ok) { Write-Host "PASS: $name $extra" -ForegroundColor Green }
  else { Write-Host "FAIL: $name $extra" -ForegroundColor Red; $script:failed = $true }
}
 $script:failed = $false

function Pg($sql) {
  (podman compose -f compose.dev.yml exec postgres psql -U sinshin -d sinshin -t -c $sql) -join ''
}

# ══ self-clean ══
Write-Host '== cleanup ==' -ForegroundColor Cyan
 $sqls = @(
  "DELETE FROM admin2_activities",
  "DELETE FROM admin2_sessions",
  "DELETE FROM admin2_profiles",
  "DELETE FROM wallet_transactions",
  "DELETE FROM referral_profits",
  "DELETE FROM payments",
  "DELETE FROM coupon_redemptions",
  "DELETE FROM order_items",
  "DELETE FROM courier_deliveries",
  "DELETE FROM courier_trips",
  "DELETE FROM orders",
  "DELETE FROM reviews",
  "DELETE FROM addresses",
  "DELETE FROM device_identities WHERE phone NOT IN (SELECT phone FROM users)",
  "DELETE FROM device_events",
  "DELETE FROM sessions",
  "DELETE FROM users WHERE phone <> '09120000000' OR role = 'admin2' OR role = 'user' AND phone <> '09120000000'",
  "DELETE FROM users WHERE phone <> '09120000000'",
  "DELETE FROM couriers WHERE phone = '09120000099'",
  "UPDATE settings SET value = 'true' WHERE key = 'restaurant_open'",
  "UPDATE settings SET value = 'false' WHERE key = 'temporarily_closed'"
)
foreach ($s in $sqls) { Pg $s | Out-Null }
podman compose -f compose.dev.yml exec redis redis-cli FLUSHALL | Out-Null
Write-Host 'cleanup done' -ForegroundColor Cyan

# ══ setup: ادمین اصلی + مشتری + منو ══
 $admin = LoginPhone '09120000000' (DevObj 'p5-admin')
 $tok = $admin.accessToken
 $H = @{ authorization = "Bearer $tok" }

 $buyer = LoginPhone '09120000050' (DevObj 'p5-buyer')
 $HB = @{ authorization = "Bearer $($buyer.accessToken)" }

 $addr = Send-Json Post "$base/api/addresses" @{ title = 'home'; address = 'Tehran'; lat = 35.7; lng = 51.4 } $HB

 $fast = Invoke-RestMethod "$base/api/menu/mains/fastfood/products"
 $pizza = @($fast.products | Where-Object { $_.name -like '*پپرونی*' })[0]
 $small = @($pizza.sizes | Where-Object { $_.name -eq 'کوچک' })[0]
 $burger = @($fast.products | Where-Object { $_.name -like '*برگر*' })[0]
 $coke = @($fast.products | Where-Object { $_.name -like '*کوکا*' })[0]
 
# ══ TEST 1: ساخت دو ادمین۲ — hall و takeaway ══
 $hallAdmin = Send-Json Post "$base/api/admin/admins" @{
  phone = '09120000020'; firstName = 'Salar'; lastName = 'Yeki'; scope = 'hall'
} $H
P 'T1 hall admin created' ($hallAdmin.success -eq $true) ''

 $tkAdmin = Send-Json Post "$base/api/admin/admins" @{
  phone = '09120000021'; firstName = 'Biron'; lastName = 'Bardar'; scope = 'takeaway'
} $H
P 'T1 takeaway admin created' ($tkAdmin.success -eq $true) ''

# ══ TEST 2: لاگین ادمین۲ — رستوران باز ══
 $hall = LoginPhone '09120000020' (DevObj 'p5-hall')
 $HH = @{ authorization = "Bearer $($hall.accessToken)" }
P 'T2 hall admin logged in' ($hall.user.role -eq 'admin2') ''

 $tk = LoginPhone '09120000021' (DevObj 'p5-tk')
 $HT = @{ authorization = "Bearer $($tk.accessToken)" }
P 'T2 takeaway admin logged in' ($tk.user.role -eq 'admin2') ''

# ══ TEST 3: queueCount از verify — برای هر دو 0 (هنوز سفارشی نیست) ══
P 'T3 hall queueCount=0' ($hall.queueCount -eq 0) "qc=$($hall.queueCount)"
P 'T3 takeaway queueCount=0' ($tk.queueCount -eq 0) "qc=$($tk.queueCount)"

# ══ فعال‌سازی ردیابی برای تست موقعیت (snapshot روی سفارش‌های جدید می‌نشیند) ══
 $null = Send-Json Post "$base/api/admin/settings/live-tracking" @{ enabled = $true } $H

# ══ TEST 4: سه سفارش سه‌نوعه + پرداخت mock موفق ══
function Checkout($items, $type, $addressId) {
  $co = Send-Json Post "$base/api/orders/checkout" @{
    items = $items; deliveryType = $type; useWallet = $false; gatewayId = 'MOCK'
    addressId = $addressId
  } $HB
  if ($co.requiresPayment) {
    $null = Send-Json Post ($base + $co.paymentUrl) @{ success = $true } $null
  }
  $co
}

# سفارش ۱: DINE_IN (سبز — scope hall)
 $oDine = Checkout @(@{ productId = $burger.id; quantity = 1 }) 'DINE_IN' $null
P 'T4 DINE_IN created+paid' ($null -ne $oDine.orderId) "id=$($oDine.orderId)"

# سفارش ۲: PICKUP (بنفش — scope takeaway)
 $oPick = Checkout @(@{ productId = $coke.id; quantity = 1 }) 'PICKUP' $null
P 'T4 PICKUP created+paid' ($null -ne $oPick.orderId) "id=$($oPick.orderId)"

# سفارش ۳: DELIVERY (آبی — scope takeaway) + نکته‌ی مشتری
 $oDel = Send-Json Post "$base/api/orders/checkout" @{
  items = @(@{ productId = $pizza.id; sizeId = $small.id; quantity = 1 })
  deliveryType = 'DELIVERY'; useWallet = $false; gatewayId = 'MOCK'
  addressId = $addr.id; customerNote = 'زنگ واحد ۳ را فشار ندهید؛ تماس بگیرید'
} $HB
 $null = Send-Json Post ($base + $oDel.paymentUrl) @{ success = $true } $null
P 'T4 DELIVERY created+paid' ($null -ne $oDel.orderId) "id=$($oDel.orderId)"

# ══ TEST 5: صفِ scoped — هر ادمین فقط scope خودش ══
 $hallLive = Invoke-RestMethod "$base/api/live/orders" -Headers $HH
P 'T5 hall sees only DINE_IN queue' ($hallLive.orders.Count -eq 1 -and $hallLive.orders[0].deliveryType -eq 'DINE_IN') "count=$($hallLive.orders.Count)"

 $tkLive = Invoke-RestMethod "$base/api/live/orders" -Headers $HT
P 'T5 takeaway sees DELIVERY+PICKUP' ($tkLive.orders.Count -eq 2) "count=$($tkLive.orders.Count)"
 $tkTypes = @($tkLive.orders | ForEach-Object { $_.deliveryType }) | Sort-Object
P 'T5 takeaway types correct' (($tkTypes -join ',') -eq 'DELIVERY,PICKUP') "types=$($tkTypes -join ',')"

# ══ TEST 6: تایید بدون دیدن نکته → رد ══
 $conf = Send-Json Post "$base/api/live/orders/$($oDel.orderId)/confirm" @{
  courierId = $null; securityEnabled = $false
} $HT
P 'T6 confirm without noteSeen rejected' ($conf.success -eq $false) "msg=$($conf.message)"

# دیدن نکته
 $note = Send-Json Post "$base/api/live/orders/$($oDel.orderId)/note" @{} $HT
P 'T6 note returned' ($note.note -like '*واحد ۳*') ''

# ══ TEST 7: تایید hall ادمین روی DELIVERY → رد (خارج scope) ══
 $confWrong = Send-Json Post "$base/api/live/orders/$($oDel.orderId)/confirm" @{
  securityEnabled = $false
} $HH
P 'T7 hall cannot confirm DELIVERY' ($confWrong.success -eq $false) "msg=$($confWrong.message)"

# ══ TEST 8: تایید takeaway روی DELIVERY با پیک و امنیت ══
 $cr = Send-Json Post "$base/api/admin/couriers" @{ name = 'Reza Peyk'; phone = '09120000099' } $HT
P 'T8 courier added' ($cr.success -eq $true) ''
 $courierList = Invoke-RestMethod "$base/api/admin/couriers" -Headers $HT
 $courier = @($courierList | Where-Object { $_.phone -eq '09120000099' })[0]

 $confOk = Send-Json Post "$base/api/live/orders/$($oDel.orderId)/confirm" @{
  courierId = $courier.id; securityEnabled = $true
} $HT
P 'T8 DELIVERY confirmed with security' ($confOk.success -eq $true) ''

# تایید PICKUP هم با takeaway
 $confPick = Send-Json Post "$base/api/live/orders/$($oPick.orderId)/confirm" @{
  securityEnabled = $false
} $HT
P 'T8 PICKUP confirmed' ($confPick.success -eq $true) ''

# تایید DINE_IN با hall
 $confDine = Send-Json Post "$base/api/live/orders/$($oDine.orderId)/confirm" @{
  securityEnabled = $false
} $HH
P 'T8 DINE_IN confirmed by hall' ($confDine.success -eq $true) ''

# ══ TEST 9: اسکن بدون توکن → رد (چون securityEnabled) ══
 $scan = Send-Json Post "$base/api/courier/scan/$($oDel.orderId)" @{} $null
P 'T9 scan without token rejected' ($scan.success -eq $false) "msg=$($scan.message)"

# ══ TEST 10: OTP پیک + اسکن موفق ══
 $otp = Send-Json Post "$base/api/courier/otp/request" @{ phone = '09120000099' } $null
P 'T10 courier OTP issued' ($null -ne $otp.devCode) ''

 $ver = Send-Json Post "$base/api/courier/otp/verify" @{ phone = '09120000099'; code = $otp.devCode } $null
P 'T10 courier token issued' ($null -ne $ver.token) ''

 $scanOk = Send-Json Post "$base/api/courier/scan/$($oDel.orderId)" @{ courierToken = $ver.token } $null
P 'T10 scan with token → ON_THE_WAY' ($scanOk.success -eq $true) ''

# ══ TEST 11: موقعیت پیک ══
 $loc1 = Send-Json Post "$base/api/courier/orders/$($oDel.orderId)/location" @{
  courierToken = $ver.token; lat = 35.69; lng = 51.39
} $null
P 'T11 location accepted' ($loc1.success -eq $true) ''

# throttle — دوباره فوری → رد بی‌جواب (success=true ولی نوشته نشد)
 $loc2 = Send-Json Post "$base/api/courier/orders/$($oDel.orderId)/location" @{
  courierToken = $ver.token; lat = 89; lng = 89
} $null
Start-Sleep -Seconds 4
 $loc3 = Send-Json Post "$base/api/courier/orders/$($oDel.orderId)/location" @{
  courierToken = $ver.token; lat = 35.70; lng = 51.40
} $null
# مقدار نهایی باید 35.70 باشد (loc2 throttle شد)
 $orderDetail = Invoke-RestMethod "$base/api/orders/$($oDel.orderId)" -Headers $HB
P 'T11 throttled update ignored (lat=35.70)' ($orderDetail.courierLocation.lat -eq 35.70) "lat=$($orderDetail.courierLocation.lat)"

$null = Send-Json Post "$base/api/admin/settings/live-tracking" @{ enabled = $false } $H

# ══ TEST 12: تحویل مشتری + نظر ══
Send-Json Post "$base/api/orders/$($oDel.orderId)/deliver" @{} $HB | Out-Null
 $rev = Send-Json Post "$base/api/reviews" @{
  orderId = $oDel.orderId; productId = $pizza.id; feedback = 'خیلی خوشمزه بود!'
} $HB
P 'T12 review submitted' ($rev.success -eq $true) ''

# نظر دوباره → رد
 $rev2 = Send-Json Post "$base/api/reviews" @{
  orderId = $oDel.orderId; productId = $pizza.id; feedback = 'duplicate'
} $HB
P 'T12 duplicate review rejected' ($rev2.success -eq $false) ''

# مودریشن ادمین → تایید
 $revList = Invoke-RestMethod "$base/api/admin/reviews?status=pending" -Headers $H
 $pending = @($revList | Where-Object { $_.orderId -eq $oDel.orderId })[0]
 $mod = Send-Json Post "$base/api/admin/reviews/$($pending.id)/moderate" @{ action = 'approve' } $H
P 'T12 review approved' ($mod.success -eq $true) ''

# نظرات تاییدشده‌ی محصول — عمومی
 $pubReviews = Invoke-RestMethod "$base/api/products/$($pizza.id)/reviews"
P 'T12 approved visible publicly' (@($pubReviews).Count -eq 1) ''

# ══ TEST 13: activity log ادمین۲ ══
 $hallDetail = Invoke-RestMethod "$base/api/admin/admins/$($hall.user.id)" -Headers $H
P 'T13 hall ordersConfirmed=1' ($hallDetail.ordersConfirmed -eq 1) "oc=$($hallDetail.ordersConfirmed)"

 $hallActs = Invoke-RestMethod "$base/api/admin/admins/$($hall.user.id)/activities?page=1&limit=50" -Headers $H
 $actTypes = @($hallActs.activities | ForEach-Object { $_.action })
P 'T13 hall has LOGIN+ORDER_CONFIRM' (($actTypes -contains 'LOGIN') -and ($actTypes -contains 'ORDER_CONFIRM')) "actions=$($actTypes -join ',')"

# ══ TEST 14: بسته موقت — ادمین۲ بدون permission رد، با permission قبول ══
 $tcNoPerm = Send-Json Post "$base/api/admin/settings/temporary-close" @{ closed = $true; reason = 'قطع گاز' } $HT
P 'T14 temp-close without permission rejected' ($tcNoPerm.__status -eq 403) "code=$($tcNoPerm.__status) err=$($tcNoPerm.error | ConvertTo-Json -Compress)"

# ادمین اصلی permission می‌دهد
 $null = Send-Json Patch "$base/api/admin/admins/$($tk.user.id)/permissions" @{
  canToggleTemporaryClose = $true
} $H
 $tcOk = Send-Json Post "$base/api/admin/settings/temporary-close" @{ closed = $true; reason = 'قطع گاز' } $HT
P 'T14 temp-close with permission accepted' ((OK $tcOk) -and $tcOk.success -eq $true) "resp=$($tcOk | ConvertTo-Json -Compress)"

# کاربر هنوز سفارش می‌تواند ثبت کند (قوانین یکسان — صف اما تایید آزاد)
 $oClosed = Send-Json Post "$base/api/orders/checkout" @{
  items = @(@{ productId = $burger.id; quantity = 1 })
  deliveryType = 'DINE_IN'; useWallet = $false; gatewayId = 'MOCK'
} $HB
 $null = Send-Json Post ($base + $oClosed.paymentUrl) @{ success = $true } $null
P 'T14 order during temp-close OK' ((OK $oClosed) -and $null -ne $oClosed.orderId) "id=$($oClosed.orderId)"

# ادمین۲ جدید می‌تواند لاگین شود (بسته‌ی موقت مانع لاگین نیست — فقط ساعتی مانع است)
 $hall2 = LoginPhone '09120000020' (DevObj 'p5-hall-2')
P 'T14 admin2 login during temp-close allowed' ((OK $hall2) -and $hall2.user.role -eq 'admin2') "role=$($hall2.user.role)"

# باز کردن مجدد
 $null = Send-Json Post "$base/api/admin/settings/temporary-close" @{ closed = $false } $H

# ══ TEST 15: لاگین ادمین۲ وقتی ساعتی بسته → رد (403) ══
 $null = Send-Json Post "$base/api/admin/settings/restaurant" @{ isOpen = $false } $H
 $hall3 = LoginPhone '09120000020' (DevObj 'p5-hall-3')
P 'T15 schedule-closed login rejected' ($hall3.__status -eq 403) "code=$($hall3.__status) err=$($hall3.error | ConvertTo-Json -Compress)"
 $null = Send-Json Post "$base/api/admin/settings/restaurant" @{ isOpen = $true } $H

# ══ TEST 16: queueCount scoped برای لاگین جدید ══
# سفارش oClosed هنوز PAID بدون تایید → ادمین hall لاگین کند، queueCount باید ۱ باشد
 $hallNew = LoginPhone '09120000020' (DevObj 'p5-hall-4')
P 'T16 queueCount=1 for hall login' ((OK $hallNew) -and $hallNew.queueCount -eq 1) "qc=$($hallNew.queueCount)"

if ($script:failed) { Write-Host '=== SOME TESTS FAILED ===' -ForegroundColor Red }
else { Write-Host '=== ALL PASS ===' -ForegroundColor Green }
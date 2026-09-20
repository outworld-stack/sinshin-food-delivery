# Phase 3 verification — v2 encoding-proof.
# REQUIREMENT: this file must be saved as "UTF-8 with BOM" (see run instructions).

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
 $ErrorActionPreference = 'Stop'
 $base = 'http://localhost:3000'

# همه‌ی body ها: hashtable → ConvertTo-Json (فارسی \uXXXX می‌شود) → بایت‌های UTF-8 صریح
function Send-Json($method, $url, $obj, $headers) {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $irm = @{ Method = $method; ContentType = 'application/json; charset=utf-8'; Body = $bytes }
  if ($headers) { $irm.Headers = $headers }
  Invoke-RestMethod $url @irm
}

function LoginPhone($phone, $devObj) {
  $r = Send-Json Post "$base/api/auth/otp/request" @{ phone = $phone } $null
  Send-Json Post "$base/api/auth/otp/verify" @{
    phone = $phone; code = $r.devCode; device = $devObj
    termsAccepted = $true; termsVersion = '1'
  } $null
}

 $devObj = @{
  clientId = 'ps-script-' + (Get-Random)
  canvasHash = 'a' * 64; webglHash = 'b' * 64; audioHash = 'c' * 64; fontsHash = 'd' * 64
  screen = '1920x1080x24@1'; platform = 'Windows'; timezone = 'Asia/Tehran'
  language = 'fa-IR'; hardwareConcurrency = 8; deviceMemory = 8; touch = $false
  label = 'Script'
}

Write-Host '== login admin =='
 $admin = LoginPhone '09120000000' $devObj
 $tok = $admin.accessToken
if (-not $tok) { throw 'login failed — no token' }
 $H = @{ authorization = "Bearer $tok" }
Write-Host "role: $($admin.user.role)"

Write-Host '== baseline =='
 $before = (Invoke-RestMethod "$base/api/menu/mains/fastfood/products").products.Count
Write-Host "fastfood products before: $before"

Write-Host '== TEST A0: ASCII isolation =='
 $cat = Invoke-RestMethod "$base/api/menu/categories"
 $pizzaCat = $cat | Where-Object { $_.slug -eq 'pizza' }

 $ascii = Send-Json Post "$base/api/admin/menu/products" @{
  name = 'AsciiTest'; description = 'ascii'; originalPrice = 100000
  discountPercentage = 10; prepTime = 10; categoryId = $pizzaCat.id
  sizesEnabled = $true
  sizes = @(@{ name = 'S'; price = 90000 }, @{ name = 'L'; price = 150000 })
  ingredients = @('x')
} $H
Write-Host "ascii create success: $($ascii.success)"

Write-Host '== TEST A: Persian + instant cache invalidation =='
 $fa = Send-Json Post "$base/api/admin/menu/products" @{
  name = 'تست محصول فوری'; description = 'تست'; originalPrice = 100000
  discountPercentage = 10; prepTime = 10; categoryId = $pizzaCat.id
  sizesEnabled = $true
  sizes = @(@{ name = 'کوچک'; price = 90000 }, @{ name = 'بزرگ'; price = 150000 })
  ingredients = @('تست')
} $H
Write-Host "persian create success: $($fa.success)  id: $($fa.id)"

 $after = (Invoke-RestMethod "$base/api/menu/mains/fastfood/products").products.Count
Write-Host "products after 2 creates (NO sleep): $after  — expect $($before + 2)"
if ($after -eq ($before + 2)) { Write-Host 'PASS: cache invalidated instantly' -ForegroundColor Green }
else { Write-Host 'FAIL: expected before+2' -ForegroundColor Red }

Write-Host '== toggle both instantly =='
Send-Json Post "$base/api/admin/menu/products/$($ascii.id)/toggle" @{} $H | Out-Null
Send-Json Post "$base/api/admin/menu/products/$($fa.id)/toggle" @{} $H | Out-Null
 $afterToggle = (Invoke-RestMethod "$base/api/menu/mains/fastfood/products").products.Count
Write-Host "products after toggles (NO sleep): $afterToggle  — expect $before"
if ($afterToggle -eq $before) { Write-Host 'PASS: toggle reflected instantly' -ForegroundColor Green }
else { Write-Host 'FAIL: expected baseline' -ForegroundColor Red }

Write-Host '== TEST B: delete guards =='
 $restMain = Invoke-RestMethod "$base/api/admin/menu/mains" -Headers $H | Where-Object { $_.slug -eq 'restaurant' }
 $g1 = Invoke-RestMethod "$base/api/admin/menu/mains/$($restMain.id)" -Method Delete -Headers $H
Write-Host "main-with-children -> success: $($g1.success)  msg: $($g1.message)"

 $restCat = $cat | Where-Object { $_.slug -eq 'sandwich' }
 $g2 = Invoke-RestMethod "$base/api/admin/menu/categories/$($restCat.id)" -Method Delete -Headers $H
Write-Host "category-with-products -> success: $($g2.success)  msg: $($g2.message)"

Write-Host '== done =='
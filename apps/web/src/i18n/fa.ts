// src/i18n/fa.ts
// رارد ۳۱ — دیکشنری فارسی (زبان پیش‌فرض). شکلِ این فایل «منبع حقیقت» تایپ‌هاست:
// هر کلیدی که این‌جا باشد، فایل ar.ts هم موظف است داشته باشد (typeof fa) —
// اگر حتی یک کلید عربی جا بیفتد، tsc --noEmit قرارداد پروژه خطا می‌دهد.
export const fa = {
	// ── سوییچر زبان ──
	'switcher.farsi': 'فارسی',
	'switcher.arabic': 'العربية',

	// ── بنر مرورگر قدیمی (رارد ۳۱) ──
	'banner.text': 'برای بهره‌مندی از امکانات سایت لطفاً مرورگر خود را آپدیت کنید.',
	'banner.close': 'بستن هشدار',

	// ── لندینگ ──
	'landing.sliderPrefix': 'تجربه لذت‌بخش',
	'landing.word1': 'پیتزا',
	'landing.word2': 'سوخاری',
	'landing.word3': 'پاستا',
	'landing.word4': 'موهیتو',
	'landing.word5': 'قهوه',
	'landing.word6': 'کباب',
	'landing.heroLine1': 'طعم زندگی، درِ خانه شما',
	'landing.heroLine2': 'در سریع‌ترین زمان ممکن',
	'landing.sub':
		'تجربه‌ای متفاوت از سفارش آنلاین غذا. با ثبت‌نام در سایت، لینک اختصاصی خود را دریافت کنید و با معرفی دوستانتان، تخفیف‌های ویژه و کیف پول فعال بگیرید.',
	'landing.profile': 'پروفایل کاربری',
	'landing.auth': 'ورود / ثبت‌نام',
	'landing.products': 'دیدن محصولات',

	// ── صفحه ورود ──
	'login.back': 'بازگشت',
	'login.title': 'ورود / ثبت‌نام',
	'login.phoneRequired': 'شماره موبایل الزامی است.',
	'login.phoneFormat': 'فرمت شماره صحیح نیست (09xxxxxxxxx)',
	'login.phoneHint': 'در ورود شماره تلفن دقت کنید، چون قابل تغییر نیست.',
	'login.refInvited': 'شما با کد معرف',
	'login.refInvitedSuffix': 'دعوت شده‌اید',
	'login.refSignup': 'ثبت‌نام با کد معرف',
	'login.termsLabel': 'قوانین و شرایط سین‌شین',
	'login.termsRest': 'را خواندم و می‌پذیرم.',
	'login.viewTerms': 'مشاهده قوانین — تا انتهای متن اسکرول کنید',
	'login.termsReadOk': 'قوانین مطالعه شد — می‌توانید تیک بزنید',
	'login.termsRequired':
		'برای دریافت کد تأیید، ابتدا قوانین را مطالعه و بپذیرید.',
	'login.sendCode': 'دریافت کد تایید',
	'login.checking': 'در حال بررسی...',
	'login.otpTitle': 'کد تایید را وارد کنید',
	'login.otpSentTo': 'کد ارسال شده به',
	'login.codeRule': 'کد باید ۶ رقم باشد.',
	'login.verify': 'تایید و ورود',
	'login.signup': 'ثبت‌نام و ورود',
	'login.resendIn': 'ارسال مجدد کد تا {n} ثانیه دیگر',
	'login.resend': 'ارسال مجدد کد',
	'login.changePhone': 'تغییر شماره موبایل',
	'login.welcomeToast': 'ثبت‌نام شما با موفقیت انجام شد! خوش آمدید 🎉',
	'login.newCodeToast': 'کد جدید ارسال شد',
	'login.queueToast': '{n} سفارش در صفِ حوزه‌ی شما به شما تحویل شد',
} as const

/** کلیدها از fa؛ مقادیر گسترده به string تا ar بتواند مقدار خودش را بگذارد */
export type Dict = { [K in keyof typeof fa]: string }

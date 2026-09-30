// src/i18n/ar.ts
// رارد ۳۱ — دیکشنری عربی. تایپ آن «دقیقاً» همان کلیدهای fa است (Dict) —
// کلید جاافتاده = خطای کامپایل، کلید اضافه = خطای کامپایل.
// ترجمه: عربی معیارِ امروزی به سبک سایت‌های سفارش غذا (سبک خلیجی).
import type { Dict } from './fa'

export const ar: Dict = {
	// ── مبدّل اللغة ──
	'switcher.farsi': 'فارسی',
	'switcher.arabic': 'العربية',

	// ── تنبيه المتصفح القديم ──
	'banner.text': 'للاستفادة من جميع ميزات الموقع، يُرجى تحديث المتصفّح الخاص بك.',
	'banner.close': 'إغلاق التنبيه',

	// ── الصفحة الرئيسية ──
	'landing.sliderPrefix': 'تجربة لذيذة',
	'landing.word1': 'بيتزا',
	'landing.word2': 'الدجاج المقلي',
	'landing.word3': 'باستا',
	'landing.word4': 'موهيتو',
	'landing.word5': 'قهوة',
	'landing.word6': 'كباب',
	'landing.heroLine1': 'نكهة الحياة، على باب بيتك',
	'landing.heroLine2': 'في أسرع وقت ممكن',
	'landing.sub':
		'تجربة مختلفة لطلب الطعام أونلاين. سجّل في الموقع لتحصل على رابطك الخاص، وعند دعوة أصدقائك ستحصل على خصومات خاصة ومحفظة فعّالة.',
	'landing.profile': 'الملف الشخصي',
	'landing.auth': 'تسجيل الدخول / إنشاء حساب',
	'landing.products': 'تصفّح المنتجات',

	// ── صفحة الدخول ──
	'login.back': 'رجوع',
	'login.title': 'تسجيل الدخول / إنشاء حساب',
	'login.phoneRequired': 'رقم الهاتف مطلوب.',
	'login.phoneFormat': 'صيغة الرقم غير صحيحة (09xxxxxxxxx)',
	'login.phoneHint': 'انتبه لرقم الهاتف عند الدخول، فلا يمكن تغييره لاحقاً.',
	'login.refInvited': 'أنت مدعوّ برمز الإحالة',
	'login.refInvitedSuffix': '',
	'login.refSignup': 'التسجيل برمز الإحالة',
	'login.termsLabel': 'شروط وأحكام سين شين',
	'login.termsRest': '— قرأتها وأوافق عليها.',
	'login.viewTerms': 'عرض الشروط — مرّر إلى نهاية النص',
	'login.termsReadOk': 'تمت قراءة الشروط — يمكنك التأكيد الآن',
	'login.termsRequired': 'للحصول على رمز التحقق، اقرأ الشروط واقبلها أولاً.',
	'login.sendCode': 'الحصول على رمز التحقق',
	'login.checking': 'جارٍ التحقق...',
	'login.otpTitle': 'أدخل رمز التحقق',
	'login.otpSentTo': 'أُرسل الرمز إلى',
	'login.codeRule': 'يجب أن يكون الرمز ٦ أرقام.',
	'login.verify': 'تحقق وتسجيل الدخول',
	'login.signup': 'إنشاء حساب ودخول',
	'login.resendIn': 'إعادة إرسال الرمز بعد {n} ثانية',
	'login.resend': 'إعادة إرسال الرمز',
	'login.changePhone': 'تغيير رقم الهاتف',
	'login.welcomeToast': 'تم تسجيلك بنجاح! أهلاً بك 🎉',
	'login.newCodeToast': 'تم إرسال رمز جديد',
	'login.queueToast': 'تم تسليمك {n} طلباً من قائمة انتظار نطاقك',
}

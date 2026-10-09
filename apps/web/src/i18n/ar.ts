// ═══════════════════════════════════════════════════════════════
// round-48 — sinshin-food-delivery — فایل 72 از 97
// مسیر مقصد: apps/web/src/i18n/ar.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage forty-three
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/i18n/ar.ts
// تغییر: کلیدهای نوتیفیکیشن + آدرس نقشه (هم‌ارز fa.ts)
// ═══════════════════════════════════════════════════════════════

// src/i18n/ar.ts
// رارد ۳۱ — دیکشنری عربی؛ رارد ۳۲ — گسترش به کل سایت اصلی.
// تایپ آن «دقیقاً» همان کلیدهای fa است (Dict) — کلید جاافتاده یا اضافه =
// خطای کامپایل. عربیِ معیار به سبک سایت‌های سفارش غذا؛ ارقام با ar-EG.
import type { Dict } from './fa'

export const ar: Dict = {
	// ── مبدّل اللغة ──
	'switcher.farsi': 'الفارسية',
	'switcher.arabic': 'العربية',

	// ── شريط المتصفح القديم (الجولة ٣١) ──
	'banner.text': 'للاستفادة من مزايا الموقع يُرجى تحديث المتصفح.',
	'banner.close': 'إغلاق التنبيه',

	// ── الصفحة الرئيسية (الجولة ٣١) ──
	'landing.sliderPrefix': 'تجربة ممتعة',
	'landing.word1': 'بيتزا',
	'landing.word2': 'دجاج مقلي',
	'landing.word3': 'باستا',
	'landing.word4': 'موخيتو',
	'landing.word5': 'قهوة',
	'landing.word6': 'كباب',
	'landing.heroLine1': 'نكهة الحياة، على باب بيتك',
	'landing.heroLine2': 'في أسرع وقت ممكن',
	'landing.sub':
		'تجربة مختلفة لطلب الطعام عبر الإنترنت. سجّل في الموقع واحصل على رابطك الخاص، وعند دعوة أصدقائك احصل على خصومات خاصة ومحفظة فعّالة.',
	'landing.profile': 'الملف الشخصي',
	'landing.auth': 'دخول / تسجيل',
	'landing.products': 'تصفّح المنتجات',

	// ── صفحة الدخول (الجولة ٣١) ──
	'login.back': 'رجوع',
	'login.title': 'دخول / تسجيل',
	'login.phoneRequired': 'رقم الهاتف مطلوب.',
	'login.phoneFormat': 'صيغة الرقم غير صحيحة (09xxxxxxxxx)',
	'login.phoneHint': 'انتبه عند إدخال رقم الهاتف، إذ لا يمكن تغييره لاحقاً.',
	'login.refInvited': 'لقد تمت دعوتك برمز الإحالة',
	'login.refInvitedSuffix': '',
	'login.refSignup': 'التسجيل برمز إحالة',
	'login.termsLabel': 'القواعد وشروط سين‌شين',
	'login.termsRest': 'قرأتها وأقبلها.',
	'login.viewTerms': 'عرض القواعد — مرّر النص حتى النهاية',
	'login.termsReadOk': 'تمت قراءة القواعد — يمكنك التحديد الآن',
	'login.termsRequired': 'لتلقي رمز التأكيد، اقرأ القواعد واقبلها أولاً.',
	'login.sendCode': 'تلقي رمز التأكيد',
	'login.checking': 'جارٍ التحقق...',
	'login.otpTitle': 'أدخل رمز التأكيد',
	'login.otpSentTo': 'أُرسل الرمز إلى',
	'login.codeRule': 'يجب أن يتكوّن الرمز من ٦ أرقام.',
	'login.verify': 'تأكيد ودخول',
	'login.signup': 'تسجيل ودخول',
	'login.resendIn': 'إعادة إرسال الرمز بعد {n} ثانية',
	'login.resend': 'إعادة إرسال الرمز',
	'login.changePhone': 'تغيير رقم الهاتف',
	'login.welcomeToast': 'تم تسجيلك بنجاح! أهلاً بك 🎉',
	'login.newCodeToast': 'أُرسل رمز جديد',
	'login.queueToast': 'تم تسليمك {n} طلباً من قائمة انتظار نطاقك',

	// ── عام (الجولة ٣٢) ──
	'common.back': 'رجوع',
	'common.toman': 'تومان',
	'common.tomanShort': 'ت',
	'common.pcs': 'حبة',
	'common.all': 'الكل',
	'common.allItems': 'كل المواد',
	'common.close': 'إغلاق',
	'common.cancel': 'إلغاء',
	'common.yes': 'نعم',
	'common.retry': 'إعادة المحاولة',
	'common.scrollTop': 'العودة إلى الأعلى',
	'common.discountBadge': 'خصم {n}٪',

	// ── العدّ التنازلي للخصم المحدود بوقت (stage-47) ──
	'common.offerEndsIn': 'نهاية الخصم',
	'common.timeDay': 'يوم',
	'common.timeHour': 'ساعة',
	'common.timeMin': 'دقيقة',
	'common.timeSec': 'ثانية',

	// ── الترويسة (الجولة ٣٢) ──
	'header.adminPanel': 'لوحة الإدارة',
	'header.ordersPanel': 'لوحة الطلبات',
	'header.trackOrder': 'تتبّع الطلب',
	'header.cart': 'سلة الشراء',
	'header.profile': 'الملف الشخصي',
	'header.auth': 'دخول / تسجيل',

	// ── التذييل (الجولة ٣٢) ──
	'footer.about': 'من نحن',
	'footer.gallery': 'المعرض',
	'footer.articles': 'المقالات',
	'footer.contact': 'اتصل بنا',
	'footer.brandDesc':
		'سين‌شين فودبارك؛ تجربة مختلفة لطلب الطعام عبر الإنترنت. نكهة الحياة، على باب بيتك، في أسرع وقت ممكن.',
	'footer.address': 'بندر أنزلي، الكيلومتر الأول من پاسداران',
	'footer.hours': 'كل يوم من ١١ صباحاً حتى ١٢ مساءً',
	'footer.instagram': 'إنستغرام',
	'footer.rights': '© {n} سين‌شين — جميع الحقوق محفوظة',
	'footer.madeWith': 'تصميم وتطوير بـ ❤️ في سين‌شين',

	// ── صفحة الوصول المقيّد (الجولة ٣٢) ──
	'geo.code': '٤٠٣',
	'geo.title': 'الوصول مقيّد',
	'geo.message': 'إذا كنت داخل إيران، يُرجى إيقاف تشغيل VPN وتحديث الصفحة.',
	'geo.refresh': 'تحديث الصفحة',
	// ── حالة «إيران + العراق» (الجولة ٣٧ — عندما يكون النطاق الخارجي = العراق فقط) ──
	'geo.title.iraq': 'الوصول من إيران والعراق فقط',
	'geo.message.iraq':
		'هذه الخدمة متاحة فقط للمستخدمين داخل إيران والعراق. إذا كنت داخل أحد البلدين، يُرجى إيقاف تشغيل VPN وتحديث الصفحة.',

	// ── إعادة توجيه الإحالة (الجولة ٣٢) ──
	'referral.redirecting': 'جارٍ التحويل إلى صفحة الدخول…',

	// ── شريط التصنيفات (الجولة ٣٢) ──
	'scroller.scrollRight': 'تمرير إلى اليمين',
	'scroller.scrollLeft': 'تمرير إلى اليسار',

	// ── الحالة الفارغة الافتراضية (الجولة ٣٢) ──
	'empty.title': 'لم يُعثر على منتج',
	'empty.desc': 'لا توجد حالياً منتجات في هذا التصنيف. تحقّق لاحقاً.',

	// ── صفحة المنتجات (الجولة ٣٢) ──
	'products.title': 'قائمة منتجات سين‌شين',
	'products.filterSort': 'تصفية وترتيب',
	'products.sortBy': 'الترتيب حسب:',
	'products.applyFilters': 'تطبيق التصفية',
	'products.emptyTitle': 'لم يُعثر على منتج في هذا التصنيف',
	'products.emptyDesc': 'لا توجد حالياً منتجات متاحة لهذا التصنيف.',
	'products.loadMore': 'عرض المزيد من المنتجات',
	'products.sort.newest': 'الأحدث',
	'products.sort.mostViewed': 'الأكثر مشاهدة',
	'products.sort.bestSelling': 'الأكثر مبيعاً',
	'products.sort.fastestPrep': 'الأسرع تحضيراً',
	'products.sort.expensive': 'الأغلى',
	'products.sort.cheap': 'الأرخص',

	// ── صفحة تفاصيل المنتج (الجولة ٣٢) ──
	'pdetail.category': 'التصنيف',
	'pdetail.prepTime': 'جاهز خلال {n} دقيقة',
	'pdetail.sizeSelect': 'اختيار الحجم:',
	'pdetail.addToCart': 'إضافة إلى سلة الشراء',
	'pdetail.addedToast': 'تمت إضافة {n} إلى السلة!',
	'pdetail.ingredients': 'مكوّنات المنتج',
	'pdetail.reviews': 'آراء العملاء',
	'pdetail.noReviews': 'لم يُسجَّل ويُعتمد أي رأي لهذا المنتج حتى الآن',
	'pdetail.anonUser': 'مستخدم',

	// ── سلة الشراء (الجولة ٣٢) ──
	'cart.title': 'سلة الشراء',
	'cart.clear': 'تفريغ السلة',
	'cart.emptyTitle': 'سلة الشراء فارغة',
	'cart.emptyDesc': 'لم تُضف أي منتج إلى السلة بعد. يمكنك تصفّح قائمة المنتجات.',
	'cart.viewProducts': 'تصفّح المنتجات',
	'cart.priceError':
		'تعذّر استلام أسعار السلة من الخادم. تحقّق من الاتصال أو محتويات السلة.',
	'cart.summary': 'ملخّص الطلب',
	'cart.itemCount': 'إجمالي عدد المواد',
	'cart.totalAmount': 'المبلغ الإجمالي',
	'cart.savings': 'وفّرت في هذا الشراء',
	'cart.finalAmount': 'المبلغ النهائي للدفع',
	'cart.continue': 'متابعة إتمام الشراء',
	'cart.clearedToast': 'تم تفريغ سلة الشراء',
	'cart.removedToast': 'أُزيل المنتج من السلة',
	'cart.clearTitle': 'تفريغ سلة الشراء',
	'cart.clearMessage':
		'هل أنت متأكد من تفريغ سلة الشراء؟ ستُحذف جميع المنتجات من سلتك.',
	'cart.unavailable': 'يوجد في سلتك منتج غير متوفر',
	'cart.unavailableHint':
		'هذا المنتج محذوف أو معطّل مؤقتاً ولا يمكن طلبه — أخرِجه من السلة.',
	'cart.incQty': 'زيادة الكمية',
	'cart.decQty': 'إنقاص الكمية',
	'cart.removeItem': 'حذف المنتج',
	'cart.removeUnavailable': 'حذف المنتج غير المتوفر من السلة',
	'cart.lineTotal': 'الإجمالي',

	// ── إتمام الشراء (الجولة ٣٢) ──
	'checkout.title': 'إتمام الشراء',
	'checkout.loginRequired': 'لمتابعة الشراء يجب تسجيل الدخول',
	'checkout.deliveryTitle': 'طريقة تسليم الطلب',
	'checkout.courier': 'التوصيل بالساعي',
	'checkout.courierFee': '{n} + أجرة التغليف',
	'checkout.inPerson': 'الاستلام في المكان',
	'checkout.inPersonSub': 'تقديم في المكان أو سفري',
	'checkout.chooseInPerson': 'اختر وضع الاستلام:',
	'checkout.dineIn': 'تقديم في مكان سين‌شين',
	'checkout.dineInFree': 'بدون أجرة تغليف',
	'checkout.pickup': 'الاستلام من سين‌شين (سفري)',
	'checkout.pickupFee': 'مع {n} أجرة تغليف',
	'checkout.pickupFeeGeneric': 'مع أجرة تغليف',
	'checkout.couponTitle': 'رمز الخصم',
	'checkout.noCoupon': 'لا أملك',
	'checkout.haveCoupon': 'أملك',
	'checkout.couponPlaceholder': 'رمز الخصم (مثال: SINSHIN20)',
	'checkout.applyCode': 'تطبيق الرمز',
	'checkout.appliedCode': 'تم التطبيق',
	'checkout.payTitle': 'طريقة الدفع',
	'checkout.wallet': 'الخصم من المحفظة',
	'checkout.balance': 'الرصيد: {n}',
	'checkout.noBalance': 'لا يوجد رصيد في محفظتك',
	'checkout.walletShare': 'سيُخصم {n} من مبلغ الأطعمة',
	'checkout.gatewayNoteDelivery':
		'يجب دفع أجرة التوصيل والتغليف عبر البوابة المصرفية، ولا يمكن خصمها من رصيد المحفظة.',
	'checkout.gatewayNotePickup':
		'يجب دفع أجرة التغليف عبر البوابة المصرفية، ولا يمكن خصمها من رصيد المحفظة.',
	'checkout.covered': 'مبلغ هذا الطلب مغطّى بالكامل — لا يوجد ما تدفعه:',
	'checkout.allFromWallet': 'سيُخصم كامل المبلغ من محفظتك:',
	'checkout.payViaGateway': 'دفع {n} عبر البوابة المصرفية:',
	'checkout.gateway.MOCK': 'بوابة تجريبية (عرض)',
	'checkout.gateway.ZARINPAL': 'زرين‌بال',
	'checkout.gateway.PAYIR': 'باي‌إير',
	'checkout.gateway.SEP': 'بنك سامان',
	'checkout.gateway.MELLAT': 'بنك ملت',
	'checkout.addressTitle': 'عنوان التسليم',
	'checkout.newAddress': 'عنوان جديد',
	'checkout.noAddress': 'لم تسجّل أي عنوان بعد',
	'checkout.firstAddress': 'تسجيل أول عنوان',
	'checkout.addAddressTitle': 'إضافة عنوان جديد',
	'checkout.titlePlaceholder': 'العنوان (مثلاً: البيت، مكان العمل)',
	'checkout.addressPlaceholder': 'العنوان الدقيق',
	'checkout.pickLocation': 'يُرجى اختيار الموقع على الخريطة',
	'checkout.addressAdded': 'أُضيف العنوان الجديد',
	'checkout.saving': 'جارٍ الحفظ...',
	'checkout.save': 'حفظ',
	'checkout.noteTitle': 'ملاحظات العميل',
	'checkout.noteHint':
		'إذا لديك ملاحظة على الطلب فاكتبها؛ مثلاً: «إذا تأخر الساعي فلينتظر قليلاً، فقد نتأخر.»',
	'checkout.notePlaceholder': 'ملاحظتك على هذا الطلب...',
	'checkout.foodAmount': 'مبلغ الأطعمة',
	'checkout.couponDiscount': 'خصم القسيمة',
	'checkout.walletLine': 'الخصم من المحفظة',
	'checkout.deliveryFee': 'أجرة التوصيل',
	'checkout.packagingFee': 'أجرة التغليف',
	'checkout.dineInLine': 'تقديم في المكان',
	'checkout.dineInFreeLine': 'بدون أجرة توصيل وتغليف',
	'checkout.finalTitle': 'المبلغ النهائي',
	'checkout.fromWallet': 'من المحفظة +',
	'checkout.fromGateway': 'من البوابة',
	'checkout.payableOnline': 'المبلغ القابل للدفع عبر الإنترنت:',
	'checkout.submitFree': 'تسجيل الطلب نهائياً',
	'checkout.submitPay': 'الدفع وتسجيل الطلب نهائياً',
	'checkout.processing': 'جارٍ المعالجة...',
	'checkout.closedTitle': 'المطعم مغلق حالياً',
	'checkout.closedNote':
		'بعد الدفع، سيُرسل طلبك في أول وقت ممكن بعد افتتاح المطعم.',
	'checkout.closedSummary':
		'المحل مغلق حالياً؛ سيُرسل طلبك بعد الدفع لاحقاً ({n}).',
	'checkout.openTime': 'وقت الافتتاح: {n}',
	'checkout.closeReason': 'السبب:',
	'checkout.noCancel':
		'بتسجيل ودفع هذا الطلب لا يمكن إلغاؤه — إذا فشل الدفع، يُسجَّل الطلب بحالة «دفع غير ناجح».',
	'checkout.couponApplied': 'طُبّق رمز الخصم ({n})',
	'checkout.couponInvalid': 'رمز الخصم غير صالح',
	'checkout.priceError': 'خطأ في حساب السعر — حاول مجدداً',
	'checkout.enterCoupon': 'يُرجى إدخال رمز الخصم',
	'checkout.orderPlaced': 'تم تسجيل طلبك!',
	'checkout.paySuccess': 'نجح الدفع — تم تسجيل الطلب',
	'checkout.payFailed': 'فشل الدفع — أُلغي الطلب؛ سلتك محفوظة',
	'checkout.payError': 'خطأ في الدفع',
	'checkout.orderProcessFail': 'فشلت معالجة الطلب',
	'checkout.orderProcessError': 'خطأ في معالجة الطلب',
	'checkout.pickAddress': 'يُرجى اختيار عنوان التسليم',
	'checkout.fixPriceError': 'صحّح أولاً خطأ التسعير',
	'checkout.applyOrRemoveCoupon': 'طبّق رمز الخصم أو احذفه أولاً',

	// ── المقالات (الجولة ٣٢) ──
	'articles.title': 'مقالات سين‌شين',
	'articles.filterSort': 'تصفية وترتيب',
	'articles.filtersTitle': 'تصفية المقالات',
	'articles.subFilter': 'تصنيف أدق:',
	'articles.sortBy': 'الترتيب حسب:',
	'articles.applyFilters': 'تطبيق التصفية',
	'articles.emptyTitle': 'لم يُعثر على مقال',
	'articles.emptyDesc': 'لا توجد حالياً مقالات في هذا التصنيف.',
	'articles.loadMore': 'عرض المزيد من المقالات',
	'articles.process': 'طريقة التحضير',
	'articles.tags': 'الوسوم:',
	'articles.sort.newest': 'الأحدث',
	'articles.sort.mostViewed': 'الأكثر مشاهدة',

	// ── المعرض (الجولة ٣٢) ──
	'gallery.title': 'سين‌شين لدينا',
	'gallery.subtitle': 'في أجواء هادئة، تذوّق طعامنا اللذيذ واستمتع بالتجربة',
	'gallery.zoom': 'تكبير',
	'gallery.alt': 'صورة {n} من المعرض',

	// ── من نحن (الجولة ٣٢) ──
	'about.heroAlt': 'أجواء مطعم سين‌شين',

	// ── نافذة القواعد (الجولة ٣٢) ──
	'terms.title': 'القواعد وشروط سين‌شين',
	'terms.readDone': 'قرأتها — رجوع',
	'terms.scrollHint': 'لتشغيل مربّع قبول القواعد، مرّر النص حتى نهاية هذه الصفحة',
	'terms.version': 'الإصدار',
	'terms.updated': 'التحديث',

	// ═══════════════════════════════════════════════════════════
	// الجولة ٣٣ — لوحة المستخدم + المكوّنات المشتركة + ترقيم الصفحات
	// ═══════════════════════════════════════════════════════════

	// ── عام (الجولة ٣٣) ──
	'common.save': 'حفظ',
	'common.saving': 'جارٍ الحفظ...',
	'common.error': 'خطأ',
	'common.edit': 'تعديل',
	'common.delete': 'حذف',

	// ── تنقّل لوحة المستخدم (الجولة ٣٣) ──
	'dash.nav.profile': 'ملفّي الشخصي',
	'dash.nav.orders': 'طلباتي',
	'dash.nav.wallet': 'المحفظة',
	'dash.nav.addresses': 'عناويني',
	'dash.nav.info': 'معلومات الحساب',
	'dash.logout': 'تسجيل الخروج',

	// ── أعمدة الجداول المشتركة (الجولة ٣٣) ──
	'dash.col.order': 'الطلب',
	'dash.col.address': 'العنوان',
	'dash.col.courier': 'الساعي',
	'dash.col.amount': 'المبلغ',
	'dash.col.id': 'المعرّف',
	'dash.col.orders': 'الطلبات',
	'dash.col.totalSpent': 'إجمالي الشراء',
	'dash.col.profit': 'ربحك',

	// ── نصوص مشتركة في اللوحة (الجولة ٣٣) ──
	'dash.itemCount': '{n} صنف',
	'dash.orderNumber': 'الطلب رقم {n}',
	'dash.delivery.pickup': 'تيك أواي (استلام حضوري)',
	'dash.delivery.dineIn': 'تقديم في الصالة',
	'dash.common.noReferrer': 'لم يُسجَّل أي مُحيل لك.',

	// ── الصفحة الرئيسية للوحة (الجولة ٣٣) ──
	'dash.home.welcome': 'أهلاً بك، {n} 👋',
	'dash.home.walletBalance': 'رصيد المحفظة',
	'dash.home.phone': 'رقم الهاتف المحمول',
	'dash.home.recentOrders': 'أحدث الطلبات',
	'dash.home.noOrders': 'لم تسجّل أي طلب بعد.',
	'dash.home.startShopping': 'ابدأ التسوّق',
	'dash.home.inviteFriends': 'دعوة الأصدقاء',
	'dash.home.inviteDesc':
		'عبر إرسال هذا الرابط إلى أصدقائك، في كل مرّة يسجّلون فيها طلباً، تُشحن نسبة من مبلغ طلبهم في محفظتك!',
	'dash.home.printQr': 'طباعة رمز QR',
	'dash.home.yourInviteLink': 'رابط دعوتك',
	'dash.home.copyLink': 'نسخ الرابط',
	'dash.home.linkCopied': 'تم نسخ رابط الدعوة!',
	'dash.home.myReferrals': 'إحالاتي',
	'dash.home.referralsHint': 'آخر ٣ أشخاص من إحالاتك قاموا بالشراء',
	'dash.home.noReferralPurchases': 'لم يقم أي من إحالاتك بالشراء حتى الآن.',
	'dash.home.printReferralText':
		'كود الإحالة الخاص بك، مع الاحترام والمحبة، سين شين',

	// ── طلباتي (الجولة ٣٣) ──
	'dash.orders.subtitle': 'عرض وتتبّع جميع طلباتك',
	'dash.orders.count': 'عدد الطلبات',
	'dash.orders.totalSpent': 'إجمالي المدفوعات',
	'dash.orders.history': 'سجلّ الطلبات',
	'dash.orders.sort.newest': 'الأحدث',
	'dash.orders.sort.oldest': 'الأقدم',
	'dash.orders.sort.expensive': 'الأغلى',
	'dash.orders.sort.cheap': 'الأرخص',
	'dash.orders.status': 'الحالة',
	'dash.orders.confirmDelivery': 'استلمت الطلب',
	'dash.orders.submitting': 'جارٍ التسجيل...',
	'dash.orders.empty': 'لم تسجّل أي طلب حتى الآن',
	'dash.orders.referralProfitTitle': 'ربح التسويق بالعمولة',
	'dash.orders.referralProfitDesc':
		'إجمالي الربح الذي وصل إلى مُحيلك من خلال طلباتك:',
	'dash.orders.yourReferrerCode': 'كود مُحيلك:',
	'dash.orders.deliverToast': 'تم تسجيل استلام الطلب',
	'dash.orders.deliverFailed': 'فشل تسجيل الاستلام',

	// ── تفاصيل الطلب (الجولة ٣٣) ──
	'dash.orderDetail.backToOrders': 'العودة إلى الطلبات',
	'dash.orderDetail.courierRoute': 'مسار حركة الساعي',
	'dash.orderDetail.details': 'تفاصيل الطلب',
	'dash.orderDetail.breakdownTitle': 'تفاصيل مبلغ الطلب',
	'dash.orderDetail.yourNote': 'ملاحظتك: ',
	'dash.orderDetail.deliveryInfo': 'معلومات التسليم',
	'dash.orderDetail.pickupNotice':
		'طلبك من نوع الاستلام الحضوري. استلم طلبك بالحضور إلى موقع سين شين.',
	'dash.orderDetail.deliveryAddress': 'عنوان التسليم',
	'dash.orderDetail.searchingCourier': 'نبحث عن ساعٍ لإرسال طلبك...',
	'dash.orderDetail.yourCourier': 'ساعي طلبك',
	'dash.orderDetail.callCourier': 'الاتصال بالساعي',
	'dash.orderDetail.deliveringCourier': 'الساعي المُسلِّم:',
	'dash.orderDetail.waitingCourier': 'بانتظار تعيين ساعٍ...',
	'dash.orderDetail.referralProfit': 'ربح المُحيل',
	'dash.orderDetail.referralProfitDesc':
		'الربح الذي وصل إلى مُحيلك من هذا الطلب:',
	'dash.orderDetail.referralProfitNote':
		'هذا المبلغ محسوب من الجزء المدفوع أونلاين في هذا الطلب فقط.',

	// ── الملاحظات والتقييم (الجولة ٣٣) ──
	'dash.feedback.title': 'ملاحظاتك',
	'dash.feedback.allDone':
		'تم تسجيل ملاحظات لجميع منتجات هذا الطلب. ستُعرض في صفحة المنتج بعد المراجعة.',
	'dash.feedback.formTitle': 'رأيك حول هذا الطلب',
	'dash.feedback.formDesc':
		'يمكنك تسجيل ملاحظة واحدة لكل منتج — تُعرض الملاحظات بعد المراجعة في صفحة المنتج نفسه.',
	'dash.feedback.placeholder':
		'شارك تجربتك مع هذا المنتج معنا ومع بقية العملاء...',
	'dash.feedback.sending': 'جارٍ الإرسال...',
	'dash.feedback.submit': 'إرسال الملاحظة',
	'dash.feedback.nothingLeft': 'لم يبقَ أي منتج لتقييمه.',
	'dash.feedback.thanksToast': 'شكراً لمشاركة رأيك معنا',

	// ── العناوين (الجولة ٣٣) ──
	'dash.addresses.subtitle': 'أدر عناوينك لتسليم الطلبات.',
	'dash.addresses.newAddress': 'عنوان جديد',
	'dash.addresses.empty': 'لم تسجّل أي عنوان بعد.',
	'dash.addresses.addFirst': 'تسجيل أول عنوان',
	'dash.addresses.deleteTitle': 'حذف العنوان',
	'dash.addresses.deleteConfirm': 'هل أنت متأكد من حذف هذا العنوان؟',
	'dash.addresses.coords': 'الإحداثيات:',
	'dash.addresses.editTitle': 'تعديل العنوان',
	'dash.addresses.addTitle': 'إضافة عنوان جديد',
	'dash.addresses.editedToast': 'تم تعديل العنوان بنجاح',
	'dash.addresses.addedToast': 'تمت إضافة العنوان الجديد بنجاح',
	'dash.addresses.deletedToast': 'تم حذف العنوان',
	'dash.addresses.pickLocationError': 'يرجى اختيار الموقع على الخريطة',
	'dash.addresses.titleLabel': 'العنوان',
	'dash.addresses.titlePlaceholder': 'مثلاً: المنزل، مكان العمل',
	'dash.addresses.addressLabel': 'العنوان الدقيق',
	'dash.addresses.addressPlaceholder': 'الشارع، الزقاق، رقم البناء...',

	// ── معلومات الحساب (الجولة ٣٣) ──
	'dash.info.userPrefix': 'المستخدم {n}',
	'dash.info.firstName': 'الاسم الأول',
	'dash.info.firstNamePlaceholder': 'مثال: علي',
	'dash.info.lastName': 'اسم العائلة',
	'dash.info.lastNamePlaceholder': 'مثال: رضائي',
	'dash.info.email': 'البريد الإلكتروني',
	'dash.info.saveChanges': 'حفظ التغييرات',
	'dash.info.savedToast': 'تم حفظ معلوماتك بنجاح',
	'dash.info.devicesTitle': 'الأجهزة المتصلة',
	'dash.info.devicesDesc':
		'وفقاً لقواعد الأمان في سين شين، يمكن لكل جهاز التسجيل برقم هاتف واحد فقط، ولا يمكن التسجيل برقم جديد على هذا الجهاز.',
	'dash.info.lastActive': 'آخر نشاط:',
	'dash.info.currentDevice': 'الجهاز الحالي',

	// ── المحفظة (الجولة ٣٣) ──
	'dash.wallet.title': 'محفظتي',
	'dash.wallet.subtitle': 'إدارة الرصيد والمعاملات المالية',
	'dash.wallet.currentBalance': 'رصيدك الحالي',
	'dash.wallet.chargeNote':
		'تُشحن محفظة سين شين عبر أرباح دعوة الأصدقاء فقط، ولا يمكن زيادتها من بوابة الدفع.',
	'dash.wallet.totalInviteProfit': 'إجمالي ربح الدعوات',
	'dash.wallet.referralsCount': 'عدد الإحالات',
	'dash.wallet.recentTxs': 'المعاملات الأخيرة',
	'dash.wallet.noTxs': 'لم يتم العثور على معاملات.',
	'dash.wallet.noReferrals': 'لم يسجّل أحد برمزك.',
	'dash.wallet.sort.newest': 'الأحدث',
	'dash.wallet.sort.oldest': 'الأقدم',
	'dash.wallet.sort.highest': 'المبلغ الأعلى',
	'dash.wallet.sort.lowest': 'المبلغ الأدنى',
	'dash.wallet.sort.income': 'وارد (دخل)',
	'dash.wallet.sort.expense': 'صادر (مصروف)',

	// ── ترقيم الصفحات (الجولة ٣٣) ──
	'pagination.showing': 'عرض',
	'pagination.to': 'إلى',
	'pagination.of': 'من',
	'pagination.items': 'عنصر',
	'pagination.itemCount': '{n} عنصر',

	// ── تفاصيل مبلغ الفاتورة (الجولة ٣٣) ──
	'bd.defaultTitle': 'تفاصيل مبلغ الفاتورة',
	'bd.free': 'مجاني',
	'bd.paidOnline': 'الدفع أونلاين:',

	// ── حالة الطلب — منظور العميل (الجولة ٣٣) ──
	'status.PENDING_PAYMENT': 'في انتظار الدفع',
	'status.PAID': 'مدفوع',
	'status.CONFIRMED': 'تم التأكيد',
	'status.ON_THE_WAY': 'في الطريق',
	'status.DELIVERED': 'تم التسليم',
	'status.PAYMENT_FAILED': 'فشل الدفع',
	'status.unknown': 'غير محدّد',

	// ── صفحات الاحتياط للمسارات (الجولة ٣٣) ──
	'rf.errorTitle': 'حدث خطأ!',
	'rf.errorUnknown': 'خطأ غير معروف',
	'rf.errorDesc': 'حدثت مشكلة في تحميل هذه الصفحة. حاول مرة أخرى.',
	'rf.home': 'الصفحة الرئيسية',
	'rf.notFoundCode': '٤٠٤',
	'rf.notFoundTitle': 'لم يتم العثور على الصفحة المطلوبة!',
	'rf.notFoundDesc': 'قد تكون هذه الصفحة محذوفة أو العنوان خاطئاً.',
	'rf.goProducts': 'الذهاب إلى المنتجات',
	'rf.loading': 'جارٍ التحميل',

	// ── قارئ QR (الجولة ٣٣) ──

	// ── الخريطة (الجولة ٣٣) ──
	'map.pickLocation': 'اختيار الموقع على الخريطة',
	'map.noKeyWarning':
		'لم يتم ضبط مفتاح خريطة نُشان — يمكنك إدخال الإحداثيات يدوياً، أو',
	'map.lat': 'خط العرض (lat)',
	'map.lng': 'خط الطول (lng)',
	// فاز-۲ — العنوان العكسي لنشان
	'map.loadingAddress': 'جارٍ البحث عن العنوان…',
	'map.addressFound': 'العنوان المختار:',

	// ── الإشعارات (فاز-۲) ──
	'notify.bell': 'الإشعارات',
	'notify.title': 'الإشعارات',
	'notify.unreadCount': '{n} غير مقروء',
	'notify.markAllRead': 'وضع علامة مقروء على الكل',
	'notify.enablePush': 'تفعيل الإشعارات على هذا الجهاز',
	'notify.enablePushHint':
		'بضغطة واحدة تصلك أخبار القسائم والطلبات على هاتفك — ويمكنك إيقافها في أي وقت.',
	'notify.pushUnsupported':
		'هذا المتصفح لا يدعم الإشعارات (على iOS يجب تثبيت التطبيق من «Add to Home Screen»).',
	'notify.pushEnabled': 'الإشعارات مفعّلة على هذا الجهاز',
	'notify.empty': 'لا إشعارات حاليًا',
	'notify.live': 'مباشر',

	// ── لوحة الإدارة: الإشعارات (فاز-۲) ──
	'admin.notify.title': 'إرسال إشعار',
	'admin.notify.subtitle':
		'رسالة لجميع مستخدمي الموقع — صندوق داخلي + دفع للهواتف',
	'admin.notify.notifTitle': 'العنوان (حد أقصى ١٢٠ حرفًا)',
	'admin.notify.body': 'النص (حد أقصى ٣٠٠ حرفًا)',
	'admin.notify.url': 'وجهة النقر (اختياري — مثل /products)',
	'admin.notify.send': 'إرسال للجميع',
	'admin.notify.sending': 'جارٍ الإرسال…',
	'admin.notify.sent': 'أُرسل إلى {n} مستخدمًا',
	'admin.notify.test': 'إرسال تجريبي لمستخدم واحد',
	'admin.notify.testUserId': 'معرّف المستخدم (UUID)',
	'admin.notify.sendTest': 'إرسال تجريبي',

	// ── stage-48 — التوفر وأوضاع الطلب ──
	'common.temporarilyUnavailable': 'غير متوفر حاليًا',
	'common.courierBadge': 'توصيل',
	'common.takeawayBadge': 'استلام',
	'common.dineInBadge': 'تقديم في المطعم',
	'common.modeAvailable': 'متاح',
	'common.modeUnavailable': 'غير متاح',
	'pdetail.unavailableNotice':
		'هذا المنتج غير متوفر حاليًا — سيكون قابلاً للطلب فور توفره مرة أخرى.',
	'pdetail.orderModesTitle': 'أوضاع طلب هذا المنتج',
	'pdetail.courierDesc': 'التوصيل بالدراج إلى عنوانك (مع أجر توصيل المنطقة).',
	'pdetail.takeawayDesc': 'استلم طلبك حضوريًا من سين شين.',
	'pdetail.dineInDesc': 'تقديم على الطاولة — بدون أجر تغليف.',
	'pdetail.modeRestricted': 'لا يمكن طلب هذا المنتج بهذا الوضع.',

	// ── stage-48 — السلة: تنبيهات برتقالية ──
	'cart.unavailableItem':
		'هذا المنتج غير متوفر حاليًا — يمكنك حذفه من السلة أو انتظار توفره.',
	'cart.noCourier': 'التوصيل بالدراج',
	'cart.noTakeaway': 'الاستلام الحضوري',
	'cart.noDineIn': 'التقديم في المطعم',
	'cart.modeRestrictionPrefix': 'هذا المنتج حاليًا لا يدعم',
	'cart.modeRestrictionSuffix': '.',
	'cart.blockedNotice':
		'سلتك تحتوي على منتج غير متوفر — لا يمكن إتمام الشراء حتى يتوفر أو تُزيله.',

	// ── stage-48 — الدفع: أقفال من الخادم ──
	'checkout.unavailableBlocked': 'المنتج «{n}» غير متوفر حاليًا — حدِّث السلة.',
	'checkout.deliveryBlocked':
		'وضع التسليم المختار غير متاح لـ«{n}» — غيِّر وضع التسليم أو أزِل المنتج.',
	'checkout.modeBlockedHint': 'غير متاح مؤقتًا بسبب «{n}»',
	'checkout.unavailableBannerTitle': 'بعض منتجات سلتك غير متوفرة حاليًا',
	'checkout.unavailableBannerBody':
		'إتمام هذا الطلب غير ممكن حتى تتوفر مجددًا. يمكنك الانتظار أو حذف المنتج من السلة.',

	// ── stage-48 — أيقونة تفعيل الإشعارات (الرأس) ──
	'notify.enable.title': 'تفعيل الإشعارات',
	'notify.enable.subtitle': 'أخبار القسائم والخصومات والطلبات على هذا الهاتف',
	'notify.enable.action': 'تفعيل الإشعارات',
	'notify.enable.busy': 'جارٍ التفعيل…',
	'notify.enable.done': 'تم تفعيل الإشعارات 🎉',
	'notify.enable.hint':
		'تأكيد واحد على هذا الجهاز فقط؛ ويمكنك إيقافه في أي وقت من إعدادات المتصفح. اضغط زر «{b}».',
	'notify.enable.deniedHint':
		'إذن الإشعارات مرفوض من إعدادات المتصفح — من إعدادات الموقع، اجعل «Notifications» = Allow.',
	'notify.enable.benefit1': 'قسيمة الخصم الخاصة بك تُعلَن لحظة استحقاقها',
	'notify.enable.benefit2': 'خصومات المنتجات المحددة المدة تراها قبل الجميع',
	'notify.enable.benefit3': 'تابع حالة طلبك وتسليم الدراج مباشرة',
	// stage-49 — فشل التفعيل (SW/المفتاح/الشبكة) — رسالة واضحة بدل تعليق الزر
	'notify.enable.retryHint':
		'لم يكتمل التفعيل — أعد المحاولة بعد لحظات؛ إذا تكرر، حدِّث الصفحة مرة واحدة.',

	// ── stage-48 — اللوحة: سجلّ الإرسال ──
	// stage-50 — حالة الرفض: خطوات واضحة + زر «إعادة فحص الإذن»
	// (كانت هذه الحالة نهاية مسدودة — بلا أي زر)
	'notify.enable.deniedStep1': 'في شريط العنوان، انقر على أيقونة القفل/إعدادات الموقع.',
	'notify.enable.deniedStep2': 'ابحث عن «Notifications» واجعلها Allow.',
	'notify.enable.deniedStep3': 'عُد إلى هذه النافذة واضغط «إعادة فحص الإذن».',
	'notify.enable.recheck': 'إعادة فحص الإذن',

	// stage-51 — رسالة «المرحلة الدقيقة» لفشل التفعيل (بدل رسالة عامة)
	// (الكونسول أيضًا يسجّل كل فشل مع حالة HTTP — بلا رموز)
	'notify.enable.errKey':
		'تعذّر جلب مفتاح الإشعارات من الخادم — تحقق من الاتصال وأعد المحاولة.',
	'notify.enable.errSubscribe':
		'رفض المتصفح تسجيل الاشتراك — أعد المحاولة؛ إذا تكرر، تحقق من إذن الإشعارات في إعدادات المتصفح.',
	'notify.enable.errRegister':
		'لم يُسجَّل الاشتراك لدى الخادم — أعد المحاولة بعد لحظة.',
	'notify.enable.errInvalid':
		'بيانات الاشتراك لم تكتمل — حدِّث الصفحة مرة وأعد المحاولة.',

	'admin.notify.historyTitle': 'سجلّ الإرسال',
}
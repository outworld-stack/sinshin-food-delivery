// ═══════════════════════════════════════════════════════════════
// round-48 — sinshin-food-delivery — فایل 73 از 97
// مسیر مقصد: apps/web/src/i18n/fa.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage forty-three
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// phase-2 — sinshin-food-delivery
// مسیر مقصد: apps/web/src/i18n/fa.ts
// تغییر: کلیدهای نوتیفیکیشن + آدرس نقشه
// ═══════════════════════════════════════════════════════════════

// src/i18n/fa.ts
// رارد ۳۱ — زیرساخت دوزبانه؛ رارد ۳۲ — گسترش به کل سایت اصلی.
// شکلِ این فایل «منبع حقیقت» تایپ‌هاست: هر کلیدی که این‌جا باشد، فایل ar.ts
// هم موظف است داشته باشد (typeof fa) — اگر حتی یک کلید عربی جا بیفتد،
// tsc --noEmit قرارداد پروژه خطا می‌دهد.
export const fa = {
        // ── سوییچر زبان ──
        'switcher.farsi': 'فارسی',
        'switcher.arabic': 'العربية',

        // ── بنر مرورگر قدیمی (رارد ۳۱) ──
        'banner.text': 'برای بهره‌مندی از امکانات سایت لطفاً مرورگر خود را آپدیت کنید.',
        'banner.close': 'بستن هشدار',

        // ── لندینگ (رارد ۳۱) ──
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

        // ── صفحه ورود (رارد ۳۱) ──
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

        // ── عمومی (رارد ۳۲) ──
        'common.back': 'بازگشت',
        'common.toman': 'تومان',
        'common.tomanShort': 'ت',
        'common.pcs': 'عدد',
        'common.all': 'همه',
        'common.allItems': 'همه موارد',
        'common.close': 'بستن',
        'common.cancel': 'انصراف',
        'common.yes': 'بله',
        'common.retry': 'تلاش مجدد',
        'common.scrollTop': 'بازگشت به بالا',
        'common.discountBadge': '{n}٪ تخفیف',

        // ── شمارنده‌ی معکوس تخفیف زمان‌دار (stage-47) ──
        'common.offerEndsIn': 'پایان تخفیف',
        'common.timeDay': 'روز',
        'common.timeHour': 'ساعت',
        'common.timeMin': 'دقیقه',
        'common.timeSec': 'ثانیه',

        // ── هدر (رارد ۳۲) ──
        'header.adminPanel': 'پنل مدیریت',
        'header.ordersPanel': 'پنل سفارشات',
        'header.trackOrder': 'پیگیری سفارش',
        'header.cart': 'سبد خرید',
        'header.profile': 'پروفایل',
        'header.auth': 'ورود / ثبت‌نام',

        // ── فوتر (رارد ۳۲) ──
        'footer.about': 'درباره ما',
        'footer.gallery': 'گالری',
        'footer.articles': 'مقالات',
        'footer.contact': 'تماس با ما',
        'footer.brandDesc':
                'فودپارک سین شین؛ تجربه‌ای متفاوت از سفارش آنلاین غذا. طعم زندگی، درِ خانه شما، در سریع‌ترین زمان ممکن.',
        'footer.address': 'بندرانزلی ، کیلومتر یک پاسداران',
        'footer.hours': 'هر روز ۱۱ صبح تا ۱۲ شب',
        'footer.instagram': 'اینستاگرام',
        'footer.rights': '© {n} سین شین — تمامی حقوق محفوظ است',
        'footer.madeWith': 'طراحی و توسعه با ❤️ در سین شین',

        // ── صفحه‌ی دسترسی محدود (رارد ۳۲) ──
        'geo.code': '۴۰۳',
        'geo.title': 'دسترسی محدود است',
        'geo.message': 'لطفاً اگر از ایران هستید، لطفاً VPN خودتان را خاموش کنید و صفحه را رفرش کنید.',
        'geo.refresh': 'رفرش صفحه',
        // ── حالت «ایران + عراق» (رارد ۳۷ — وقتی دامنه‌ی خارج = فقط عراق) ──
        'geo.title.iraq': 'دسترسی فقط از ایران و عراق',
        'geo.message.iraq':
                'این سرویس فقط برای کاربران داخل ایران و عراق در دسترس است. اگر داخل یکی از این دو کشور هستید، لطفاً VPN خود را خاموش کنید و صفحه را رفرش کنید.',

        // ── ریدایرکت معرف (رارد ۳۲) ──
        'referral.redirecting': 'در حال انتقال به صفحه‌ی ورود…',

        // ── اسکرولر دسته‌ها (رارد ۳۲) ──
        'scroller.scrollRight': 'اسکرول به راست',
        'scroller.scrollLeft': 'اسکرول به چپ',

        // ── حالت خالی پیش‌فرض (رارد ۳۲) ──
        'empty.title': 'محصولی یافت نشد',
        'empty.desc': 'در حال حاضر محصولی در این دسته‌بندی وجود ندارد. بعداً دوباره بررسی کنید.',

        // ── صفحه‌ی محصولات (رارد ۳۲) ──
        'products.title': 'منوی محصولات سین‌شین',
        'products.filterSort': 'فیلتر و مرتب‌سازی',
        'products.sortBy': 'مرتب‌سازی بر اساس:',
        'products.applyFilters': 'اعمال فیلترها',
        'products.emptyTitle': 'محصولی در این دسته یافت نشد',
        'products.emptyDesc': 'در حال حاضر محصولی برای این دسته‌بندی موجود نیست.',
        'products.loadMore': 'مشاهده محصولات بیشتر',
        'products.sort.newest': 'جدیدترین',
        'products.sort.mostViewed': 'پربازدیدترین',
        'products.sort.bestSelling': 'پرفروش‌ترین',
        'products.sort.fastestPrep': 'سریع‌ترین آماده‌سازی',
        'products.sort.expensive': 'گران‌ترین',
        'products.sort.cheap': 'ارزان‌ترین',

        // ── صفحه‌ی جزئیات محصول (رارد ۳۲) ──
        'pdetail.category': 'دسته‌بندی',
        'pdetail.prepTime': 'آماده‌سازی در {n} دقیقه',
        'pdetail.sizeSelect': 'انتخاب سایز:',
        'pdetail.addToCart': 'افزودن به سبد خرید',
        'pdetail.addedToast': '{n} به سبد اضافه شد!',
        'pdetail.ingredients': 'محتویات محصول',
        'pdetail.reviews': 'نظرات مشتریان',
        'pdetail.noReviews': 'نظری برای این محصول تاکنون ثبت و تایید نشده است',
        'pdetail.anonUser': 'کاربر',

        // ── سبد خرید (رارد ۳۲) ──
        'cart.title': 'سبد خرید',
        'cart.clear': 'خالی کردن سبد',
        'cart.emptyTitle': 'سبد خرید شما خالی است',
        'cart.emptyDesc': 'هنوز محصولی به سبد خرید اضافه نکرده‌اید. می‌توانید منوی محصولات را مشاهده کنید.',
        'cart.viewProducts': 'مشاهده محصولات',
        'cart.priceError': 'قیمت‌های سبد از سرور دریافت نشد. اتصال یا موارد سبد را بررسی کنید.',
        'cart.summary': 'خلاصه سفارش',
        'cart.itemCount': 'تعداد کل اقلام',
        'cart.totalAmount': 'مبلغ کل',
        'cart.savings': 'سود از خرید شما',
        'cart.finalAmount': 'مبلغ نهایی پرداخت',
        'cart.continue': 'ادامه فرآیند خرید',
        'cart.clearedToast': 'سبد خرید خالی شد',
        'cart.removedToast': 'محصول از سبد حذف شد',
        'cart.clearTitle': 'خالی کردن سبد خرید',
        'cart.clearMessage': 'آیا از خالی کردن سبد خرید خود مطمئن هستید؟ تمام محصولات از سبد شما حذف خواهند شد.',
        'cart.unavailable': 'محصولی در سبد شما موجود نیست',
        'cart.unavailableHint': 'این محصول حذف شده یا موقتاً غیرفعال است و قابل سفارش نیست — از سبد خارجش کنید.',
        'cart.incQty': 'افزایش تعداد',
        'cart.decQty': 'کاهش تعداد',
        'cart.removeItem': 'حذف محصول',
        'cart.removeUnavailable': 'حذف محصول ناموجود از سبد',
        'cart.lineTotal': 'جمع کل',

        // ── تسویه حساب (رارد ۳۲) ──
        'checkout.title': 'تسویه حساب',
        'checkout.loginRequired': 'برای ادامه خرید باید وارد شوید',
        'checkout.deliveryTitle': 'نوع تحویل سفارش',
        'checkout.courier': 'ارسال با پیک',
        'checkout.courierFee': '{n} + هزینه بسته‌بندی',
        'checkout.inPerson': 'تحویل حضوری',
        'checkout.inPersonSub': 'سرو در محل یا بیرون‌بر',
        'checkout.chooseInPerson': 'حالت تحویل حضوری را انتخاب کنید:',
        'checkout.dineIn': 'سرو در محل سین‌شین',
        'checkout.dineInFree': 'بدون هزینه بسته‌بندی',
        'checkout.pickup': 'تحویل گرفتن از سین‌شین (بیرون‌بر)',
        'checkout.pickupFee': 'با {n} هزینه بسته‌بندی',
        'checkout.pickupFeeGeneric': 'با هزینه بسته‌بندی',
        'checkout.couponTitle': 'کد تخفیف',
        'checkout.noCoupon': 'ندارم',
        'checkout.haveCoupon': 'دارم',
        'checkout.couponPlaceholder': 'کد تخفیف (مثال: SINSHIN20)',
        'checkout.applyCode': 'اعمال کد',
        'checkout.appliedCode': 'اعمال شد',
        'checkout.payTitle': 'روش پرداخت',
        'checkout.wallet': 'کسر از کیف پول',
        'checkout.balance': 'موجودی: {n}',
        'checkout.noBalance': 'موجودی کیف پول ندارید',
        'checkout.walletShare': '{n} از مبلغ غذاها کسر می‌شود',
        'checkout.gatewayNoteDelivery': 'هزینه ارسال و بسته‌بندی باید با درگاه پرداخت شود و امکان کسر آن از موجودی کیف پول وجود ندارد.',
        'checkout.gatewayNotePickup': 'هزینه بسته‌بندی باید با درگاه پرداخت شود و امکان کسر آن از موجودی کیف پول وجود ندارد.',
        'checkout.covered': 'مبلغ این سفارش کامل پوشش داده شده — پرداختی ندارید:',
        'checkout.allFromWallet': 'کل مبلغ از کیف پول شما کسر می‌شود:',
        'checkout.payViaGateway': 'پرداخت {n} از درگاه بانکی:',
        'checkout.gateway.MOCK': 'درگاه تست (دمو)',
        'checkout.gateway.ZARINPAL': 'زرین‌پال',
        'checkout.gateway.PAYIR': 'پی‌ایر',
        'checkout.gateway.SEP': 'بانک سامان',
        'checkout.gateway.MELLAT': 'بانک ملت',
        'checkout.addressTitle': 'آدرس تحویل',
        'checkout.newAddress': 'آدرس جدید',
        'checkout.noAddress': 'شما هنوز آدرسی ثبت نکرده‌اید',
        'checkout.firstAddress': 'ثبت اولین آدرس',
        'checkout.addAddressTitle': 'افزودن آدرس جدید',
        'checkout.titlePlaceholder': 'عنوان (مثلاً: خانه، محل کار)',
        'checkout.addressPlaceholder': 'آدرس دقیق',
        'checkout.pickLocation': 'لطفاً موقعیت را روی نقشه انتخاب کنید',
        'checkout.addressAdded': 'آدرس جدید اضافه شد',
        'checkout.saving': 'در حال ذخیره...',
        'checkout.save': 'ذخیره',
        'checkout.noteTitle': 'نظرات مشتری',
        'checkout.noteHint': 'اگر نکته‌ای برای سفارش دارید بنویسید؛ مثلاً: «اگر پیک رسید کمی صبر کند، ممکن است دیر برسیم.»',
        'checkout.notePlaceholder': 'یادداشت شما برای این سفارش...',
        'checkout.foodAmount': 'مبلغ غذاها',
        'checkout.couponDiscount': 'تخفیف کوپن',
        'checkout.walletLine': 'کسر از کیف پول',
        'checkout.deliveryFee': 'هزینه ارسال',
        'checkout.packagingFee': 'هزینه بسته‌بندی',
        'checkout.dineInLine': 'سرو در محل',
        'checkout.dineInFreeLine': 'بدون هزینه ارسال و بسته‌بندی',
        'checkout.finalTitle': 'مبلغ نهایی',
        'checkout.fromWallet': 'از کیف پول +',
        'checkout.fromGateway': 'از درگاه',
        'checkout.payableOnline': 'مبلغ قابل پرداخت آنلاین:',
        'checkout.submitFree': 'ثبت نهایی سفارش',
        'checkout.submitPay': 'پرداخت و ثبت نهایی سفارش',
        'checkout.processing': 'در حال پردازش...',
        'checkout.closedTitle': 'رستوران در حال حاضر بسته است',
        'checkout.closedNote': 'بعد از پرداخت، سفارش شما در اولین زمان ممکن بعد از باز شدن رستوران برایتان ارسال می‌شود.',
        'checkout.closedSummary': 'مغازه در حال حاضر بسته است، سفارش شما بعد از پرداخت بعد ({n}) برایتان ارسال می‌شود.',
        'checkout.openTime': 'ساعت باز شدن: {n}',
        'checkout.closeReason': 'دلیل:',
        'checkout.noCancel': 'با ثبت و پرداخت این سفارش، امکان لغو آن وجود ندارد — در صورت ناموفق بودن پرداخت، سفارش با وضعیت «پرداخت ناموفق» ثبت می‌شود.',
        'checkout.couponApplied': 'کد تخفیف اعمال شد ({n})',
        'checkout.couponInvalid': 'کد تخفیف نامعتبر است',
        'checkout.priceError': 'خطا در محاسبه‌ی قیمت — دوباره تلاش کنید',
        'checkout.enterCoupon': 'لطفاً کد تخفیف را وارد کنید',
        'checkout.orderPlaced': 'سفارش شما ثبت شد!',
        'checkout.paySuccess': 'پرداخت موفق — سفارش ثبت شد',
        'checkout.payFailed': 'پرداخت ناموفق — سفارش لغو شد؛ سبد شما حفظ شده است',
        'checkout.payError': 'خطا در پرداخت',
        'checkout.orderProcessFail': 'پردازش سفارش ناموفق بود',
        'checkout.orderProcessError': 'خطا در پردازش سفارش',
        'checkout.pickAddress': 'لطفاً آدرس تحویل را انتخاب کنید',
        'checkout.fixPriceError': 'ابتدا خطای قیمت‌گذاری را برطرف کنید',
        'checkout.applyOrRemoveCoupon': 'ابتدا کد تخفیف را اعمال یا حذف کنید',

        // ── مقالات (رارد ۳۲) ──
        'articles.title': 'مقالات سین‌شین',
        'articles.filterSort': 'فیلتر و مرتب‌سازی',
        'articles.filtersTitle': 'فیلترهای مقالات',
        'articles.subFilter': 'دسته‌بندی دقیق‌تر:',
        'articles.sortBy': 'مرتب‌سازی بر اساس:',
        'articles.applyFilters': 'اعمال فیلترها',
        'articles.emptyTitle': 'مقاله‌ای یافت نشد',
        'articles.emptyDesc': 'در حال حاضر مقاله‌ای در این دسته‌بندی وجود ندارد.',
        'articles.loadMore': 'مشاهده مقالات بیشتر',
        'articles.process': 'روند تهیه',
        'articles.tags': 'تگ‌ها:',
        'articles.sort.newest': 'جدیدترین',
        'articles.sort.mostViewed': 'پربازدیدترین',

        // ── گالری (رارد ۳۲) ──
        'gallery.title': 'سین شین ما',
        'gallery.subtitle': 'با محیطی آرام آرامش چشیدن طعم غذای لذیذ ما را تجربه کنید',
        'gallery.zoom': 'بزرگ‌نمایی',
        'gallery.alt': 'تصویر {n} گالری',

        // ── درباره ما (رارد ۳۲) ──
        'about.heroAlt': 'محیط رستوران سین‌شین',

        // ── مدال قوانین (رارد ۳۲) ──
        'terms.title': 'قوانین و شرایط سین‌شین',
        'terms.readDone': 'خواندم — بازگشت',
        'terms.scrollHint': 'برای فعال شدن چک‌باکس قوانین، متن را تا انتهای همین صفحه اسکرول کنید',
        'terms.version': 'نسخه',
        'terms.updated': 'به‌روزرسانی',

        // ═══════════════════════════════════════════════════════════
        // رارد ۳۳ — پنل کاربر (داشبورد) + کامپوننت‌های مشترک + صفحه‌بندی
        // ═══════════════════════════════════════════════════════════

        // ── عمومی (رارد ۳۳) ──
        'common.save': 'ذخیره',
        'common.saving': 'در حال ذخیره...',
        'common.error': 'خطا',
        'common.edit': 'ویرایش',
        'common.delete': 'حذف',

        // ── ناوبری داشبورد (رارد ۳۳) ──
        'dash.nav.profile': 'پروفایل من',
        'dash.nav.orders': 'سفارشات من',
        'dash.nav.wallet': 'کیف پول',
        'dash.nav.addresses': 'آدرس‌های من',
        'dash.nav.info': 'اطلاعات کاربری',
        'dash.logout': 'خروج از حساب',

        // ── ستون‌های مشترک جدول‌ها (رارد ۳۳) ──
        'dash.col.order': 'سفارش',
        'dash.col.address': 'آدرس',
        'dash.col.courier': 'پیک',
        'dash.col.amount': 'مبلغ',
        'dash.col.id': 'شناسه',
        'dash.col.orders': 'سفارشات',
        'dash.col.totalSpent': 'مجموع خرید',
        'dash.col.profit': 'سود شما',

        // ── رشته‌های مشترک داشبورد (رارد ۳۳) ──
        'dash.itemCount': '{n} کالا',
        'dash.orderNumber': 'سفارش شماره {n}',
        'dash.delivery.pickup': 'بیرون‌بر (تحویل حضوری)',
        'dash.delivery.dineIn': 'سرو در سالن',
        'dash.common.noReferrer': 'شما معرفی‌ای نداشته‌اید.',

        // ── خانه‌ی داشبورد (رارد ۳۳) ──
        'dash.home.welcome': 'خوش آمدید، {n} 👋',
        'dash.home.walletBalance': 'موجودی کیف پول',
        'dash.home.phone': 'شماره موبایل',
        'dash.home.recentOrders': 'سفارش‌های اخیر',
        'dash.home.noOrders': 'شما هنوز سفارشی ثبت نکرده‌اید.',
        'dash.home.startShopping': 'شروع خرید',
        'dash.home.inviteFriends': 'دعوت دوستان',
        'dash.home.inviteDesc':
                'با ارسال این لینک به دوستانتان، هر بار که آن‌ها سفارشی ثبت کنند، درصدی از مبلغ سفارش آن‌ها در کیف پول شما شارژ می‌شود!',
        'dash.home.printQr': 'پرینت QR کد',
        'dash.home.yourInviteLink': 'لینک دعوت شما',
        'dash.home.copyLink': 'کپی لینک',
        'dash.home.linkCopied': 'لینک دعوت کپی شد!',
        'dash.home.myReferrals': 'زیرمجموعه‌های من',
        'dash.home.referralsHint': '۳ نفر آخر از زیرمجموعه‌های شما که اقدام به خرید کرده‌اند',
        'dash.home.noReferralPurchases': 'تا کنون هیچ‌یک از زیرمجموعه‌های شما خریدی نکرده‌اند.',
        'dash.home.printReferralText': 'کد معرف شما ، با احترام و عشق ، سین شین',

        // ── سفارشات من (رارد ۳۳) ──
        'dash.orders.subtitle': 'مشاهده و پیگیری تمامی سفارشات شما',
        'dash.orders.count': 'تعداد سفارشات',
        'dash.orders.totalSpent': 'مجموع پرداخت‌ها',
        'dash.orders.history': 'تاریخچه سفارشات',
        'dash.orders.sort.newest': 'جدیدترین',
        'dash.orders.sort.oldest': 'قدیمی‌ترین',
        'dash.orders.sort.expensive': 'گران‌ترین',
        'dash.orders.sort.cheap': 'ارزان‌ترین',
        'dash.orders.status': 'وضعیت',
        'dash.orders.confirmDelivery': 'تحویل گرفتم',
        'dash.orders.submitting': 'در حال ثبت...',
        'dash.orders.empty': 'شما تاکنون سفارشی ثبت نکرده‌اید',
        'dash.orders.referralProfitTitle': 'سود همکاری در فروش',
        'dash.orders.referralProfitDesc': 'مجموع سودی که با سفارش‌های شما به معرفتان رسیده است:',
        'dash.orders.yourReferrerCode': 'کد معرف شما:',
        'dash.orders.deliverToast': 'تحویل سفارش ثبت شد',
        'dash.orders.deliverFailed': 'ثبت تحویل ناموفق بود',

        // ── جزئیات سفارش (رارد ۳۳) ──
        'dash.orderDetail.backToOrders': 'بازگشت به سفارشات',
        'dash.orderDetail.courierRoute': 'مسیر حرکت پیک',
        'dash.orderDetail.details': 'جزئیات سفارش',
        'dash.orderDetail.breakdownTitle': 'ریز مبلغ سفارش',
        'dash.orderDetail.yourNote': 'یادداشت شما: ',
        'dash.orderDetail.deliveryInfo': 'اطلاعات تحویل',
        'dash.orderDetail.pickupNotice':
                'سفارش شما از نوع تحویل حضوری است. با مراجعه به محل سین شین سفارش خود را تحویل بگیرید.',
        'dash.orderDetail.deliveryAddress': 'آدرس تحویل',
        'dash.orderDetail.searchingCourier': 'در حال جستجوی پیک برای ارسال سفارش شما هستیم...',
        'dash.orderDetail.yourCourier': 'پیک سفارش شما',
        'dash.orderDetail.callCourier': 'تماس با پیک',
        'dash.orderDetail.deliveringCourier': 'پیک تحویل‌دهنده:',
        'dash.orderDetail.waitingCourier': 'منتظر تخصیص پیک...',
        'dash.orderDetail.referralProfit': 'سود معرف',
        'dash.orderDetail.referralProfitDesc': 'سودی که از این سفارش به معرف شما رسیده است:',
        'dash.orderDetail.referralProfitNote':
                'این مبلغ صرفاً از بخش پرداخت آنلاین این سفارش محاسبه شده است.',

        // ── بازخورد/نظر (رارد ۳۳) ──
        'dash.feedback.title': 'بازخورد شما',
        'dash.feedback.allDone':
                'برای تمام محصولات این سفارش نظر ثبت شد. پس از بررسی، در صفحه‌ی محصول نمایش داده می‌شود.',
        'dash.feedback.formTitle': 'نظر شما درباره این سفارش',
        'dash.feedback.formDesc':
                'برای هر محصول می‌توانید یک نظر ثبت کنید — نظرها پس از بررسی در صفحه‌ی همان محصول نمایش داده می‌شوند.',
        'dash.feedback.placeholder': 'تجربه‌تان از این محصول را با ما و دیگر مشتریان به اشتراک بگذارید...',
        'dash.feedback.sending': 'در حال ارسال...',
        'dash.feedback.submit': 'ارسال نظر',
        'dash.feedback.nothingLeft': 'محصول قابل نظردادن باقی نمانده است.',
        'dash.feedback.thanksToast': 'از اینکه نظرتان را با ما به اشتراک گذاشتید ممنونیم',

        // ── آدرس‌ها (رارد ۳۳) ──
        'dash.addresses.subtitle': 'آدرس‌های خود را برای تحویل سفارشات مدیریت کنید.',
        'dash.addresses.newAddress': 'آدرس جدید',
        'dash.addresses.empty': 'شما هنوز آدرسی ثبت نکرده‌اید.',
        'dash.addresses.addFirst': 'ثبت اولین آدرس',
        'dash.addresses.deleteTitle': 'حذف آدرس',
        'dash.addresses.deleteConfirm': 'آیا از حذف این آدرس مطمئن هستید؟',
        'dash.addresses.coords': 'مختصات:',
        'dash.addresses.editTitle': 'ویرایش آدرس',
        'dash.addresses.addTitle': 'افزودن آدرس جدید',
        'dash.addresses.editedToast': 'آدرس با موفقیت ویرایش شد',
        'dash.addresses.addedToast': 'آدرس جدید با موفقیت اضافه شد',
        'dash.addresses.deletedToast': 'آدرس حذف شد',
        'dash.addresses.pickLocationError': 'لطفاً موقعیت را روی نقشه انتخاب کنید',
        'dash.addresses.titleLabel': 'عنوان',
        'dash.addresses.titlePlaceholder': 'مثلاً: خانه، محل کار',
        'dash.addresses.addressLabel': 'آدرس دقیق',
        'dash.addresses.addressPlaceholder': 'خیابان، کوچه، پلاک و...',

        // ── اطلاعات کاربری (رارد ۳۳) ──
        'dash.info.userPrefix': 'کاربر {n}',
        'dash.info.firstName': 'نام',
        'dash.info.firstNamePlaceholder': 'مثال: علی',
        'dash.info.lastName': 'نام خانوادگی',
        'dash.info.lastNamePlaceholder': 'مثال: رضایی',
        'dash.info.email': 'ایمیل',
        'dash.info.saveChanges': 'ذخیره تغییرات',
        'dash.info.savedToast': 'اطلاعات شما با موفقیت ذخیره شد',
        'dash.info.devicesTitle': 'دستگاه‌های متصل',
        'dash.info.devicesDesc':
                'بر اساس قوانین امنیتی سین‌شین، هر دستگاه فقط می‌تواند با یک شماره موبایل ثبت‌نام کند و امکان ثبت‌نام با شماره جدید روی همین دستگاه وجود ندارد.',
        'dash.info.lastActive': 'آخرین فعالیت:',
        'dash.info.currentDevice': 'دستگاه فعلی',

        // ── کیف پول (رارد ۳۳) ──
        'dash.wallet.title': 'کیف پول من',
        'dash.wallet.subtitle': 'مدیریت موجودی و تراکنش‌های مالی',
        'dash.wallet.currentBalance': 'موجودی فعلی شما',
        'dash.wallet.chargeNote':
                'کیف پول سین‌شین فقط از طریق سود معرفی دوستان شارژ می‌شود و امکان افزایش آن از درگاه پرداخت وجود ندارد.',
        'dash.wallet.totalInviteProfit': 'سود کلی از دعوت',
        'dash.wallet.referralsCount': 'تعداد زیرمجموعه‌ها',
        'dash.wallet.recentTxs': 'تراکنش‌های اخیر',
        'dash.wallet.noTxs': 'تراکنشی یافت نشد.',
        'dash.wallet.noReferrals': 'کسی با کد شما ثبت‌نام نکرده است.',
        'dash.wallet.sort.newest': 'جدیدترین',
        'dash.wallet.sort.oldest': 'قدیمی‌ترین',
        'dash.wallet.sort.highest': 'بیشترین مبلغ',
        'dash.wallet.sort.lowest': 'کمترین مبلغ',
        'dash.wallet.sort.income': 'ورودی (درآمد)',
        'dash.wallet.sort.expense': 'خروجی (هزینه)',

        // ── صفحه‌بندی (رارد ۳۳) ──
        'pagination.showing': 'نمایش',
        'pagination.to': 'تا',
        'pagination.of': 'از',
        'pagination.items': 'مورد',
        'pagination.itemCount': '{n} مورد',

        // ── ریز مبلغ فاکتور (رارد ۳۳) ──
        'bd.defaultTitle': 'ریز مبلغ فاکتور',
        'bd.free': 'رایگان',
        'bd.paidOnline': 'پرداخت آنلاین:',

        // ── وضعیت سفارش — دید مشتری (رارد ۳۳) ──
        'status.PENDING_PAYMENT': 'در انتظار پرداخت',
        'status.PAID': 'پرداخت شده',
        'status.CONFIRMED': 'تایید شد',
        'status.ON_THE_WAY': 'در مسیر',
        'status.DELIVERED': 'تحویل شد',
        'status.PAYMENT_FAILED': 'پرداخت ناموفق',
        'status.unknown': 'نامشخص',

        // ── پشتیبانِ روت (رارد ۳۳) ─ـ
        'rf.errorTitle': 'خطایی رخ داد!',
        'rf.errorUnknown': 'خطای ناشناخته',
        'rf.errorDesc': 'مشکلی در بارگذاری این صفحه پیش آمد. لطفاً دوباره تلاش کنید.',
        'rf.home': 'صفحه اصلی',
        'rf.notFoundCode': '۴۰۴',
        'rf.notFoundTitle': 'صفحه مورد نظر پیدا نشد!',
        'rf.notFoundDesc': 'ممکن است این صفحه حذف شده یا آدرس اشتباه باشد.',
        'rf.goProducts': 'رفتن به محصولات',
        'rf.loading': 'در حال بارگذاری',

        // ── اسکنر QR (رارد ۳۳) ──

        // ── نقشه (رارد ۳۳) ──
        'map.pickLocation': 'انتخاب موقعیت روی نقشه',
        'map.noKeyWarning': 'کلید نقشه‌ی نشان تنظیم نشده — می‌توانید مختصات را دستی وارد کنید، یا',
        'map.lat': 'عرض جغرافیایی (lat)',
        'map.lng': 'طول جغرافیایی (lng)',
        // فاز-۲ — آدرس معکوس نشان
        'map.loadingAddress': 'در حال یافتن آدرس…',
        'map.addressFound': 'آدرس انتخابی:',

        // ── نوتیفیکیشن (فاز-۲ — سیستم پوش کاستوم) ──
        'notify.bell': 'اطلاعیه‌ها',
        'notify.title': 'اطلاعیه‌ها',
        'notify.unreadCount': '{n} خوانده‌نشده',
        'notify.markAllRead': 'همه را خوانده‌شده کن',
        'notify.enablePush': 'فعال‌سازی نوتیفیکیشن روی این دستگاه',
        'notify.enablePushHint': 'با یک تایید، خبر کوپن‌ها و سفارش‌ها روی گوشی‌تان می‌رسد — هر زمان می‌توانید خاموش کنید.',
        'notify.pushUnsupported': 'این مرورگر پوش پشتیبانی نمی‌کند (iOS باید از «Add to Home Screen» نصب شود).',
        'notify.pushEnabled': 'پوش این دستگاه فعال است',
        'notify.empty': 'فعلاً اطلاعیه‌ای ندارید',
        'notify.live': 'زنده',

        // ── پنل ادمین: نوتیفیکیشن (فاز-۲) ──
        'admin.notify.title': 'ارسال نوتیفیکیشن',
        'admin.notify.subtitle': 'پیام به همه‌ی کاربران سایت — صندوق درون‌بری + پوش گوشی‌ها',
        'admin.notify.notifTitle': 'عنوان (حداکثر ۱۲۰ کاراکتر)',
        'admin.notify.body': 'متن (حداکثر ۳۰۰ کاراکتر)',
        'admin.notify.url': 'مقصد کلیک (اختیاری — مثل /products)',
        'admin.notify.send': 'ارسال به همه',
        'admin.notify.sending': 'در حال ارسال…',
        'admin.notify.sent': 'برای {n} کاربر ارسال شد',
        'admin.notify.test': 'ارسال تست به یک کاربر',
        'admin.notify.testUserId': 'شناسه‌ی کاربر (UUID)',
        'admin.notify.sendTest': 'ارسال تست',
} as const

/** کلیدها از fa؛ مقادیر گسترده به string تا ar بتواند مقدار خودش را بگذارد */
export type Dict = { [K in keyof typeof fa]: string }
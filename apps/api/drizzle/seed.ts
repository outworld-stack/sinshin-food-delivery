// ═══════════════════════════════════════════════════════════════
// round-37 — sinshin-food-delivery — فایل 1 از 17
// مسیر مقصد: apps/api/drizzle/seed.ts
// وضعیت: جایگزینی کامل فایل موجود
// کامیت پیشنهادی: stage thirty-three
// ═══════════════════════════════════════════════════════════════

// drizzle/seed.ts
/**
 * Seed v3 — دوزبانه (فارسی + عربی) · transactional (همه یا هیچ) · idempotent.
 *   bun run db:seed
 *
 * رارد ۳۷ — چه چیزی نسبت به v2 تغییر کرد؟
 *  ① همه‌ی محتوای seed حالا ستون‌های عربیِ رارد ۳۴ را هم پر می‌کند
 *     (name_ar / description_ar / ingredients_ar / size_names_ar /
 *     sections_ar / title_ar / ... ) — نسخه‌ی عربی سایت دیگر fallback
 *     فارسی نشان نمی‌دهد.
 *  ② روی دیتابیسِ «از قبل seed شده» هم امن است: ردیف‌های موجود دست نمی‌خورند؛
 *     فقط جایی که ستون عربی NULL است، همان ردیف‌های seed-شکل backfill
 *     می‌شوند (با کلید طبیعی: slug / version / src / name / title).
 *     یعنی: bun run db:seed دوباره = فقط پرکردن عربیِ خالی‌ها.
 *  ③ دو کلید جغرافیایی پیش‌فرض هم همراه بقیه‌ی settings ثبت می‌شود:
 *     iran_only_access = true و outside_access_scope = 'iraq'
 *     (هر دو onConflictDoNothing — مقدار دستی ادمین را بازنویسی نمی‌کنند).
 *
 * محتوای عربی برای مخاطب عراقی نوشته شده (عربی استاندارد مدرن + ارقام
 * عربی-هندی ٠١٢٣ مثل فرمتر ar-EG پروژه).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import { AppConfig } from '#/infra/config/env'
import { Database } from '#/infra/db/client'
import {
  categories,
  contentAbout,
  coupons,
  galleryImages,
  deliveryZones,
  mainCategories,
  productSizes,
  products,
  settings,
  terms,
  articleCategories,
  articleSubCategories,
  articles,
} from '#/infra/db/schema'
import { asCategoryId } from '#/domain/shared/brand'

const config = new AppConfig()
const database = new Database(config.databaseUrl, { max: 2 })
const db = database.db

console.log('[seed] started (v3 — bilingual fa+ar)...')

await db.transaction(async (tx) => {
  // ── دسته‌های اصلی (slug یکتا → upsert با coalesce: عربی فقط اگر خالی باشد) ──
  await tx
    .insert(mainCategories)
    .values([
      { name: 'رستوران', nameAr: 'مطعم', slug: 'restaurant', isActive: true, isDefault: true, sortOrder: 1 },
      { name: 'فست‌فود', nameAr: 'وجبات سريعة', slug: 'fastfood', isActive: true, isDefault: false, sortOrder: 2 },
    ])
    .onConflictDoUpdate({
      target: mainCategories.slug,
      set: {
        nameAr: sql`coalesce(${mainCategories.nameAr}, excluded.name_ar)`,
      },
    })

  const mainBy = async (slug: string) =>
    (await tx.select().from(mainCategories).where(eq(mainCategories.slug, slug)).limit(1))[0]
  const restaurantMain = await mainBy('restaurant')
  const fastfoodMain = await mainBy('fastfood')

  if (restaurantMain && fastfoodMain) {
    await tx
      .insert(categories)
      .values([
        { mainCategoryId: restaurantMain.id, name: 'ساندویچ', nameAr: 'شطائر', slug: 'sandwich' },
        { mainCategoryId: restaurantMain.id, name: 'سالاد', nameAr: 'سلطات', slug: 'salad' },
        { mainCategoryId: restaurantMain.id, name: 'پاستا', nameAr: 'معكرونة', slug: 'pasta' },
        { mainCategoryId: restaurantMain.id, name: 'پیش‌غذا', nameAr: 'مقبلات', slug: 'appetizer' },
        {
          mainCategoryId: fastfoodMain.id,
          name: 'پیتزا',
          nameAr: 'بيتزا',
          slug: 'pizza',
          hasSizes: true,
          sizeNames: ['کوچک', 'متوسط', 'بزرگ', 'خانوادگی'],
          sizeNamesAr: ['صغير', 'متوسط', 'كبير', 'عائلي'],
        },
        { mainCategoryId: fastfoodMain.id, name: 'برگر', nameAr: 'برجر', slug: 'burger' },
        { mainCategoryId: fastfoodMain.id, name: 'نوشیدنی', nameAr: 'مشروبات', slug: 'drinks' },
        { mainCategoryId: fastfoodMain.id, name: 'دسر', nameAr: 'حلويات', slug: 'dessert' },
      ])
      .onConflictDoUpdate({
        target: categories.slug,
        set: {
          nameAr: sql`coalesce(${categories.nameAr}, excluded.name_ar)`,
          sizeNamesAr: sql`coalesce(${categories.sizeNamesAr}, excluded.size_names_ar)`,
        },
      })
  }

  // ── تنظیمات (onConflictDoNothing — دست ادمین را بازنویسی نمی‌کند) ──
  await tx
    .insert(settings)
    .values([
      { key: 'restaurant_open', value: true },
      { key: 'next_open_time', value: '۱۱:۰۰ صبح' },
      { key: 'temporarily_closed', value: false },
      { key: 'live_tracking_enabled', value: false },
      // stage-10: packaging_fee حذف شد — بسته‌بندی per-product در ستون packaging_cost
      { key: 'restaurant_location', value: { lat: 35.6892, lng: 51.389 } },
      // رارد ۳۷ — پیش‌فرض‌های دروازه‌ی جغرافیایی (قفل ایران روشن؛ دامنه‌ی عراق)
      { key: 'iran_only_access', value: true },
      { key: 'outside_access_scope', value: 'iraq' },
    ])
    .onConflictDoNothing()

  // ── ناحیه‌های ارسال ──
  await tx
    .insert(deliveryZones)
    .values([
      { radiusKm: 5, fee: 35000 },
      { radiusKm: 10, fee: 55000 },
      { radiusKm: 15, fee: 75000 },
    ])
    .onConflictDoNothing()

  // ── کوپن عمومی نمونه ──
  await tx
    .insert(coupons)
    .values({
      code: 'SINSHIN20',
      title: 'تخفیف عمومی سین‌شین',
      discountPercentage: 20,
      maxUses: 0,
      isPublic: true,
      isActive: true,
    })
    .onConflictDoNothing()

  // ── درباره‌ما (id=1 یکتا → upsert با coalesce) ──
  await tx
    .insert(contentAbout)
    .values({
      id: 1,
      heroTitle: 'درباره سین‌شین',
      heroText:
        'سین‌شین از سال ۱۳۹۶، در ابتدای خیابان پاسداران انزلی، با یک ایده ساده شروع شد: ساختن تجربه‌ای متفاوت از طعم، کیفیت و حس نوستالژی.',
      heroGradient: 'from-orange-400 to-red-500',
      teamTitle: 'کادر سین شین',
      teamGradient: 'from-purple-400 to-pink-500',
      teamAlt: 'تیم و کادر رستوران سین‌شین در انزلی',
      heroTitleAr: 'عن سين شين',
      heroTextAr:
        'بدأت سين شين عام ٢٠١٧، في بداية شارع پاسداران في أنزلي، بفكرة بسيطة: خلق تجربة مختلفة من المذاق والجودة والإحساس بالحنين.',
      teamTitleAr: 'طاقم سين شين',
      teamAltAr: 'فريق وطاقم مطعم سين شين في أنزلي',
    })
    .onConflictDoUpdate({
      target: contentAbout.id,
      set: {
        heroTitleAr: sql`coalesce(${contentAbout.heroTitleAr}, excluded.hero_title_ar)`,
        heroTextAr: sql`coalesce(${contentAbout.heroTextAr}, excluded.hero_text_ar)`,
        teamTitleAr: sql`coalesce(${contentAbout.teamTitleAr}, excluded.team_title_ar)`,
        teamAltAr: sql`coalesce(${contentAbout.teamAltAr}, excluded.team_alt_ar)`,
      },
    })

  // ── گالری نمونه (insert فقط وقتی خالی؛ وگرنه backfill عربیِ خالی‌ها) ──
  const GALLERY_SEED = [
    { src: '/uploads/seed-gallery-1.webp', alt: 'رستوران سین‌شین', altAr: 'مطعم سين شين', span: 'wide' as const, sortOrder: 1 },
    { src: '/uploads/seed-gallery-2.webp', alt: 'پیتزا مخصوص', altAr: 'بيتزا خاصة', span: 'normal' as const, sortOrder: 2 },
    { src: '/uploads/seed-gallery-3.webp', alt: 'کباب کوبیده', altAr: 'كباب كوبيدة', span: 'normal' as const, sortOrder: 3 },
    { src: '/uploads/seed-gallery-4.webp', alt: 'سالاد سزار', altAr: 'سلطة سيزر', span: 'normal' as const, sortOrder: 4 },
    { src: '/uploads/seed-gallery-5.webp', alt: 'فضای داخلی', altAr: 'الفضاء الداخلي', span: 'wide' as const, sortOrder: 5 },
    { src: '/uploads/seed-gallery-6.webp', alt: 'پیش‌غذای سین‌شین', altAr: 'مقبلات سين شين', span: 'normal' as const, sortOrder: 6 },
  ]

  const galleryCount = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(galleryImages)
    .then((r) => r[0]?.count ?? 0)

  if (galleryCount === 0) {
    await tx
      .insert(galleryImages)
      .values(GALLERY_SEED.map((g) => ({ ...g, isActive: true })))
    console.log('[seed] sample gallery images inserted (fa+ar)')
  } else {
    // backfill — فقط ردیف‌های seed-شکل که alt عربی ندارند
    for (const g of GALLERY_SEED) {
      await tx
        .update(galleryImages)
        .set({ altAr: g.altAr })
        .where(and(eq(galleryImages.src, g.src), isNull(galleryImages.altAr)))
    }
    console.log('[seed] gallery arabic backfill checked')
  }

  // ── قوانین نسخه ۱ (version یکتا → upsert با coalesce) ──
  await tx
    .insert(terms)
    .values({
      version: 1,
      sections: [
        {
          title: '۱. حساب کاربری و ورود',
          items: [
            'ورود و ثبت‌نام صرفاً با شماره موبایل و کد تأیید پیامکی انجام می‌شود.',
            'شماره موبایل پس از ثبت قابل تغییر نیست؛ در ورود آن را با دقت وارد کنید.',
            'مسئولیت حفظ محرمانگی کد تأیید بر عهده کاربر است.',
          ],
        },
        {
          title: '۲. یک دستگاه، یک ثبت‌نام',
          items: [
            'هر دستگاه تنها یک‌بار امکان ثبت‌نام دارد و پس از آن برای ثبت‌نام جدید مسدود می‌شود.',
            'این قید برای جلوگیری از سوءاستفاده از سیستم معرفی اعمال می‌شود.',
            'ورود با شماره ثبت‌شده روی سایر دستگاه‌ها مطابق قوانین همین سند ممکن است.',
          ],
        },
        {
          title: '۳. سفارش و پرداخت',
          items: [
            'قیمت‌های نهایی همیشه توسط سرور محاسبه و تأیید می‌شود.',
            'پس از پرداخت موفق امکان لغو سفارش وجود ندارد.',
            'هزینه ارسال باید از درگاه بانکی پرداخت شود و از کیف پول قابل کسر نیست.',
            'موجودی کیف پول صرفاً برای پرداخت بخشی از مبلغ غذاها قابل استفاده است.',
            'ثبت سفارش در زمان بسته بودن رستوران ممکن است و پس از باز شدن پردازش می‌شود.',
          ],
        },
        {
          title: '۴. هزینه ارسال (ناحیه‌ها)',
          items: [
            'هزینه ارسال بر اساس فاصله آدرس شما از رستوران و ناحیه‌های تعریف‌شده محاسبه می‌شود.',
            'خارج از همه‌ی ناحیه‌ها → نرخ ناحیه‌ی بیرونی.',
            'سفارش‌های حضوری هزینه ارسال ندارند.',
          ],
        },
        {
          title: '۵. کیف پول و سود معرفی',
          items: [
            'کیف پول فقط از طریق سود معرفی دوستان شارژ می‌شود.',
            'سود معرفی ۱۰٪ و فقط از بخش پرداخت آنلاین مبلغ غذاها است.',
            'استفاده از کیف پول برای تخفیف هزینه ارسال امکان‌پذیر نیست.',
          ],
        },
        {
          title: '۶. تحویل سفارش و نظرات',
          items: [
            'تأیید تحویل سفارش توسط خود کاربر انجام می‌شود.',
            'برای هر محصول در هر سفارش تنها یک نظر قابل ثبت است.',
            'نظرات پس از بررسی مدیران در صفحه‌ی محصول نمایش داده می‌شوند.',
          ],
        },
        {
          title: '۷. حریم خصوصی',
          items: [
            'اطلاعات شما صرفاً برای پردازش سفارش‌ها استفاده می‌شود.',
            'شماره موبایل شما برای هیچ شخص ثالثی به اشتراک گذاشته نمی‌شود.',
          ],
        },
      ],
      sectionsAr: [
        {
          title: '١. الحساب وتسجيل الدخول',
          items: [
            'يتم تسجيل الدخول والتسجيل عبر رقم الهاتف المحمول ورمز التحقق عبر الرسائل النصية فقط.',
            'رقم الهاتف المحمول لا يمكن تغييره بعد التسجيل؛ أدخله بدقة عند تسجيل الدخول.',
            'مسؤولية الحفاظ على سرية رمز التحقق تقع على عاتق المستخدم.',
          ],
        },
        {
          title: '٢. جهاز واحد، تسجيل واحد',
          items: [
            'يملك كل جهاز إمكانية التسجيل مرة واحدة فقط، وبعدها يُمنع من التسجيل الجديد.',
            'وُضع هذا القيد لمنع إساءة استخدام نظام الإحالة.',
            'يمكن تسجيل الدخول برقم مسجل على أجهزة أخرى وفق قواعد هذا المستند.',
          ],
        },
        {
          title: '٣. الطلب والدفع',
          items: [
            'تُحسب الأسعار النهائية وتُعتمد دائماً من قبل الخادم.',
            'لا يمكن إلغاء الطلب بعد نجاح الدفع.',
            'يجب دفع تكلفة التوصيل عبر البوابة المصرفية ولا يمكن خصمها من المحفظة.',
            'يُستخدم رصيد المحفظة فقط لدفع جزء من قيمة الأطعمة.',
            'يمكن تسجيل الطلب أثناء إغلاق المطعم، وسيُعالج بعد الافتتاح.',
          ],
        },
        {
          title: '٤. تكلفة التوصيل (المناطق)',
          items: [
            'تُحسب تكلفة التوصيل بناءً على مسافة عنوانك عن المطعم والمناطق المحددة.',
            'خارج جميع المناطق → تعرفة المنطقة الخارجية.',
            'الطلبات الاستلام من الفرع لا تحمل تكلفة توصيل.',
          ],
        },
        {
          title: '٥. المحفظة وأرباح الإحالة',
          items: [
            'تُشحن المحفظة فقط عبر أرباح إحالة الأصدقاء.',
            'ربح الإحالة ١٠٪ وهو من الجزء المدفوع إلكترونياً من قيمة الأطعمة فقط.',
            'لا يمكن استخدام المحفظة للحصول على خصم على تكلفة التوصيل.',
          ],
        },
        {
          title: '٦. تسليم الطلب والمراجعات',
          items: [
            'يتم تأكيد استلام الطلب من قبل المستخدم نفسه.',
            'يمكن تسجيل مراجعة واحدة فقط لكل منتج في كل طلب.',
            'تُعرض المراجعات في صفحة المنتج بعد مراجعتها من قبل الإدارة.',
          ],
        },
        {
          title: '٧. الخصوصية',
          items: [
            'تُستخدم معلوماتك فقط لمعالجة الطلبات.',
            'لا يتم مشاركة رقم هاتفك مع أي طرف ثالث.',
          ],
        },
      ],
    })
    .onConflictDoUpdate({
      target: terms.version,
      set: {
        sectionsAr: sql`coalesce(${terms.sectionsAr}, excluded.sections_ar)`,
      },
    })

  // ── محصولات نمونه — دوزبانه ──
  //  • جدول خالی → insert کامل (fa + ar)
  //  • جدول پر → فقط backfill ستون‌های عربیِ خالی روی ردیف‌های seed-شکل
  const productCount = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .then((r) => r[0]?.count ?? 0)

  if (productCount === 0) {
    const catBy = async (slug: string) =>
      (await tx.select().from(categories).where(eq(categories.slug, slug)).limit(1))[0]
    const pizza = await catBy('pizza')
    const burger = await catBy('burger')
    const drinks = await catBy('drinks')
    const sandwich = await catBy('sandwich')
    const salad = await catBy('salad')

    type SeedProduct = Omit<typeof products.$inferInsert, 'categoryId'>
    const seeded: Array<{
      c: string | undefined
      row: SeedProduct
      sizes?: { name: string; nameAr: string; price: number }[]
    }> = [
        {
          c: pizza?.id,
          row: {
            name: 'پیتزا پپرونی',
            description: 'پنیر موزارلا و پپرونی با خمیر تازه و سس مخصوص',
            nameAr: 'بيتزا بيبروني',
            descriptionAr: 'جبن موزاريلا وبيبروني مع عجينة طازجة وصلصة خاصة',
            originalPrice: 185000,
            discountPercentage: 15,
            prepTime: 25,
            sizesEnabled: true,
            ingredients: ['پنیر موزارلا', 'پپرونی', 'خمیر تازه', 'سس مخصوص'],
            ingredientsAr: ['جبن موزاريلا', 'بيبروني', 'عجينة طازجة', 'صلصة خاصة'],
            arAuto: false,
            views: 150,
            sales: 40,
          },
          sizes: [
            { name: 'کوچک', nameAr: 'صغير', price: 120000 },
            { name: 'متوسط', nameAr: 'متوسط', price: 157250 },
            { name: 'بزرگ', nameAr: 'كبير', price: 200000 },
          ],
        },
        {
          c: pizza?.id,
          row: {
            name: 'پیتزا قارچ',
            description: 'پنیر و قارچ تازه با سس گوجه خانگی',
            nameAr: 'بيتزا بالفطر',
            descriptionAr: 'جبن وفطر طازج مع صلصة طماطم منزلية',
            originalPrice: 165000,
            discountPercentage: 0,
            prepTime: 25,
            sizesEnabled: true,
            ingredients: ['پنیر', 'قارچ تازه'],
            ingredientsAr: ['جبن', 'فطر طازج'],
            arAuto: false,
            views: 120,
            sales: 30,
          },
          sizes: [
            { name: 'کوچک', nameAr: 'صغير', price: 110000 },
            { name: 'متوسط', nameAr: 'متوسط', price: 165000 },
          ],
        },
        {
          c: burger?.id,
          row: {
            name: 'برگر کلاسیک',
            description: 'گوشت قرمز ۱۵۰ گرم با سیب‌زمینی و سس مخصوص',
            nameAr: 'برجر كلاسيكي',
            descriptionAr: 'لحم بقري ١٥٠ غراماً مع بطاطا وصلصة خاصة',
            originalPrice: 145000,
            discountPercentage: 15,
            prepTime: 15,
            sizesEnabled: false,
            ingredients: ['گوشت قرمز', 'نان بریوش', 'سیب‌زمینی'],
            ingredientsAr: ['لحم بقري', 'خبز بريوش', 'بطاطا'],
            arAuto: false,
            views: 200,
            sales: 80,
          },
        },
        {
          c: drinks?.id,
          row: {
            name: 'نوشیدنی کوکاکولا',
            description: 'قوطی ۳۳۰ سی‌سی خنک',
            nameAr: 'مشروب كوكاكولا',
            descriptionAr: 'علبة ٣٣٠ مل باردة',
            originalPrice: 25000,
            discountPercentage: 0,
            prepTime: 2,
            sizesEnabled: false,
            ingredients: [],
            arAuto: false,
            views: 300,
            sales: 150,
          },
        },
        {
          c: sandwich?.id,
          row: {
            name: 'کباب کوبیده',
            description: 'دو سیخ کباب کوبیده با برنج زعفرانی و گوجه کبابی',
            nameAr: 'كباب كوبيدة',
            descriptionAr: 'سيخان كباب كوبيدة مع أرز بالزعفران وطماطم مشوية',
            originalPrice: 320000,
            discountPercentage: 0,
            prepTime: 35,
            sizesEnabled: false,
            ingredients: ['گوشت گوسفندی', 'برنج زعفرانی', 'گوجه کبابی', 'کره'],
            ingredientsAr: ['لحم غنم', 'أرز بالزعفران', 'طماطم مشوية', 'زبدة'],
            arAuto: false,
            views: 95,
            sales: 25,
          },
        },
        {
          c: salad?.id,
          row: {
            name: 'سالاد سزار',
            description: 'سالاد سزار با مرغ گریل، نان برشته و سس مخصوص',
            nameAr: 'سلطة سيزر',
            descriptionAr: 'سلطة سيزر مع دجاج مشوي وخبز محمص وصلصة خاصة',
            originalPrice: 180000,
            discountPercentage: 15,
            prepTime: 10,
            sizesEnabled: false,
            ingredients: ['کاهو رومی', 'مرغ گریل', 'نان برشته', 'پنیر پارمزان'],
            ingredientsAr: ['خس روماني', 'دجاج مشوي', 'خبز محمص', 'جبن بارميزان'],
            arAuto: false,
            views: 200,
            sales: 45,
          },
        },
      ]

    for (const item of seeded) {
      if (!item.c) continue
      const [created] = await tx
        .insert(products)
        .values({ ...item.row, categoryId: asCategoryId(item.c), status: 'ACTIVE' })
        .returning()
      if (created && item.sizes) {
        await tx.insert(productSizes).values(
          item.sizes.map((s, i) => ({
            productId: created.id,
            name: s.name,
            nameAr: s.nameAr,
            price: s.price,
            sortOrder: i,
          })),
        )
      }
    }
    console.log('[seed] sample products inserted (fa+ar)')
  } else {
    // ── backfill عربی روی دیتابیس موجود ──
    // فقط ردیف‌هایی که نامشان با seed یکی است «و» هنوز نام عربی ندارند —
    // محصولات دستی/ادمین‌ساخته و ردیف‌های ترجمه‌شده دست‌نخورده می‌مانند.
    const BACKFILL: Array<{
      faName: string
      nameAr: string
      descriptionAr: string
      ingredientsAr: string[]
      sizes?: { name: string; nameAr: string }[]
    }> = [
        {
          faName: 'پیتزا پپرونی',
          nameAr: 'بيتزا بيبروني',
          descriptionAr: 'جبن موزاريلا وبيبروني مع عجينة طازجة وصلصة خاصة',
          ingredientsAr: ['جبن موزاريلا', 'بيبروني', 'عجينة طازجة', 'صلصة خاصة'],
          sizes: [
            { name: 'کوچک', nameAr: 'صغير' },
            { name: 'متوسط', nameAr: 'متوسط' },
            { name: 'بزرگ', nameAr: 'كبير' },
          ],
        },
        {
          faName: 'پیتزا قارچ',
          nameAr: 'بيتزا بالفطر',
          descriptionAr: 'جبن وفطر طازج مع صلصة طماطم منزلية',
          ingredientsAr: ['جبن', 'فطر طازج'],
          sizes: [
            { name: 'کوچک', nameAr: 'صغير' },
            { name: 'متوسط', nameAr: 'متوسط' },
          ],
        },
        {
          faName: 'برگر کلاسیک',
          nameAr: 'برجر كلاسيكي',
          descriptionAr: 'لحم بقري ١٥٠ غراماً مع بطاطا وصلصة خاصة',
          ingredientsAr: ['لحم بقري', 'خبز بريوش', 'بطاطا'],
        },
        {
          faName: 'نوشیدنی کوکاکولا',
          nameAr: 'مشروب كوكاكولا',
          descriptionAr: 'علبة ٣٣٠ مل باردة',
          ingredientsAr: [],
        },
        {
          faName: 'کباب کوبیده',
          nameAr: 'كباب كوبيدة',
          descriptionAr: 'سيخان كباب كوبيدة مع أرز بالزعفران وطماطم مشوية',
          ingredientsAr: ['لحم غنم', 'أرز بالزعفران', 'طماطم مشوية', 'زبدة'],
        },
        {
          faName: 'سالاد سزار',
          nameAr: 'سلطة سيزر',
          descriptionAr: 'سلطة سيزر مع دجاج مشوي وخبز محمص وصلصة خاصة',
          ingredientsAr: ['خس روماني', 'دجاج مشوي', 'خبز محمص', 'جبن بارميزان'],
        },
      ]

    let patched = 0
    for (const b of BACKFILL) {
      const res = await tx
        .update(products)
        .set({ nameAr: b.nameAr, descriptionAr: b.descriptionAr, ingredientsAr: b.ingredientsAr, arAuto: false })
        .where(and(eq(products.name, b.faName), isNull(products.nameAr)))
        .returning({ id: products.id })
      patched += res.length

      // سایزهای همان محصول (unique: product_id + name) — فقط جایی که عربی خالی است
      for (const s of b.sizes ?? []) {
        await tx
          .update(productSizes)
          .set({ nameAr: s.nameAr })
          .where(
            and(
              eq(productSizes.name, s.name),
              isNull(productSizes.nameAr),
              inArray(
                productSizes.productId,
                tx.select({ id: products.id }).from(products).where(eq(products.name, b.faName)),
              ),
            ),
          )
      }
    }
    console.log(`[seed] product arabic backfill — ${patched} ردیف محصول + سایزهایش بررسی شد`)
  }

  // ── مقالات نمونه — دوزبانه (همان منطق محصولات) ──
  const articleCount = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(articles)
    .then((r) => r[0]?.count ?? 0)

  if (articleCount === 0) {
    await tx
      .insert(articleCategories)
      .values([
        { name: 'آموزش آشپزی', nameAr: 'نصائح الطبخ', slug: 'cooking-tips', hasSubCategories: false },
        { name: 'معرفی غذاها', nameAr: 'أدلة الأطعمة', slug: 'food-guides', hasSubCategories: true },
        { name: 'سبک زندگی', nameAr: 'نمط الحياة', slug: 'lifestyle', hasSubCategories: false },
      ])
      .onConflictDoUpdate({
        target: articleCategories.slug,
        set: { nameAr: sql`coalesce(${articleCategories.nameAr}, excluded.name_ar)` },
      })

    const catArticle = async (slug: string) =>
      (await tx.select().from(articleCategories).where(eq(articleCategories.slug, slug)).limit(1))[0]
    const cooking = await catArticle('cooking-tips')
    const foodGuides = await catArticle('food-guides')

    if (foodGuides) {
      await tx
        .insert(articleSubCategories)
        .values([
          { categoryId: foodGuides.id, name: 'پیتزا', nameAr: 'البيتزا', slug: 'pizza-guides' },
          { categoryId: foodGuides.id, name: 'برگر', nameAr: 'البرجر', slug: 'burger-guides' },
        ])
        .onConflictDoUpdate({
          target: articleSubCategories.slug,
          set: { nameAr: sql`coalesce(${articleSubCategories.nameAr}, excluded.name_ar)` },
        })
    }

    const subPizza = foodGuides
      ? (await tx.select().from(articleSubCategories).where(eq(articleSubCategories.slug, 'pizza-guides')).limit(1))[0]
      : undefined

    const subBurger = foodGuides
      ? (await tx.select().from(articleSubCategories).where(eq(articleSubCategories.slug, 'burger-guides')).limit(1))[0]
      : undefined

    if (cooking) {
      await tx.insert(articles).values({
        title: 'راز خمیر ایتالیایی: چطور پیتزا خانگی رستورانی کنیم',
        excerpt: 'پنج نکته‌ی کلیدی که خمیر پیتزای شما را از سطح به عمق می‌برد.',
        content: 'خمیر ایتالیایی فقط آرد و آب و نمک و مخمر است — ولی نسبت‌ها و زمان است که همه‌چیز را می‌سازد.\n\nاول: آرد ۰۰ یا ۰ را با مخمر خشک مخلوط کنید و ده دقیقه بگذارید بماند. آب ولرم اضافه کنید — نه داغ، نه سرد. نمک را همیشه آخر بریزید چون مستقیم روی مخمر اثر می‌گذارد.\n\nبعد از ورز دادن، خمیر را در ظرفی روغن‌مالی شده بگذارید و اجازه بدهید در دمای اتاق دو ساعت بماند. اگر عجله ندارید، یک شب در یخچال بگذارید — طعم عمیق‌تر می‌شود.\n\nمهم‌ترین راز: فر را نیم ساعت قبل با دمای ۲۵۰ درجه گرم کنید و سنگ پیتزا یا تابه چدنی بگذارید داخل فر. خمیر را روی سنگ داغ بیندازید — پایه‌ی خمیر نرم و پوپ می‌شود، بالا کش می‌آید و می‌پزد.',
        titleAr: 'سر العجينة الإيطالية: كيف تصنع بيتزا منزلية بمستوى المطاعم',
        excerptAr: 'خمس نصائح أساسية تنقل عجينة البيتزا الخاصة بك من السطح إلى العمق.',
        contentAr: 'العجينة الإيطالية هي فقط دقيق وماء وملح وخميرة — لكن النِّسَب والوقت هما ما يصنعان كل الفرق.\n\nأولاً: اخلط الدقيق ٠٠ أو ٠ مع الخميرة الجافة واتركه عشر دقائق. أضف الماء الفاتر — ليس ساخناً ولا بارداً. أضف الملح دائماً في النهاية لأنه يؤثر مباشرة على الخميرة.\n\nبعد العجن، ضع العجينة في وعاء مدهون بالزيت واتركها ساعتين في حرارة الغرفة. إذا لم تكن مستعجلاً، اتركها ليلة كاملة في الثلاجة — يصبح الطعم أعمق.\n\nأهم سر: سخّن الفرن نصف ساعة قبل ذلك على حرارة ٢٥٠ درجة وضع حجر البيتزا أو مقلاة حديدية داخل الفرن. ضع العجينة على الحجر الساخن — يصبح قاع العجينة طرياً ومنتفخاً، وترتفع الحواف وتنضج.',
        author: 'کادر سین‌شین',
        categoryId: cooking.id,
        subCategoryId: subPizza?.id ?? null,
        profileImage: null,
        galleryImages: [],
        processes: [
          { title: 'مرحله ۱ — خمیر', items: ['آرد ۰۰: ۵۰۰ گرم', 'آب ولرم: ۳۲۵ میلی‌لیتر', 'مخمر خشک: ۵ گرم', 'نمک: ۱۰ گرم (آخر)'] },
          { title: 'مرحله ۲ — استراحت', items: ['دمای اتاق: ۲ ساعت', 'یا یخچال: یک شب', 'ظرف روغن‌مالی شده'] },
          { title: 'مرحله ۳ — پخت', items: ['فر: ۲۵۰ درجه، ۳۰ دقیقه گرم', 'سنگ پیتزا یا تابه چدنی', '۸ تا ۱۰ دقیقه پخت'] },
        ],
        processesAr: [
          { title: 'المرحلة ١ — العجين', items: ['دقيق ٠٠: ٥٠٠ غرام', 'ماء فاتر: ٣٢٥ مل', 'خميرة جافة: ٥ غرام', 'ملح: ١٠ غرام (في النهاية)'] },
          { title: 'المرحلة ٢ — الراحة', items: ['حرارة الغرفة: ساعتان', 'أو الثلاجة: ليلة كاملة', 'وعاء مدهون بالزيت'] },
          { title: 'المرحلة ٣ — الخبز', items: ['الفرن: ٢٥٠ درجة، تسخين ٣٠ دقيقة', 'حجر بيتزا أو مقلاة حديدية', '٨ إلى ١٠ دقائق خبز'] },
        ],
        arAuto: false,
        views: 1250,
        status: 'ACTIVE',
      })
    }

    if (cooking) {
      await tx.insert(articles).values({
        title: 'برگر ذغالی یا پخته؟ راهنمای انتخاب گوشت برگر',
        excerpt: 'سایز، چربی و روش پخت — سه فاکتوری که برگر شما را می‌سازند.',
        content: 'برگر خوب از گوشت خوب شروع می‌شود. نسبت استاندارد: ۸۰٪ گوشت قرمز، ۲۰٪ چربی. اگر چربی کمتر باشد برگر خشک می‌شود، بیشتر باشد بریز.\n\nسایز هم مهم است: ۱۵۰ گرم برای برگر کلاسیک، ۲۵۰ گرم برای دوبل. گوشت را زیاده ورز ندهید — فقط شکل بدهید و بگذارید بماند.\n\nدر سین‌شین ما برگر را روی ذغال می‌پزیم چون دمای بالاتر کرم برگر را سریع می‌سازد و رطوبت داخل گوشت می‌ماند. اگر در خانه هستید، تابه چدنی داغ بهترین جایگزین است.\n\nسس مخصوص ما ساده است: سس گوجه، کمی خردل، سیر له‌شده و یک قاشق مربا. ساده ولی همه‌چیز.',
        titleAr: 'برجر على الفحم أم مطبوخ؟ دليل اختيار لحم البرجر',
        excerptAr: 'الحجم والدسم وطريقة الطهي — ثلاثة عوامل تصنع برجرك.',
        contentAr: 'البرجر الجيد يبدأ من اللحم الجيد. النسبة القياسية: ٨٠٪ لحم بقري و٢٠٪ دسم. إذا قلّ الدسم جفّ البرجر، وإذا زاد تهرّأ.\n\nالحجم مهم أيضاً: ١٥٠ غراماً للبرجر الكلاسيكي و٢٥٠ غراماً للدوبل. لا تعجن اللحم كثيراً — فقط شكّله واتركه.\n\nفي سين شين نطهو البرجر على الفحم لأن الحرارة العالية تصنع قشرة البرجر بسرعة وتبقي الرطوبة داخل اللحم. إذا كنت في المنزل، فالمقلاة الحديدية الساخنة هي أفضل بديل.\n\nصلصتنا الخاصة بسيطة: صلصة طماطم وقليل من الخردل وثوم مهروس وملعقة مربى. بسيطة لكنها كل شيء.',
        author: 'کادر سین‌شین',
        categoryId: cooking.id,
        subCategoryId: subBurger?.id ?? null,
        profileImage: null,
        galleryImages: [],
        processes: [],
        processesAr: [],
        arAuto: false,
        views: 890,
        status: 'ACTIVE',
      })
    }

    console.log('[seed] sample articles inserted (fa+ar)')
  } else {
    // ── backfill عربی مقالات seed-شکل (فقط جایی که title_ar خالی است) ──
    const ARTICLE_BACKFILL = [
      {
        faTitle: 'راز خمیر ایتالیایی: چطور پیتزا خانگی رستورانی کنیم',
        titleAr: 'سر العجينة الإيطالية: كيف تصنع بيتزا منزلية بمستوى المطاعم',
        excerptAr: 'خمس نصائح أساسية تنقل عجينة البيتزا الخاصة بك من السطح إلى العمق.',
        contentAr: 'العجينة الإيطالية هي فقط دقيق وماء وملح وخميرة — لكن النِّسَب والوقت هما ما يصنعان كل الفرق.\n\nأولاً: اخلط الدقيق ٠٠ أو ٠ مع الخميرة الجافة واتركه عشر دقائق. أضف الماء الفاتر — ليس ساخناً ولا بارداً. أضف الملح دائماً في النهاية لأنه يؤثر مباشرة على الخميرة.\n\nبعد العجن، ضع العجينة في وعاء مدهون بالزيت واتركها ساعتين في حرارة الغرفة. إذا لم تكن مستعجلاً، اتركها ليلة كاملة في الثلاجة — يصبح الطعم أعمق.\n\nأهم سر: سخّن الفرن نصف ساعة قبل ذلك على حرارة ٢٥٠ درجة وضع حجر البيتزا أو مقلاة حديدية داخل الفرن. ضع العجينة على الحجر الساخن — يصبح قاع العجينة طرياً ومنتفخاً، وترتفع الحواف وتنضج.',
        processesAr: [
          { title: 'المرحلة ١ — العجين', items: ['دقيق ٠٠: ٥٠٠ غرام', 'ماء فاتر: ٣٢٥ مل', 'خميرة جافة: ٥ غرام', 'ملح: ١٠ غرام (في النهاية)'] },
          { title: 'المرحلة ٢ — الراحة', items: ['حرارة الغرفة: ساعتان', 'أو الثلاجة: ليلة كاملة', 'وعاء مدهون بالزيت'] },
          { title: 'المرحلة ٣ — الخبز', items: ['الفرن: ٢٥٠ درجة، تسخين ٣٠ دقيقة', 'حجر بيتزا أو مقلاة حديدية', '٨ إلى ١٠ دقائق خبز'] },
        ] satisfies { title: string; items: string[] }[],
      },
      {
        faTitle: 'برگر ذغالی یا پخته؟ راهنمای انتخاب گوشت برگر',
        titleAr: 'برجر على الفحم أم مطبوخ؟ دليل اختيار لحم البرجر',
        excerptAr: 'الحجم والدسم وطريقة الطهي — ثلاثة عوامل تصنع برجرك.',
        contentAr: 'البرجر الجيد يبدأ من اللحم الجيد. النسبة القياسية: ٨٠٪ لحم بقري و٢٠٪ دسم. إذا قلّ الدسم جفّ البرجر، وإذا زاد تهرّأ.\n\nالحجم مهم أيضاً: ١٥٠ غراماً للبرجر الكلاسيكي و٢٥٠ غراماً للدوبل. لا تعجن اللحم كثيراً — فقط شكّله واتركه.\n\nفي سين شين نطهو البرجر على الفحم لأن الحرارة العالية تصنع قشرة البرجر بسرعة وتبقي الرطوبة داخل اللحم. إذا كنت في المنزل، فالمقلاة الحديدية الساخنة هي أفضل بديل.\n\nصلصتنا الخاصة بسيطة: صلصة طماطم وقليل من الخردل وثوم مهروس وملعقة مربى. بسيطة لكنها كل شيء.',
        processesAr: [] satisfies { title: string; items: string[] }[],
      },
    ]

    let patchedArticles = 0
    for (const a of ARTICLE_BACKFILL) {
      const res = await tx
        .update(articles)
        .set({ titleAr: a.titleAr, excerptAr: a.excerptAr, contentAr: a.contentAr, processesAr: a.processesAr, arAuto: false })
        .where(and(eq(articles.title, a.faTitle), isNull(articles.titleAr)))
        .returning({ id: articles.id })
      patchedArticles += res.length
    }
    console.log(`[seed] article arabic backfill — ${patchedArticles} ردیف بررسی شد`)

    // دسته‌های مقاله هم (جدول پر شده ممکن؛ upsert با coalesce مثل مسیر insert)
    await tx
      .insert(articleCategories)
      .values([
        { name: 'آموزش آشپزی', nameAr: 'نصائح الطبخ', slug: 'cooking-tips', hasSubCategories: false },
        { name: 'معرفی غذاها', nameAr: 'أدلة الأطعمة', slug: 'food-guides', hasSubCategories: true },
        { name: 'سبک زندگی', nameAr: 'نمط الحياة', slug: 'lifestyle', hasSubCategories: false },
      ])
      .onConflictDoUpdate({
        target: articleCategories.slug,
        set: { nameAr: sql`coalesce(${articleCategories.nameAr}, excluded.name_ar)` },
      })

    const foodGuidesBackfill = (
      await tx
        .select()
        .from(articleCategories)
        .where(eq(articleCategories.slug, 'food-guides'))
        .limit(1)
    )[0]
    if (foodGuidesBackfill) {
      await tx
        .insert(articleSubCategories)
        .values([
          { categoryId: foodGuidesBackfill.id, name: 'پیتزا', nameAr: 'البيتزا', slug: 'pizza-guides' },
          { categoryId: foodGuidesBackfill.id, name: 'برگر', nameAr: 'البرجر', slug: 'burger-guides' },
        ])
        .onConflictDoUpdate({
          target: articleSubCategories.slug,
          set: { nameAr: sql`coalesce(${articleSubCategories.nameAr}, excluded.name_ar)` },
        })
    }
  }
})

console.log('[seed] done ✅ (fa+ar)')
await database.close()

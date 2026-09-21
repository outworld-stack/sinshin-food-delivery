// drizzle/seed.ts
/**
 * Seed v2 — transactional (همه یا هیچ) + idempotent.
 *   bun run db:seed
 */
import { eq, sql } from 'drizzle-orm'

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

console.log('[seed] started...')

await db.transaction(async (tx) => {
  // ── دسته‌های اصلی ──
  await tx
    .insert(mainCategories)
    .values([
      { name: 'رستوران', slug: 'restaurant', isActive: true, isDefault: true, sortOrder: 1 },
      { name: 'فست‌فود', slug: 'fastfood', isActive: true, isDefault: false, sortOrder: 2 },
    ])
    .onConflictDoNothing()

  const mainBy = async (slug: string) =>
    (await tx.select().from(mainCategories).where(eq(mainCategories.slug, slug)).limit(1))[0]
  const restaurantMain = await mainBy('restaurant')
  const fastfoodMain = await mainBy('fastfood')

  if (restaurantMain && fastfoodMain) {
    await tx
      .insert(categories)
      .values([
        { mainCategoryId: restaurantMain.id, name: 'ساندویچ', slug: 'sandwich' },
        { mainCategoryId: restaurantMain.id, name: 'سالاد', slug: 'salad' },
        { mainCategoryId: restaurantMain.id, name: 'پاستا', slug: 'pasta' },
        { mainCategoryId: restaurantMain.id, name: 'پیش‌غذا', slug: 'appetizer' },
        {
          mainCategoryId: fastfoodMain.id,
          name: 'پیتزا',
          slug: 'pizza',
          hasSizes: true,
          sizeNames: ['کوچک', 'متوسط', 'بزرگ', 'خانوادگی'],
        },
        { mainCategoryId: fastfoodMain.id, name: 'برگر', slug: 'burger' },
        { mainCategoryId: fastfoodMain.id, name: 'نوشیدنی', slug: 'drinks' },
        { mainCategoryId: fastfoodMain.id, name: 'دسر', slug: 'dessert' },
      ])
      .onConflictDoNothing()
  }

  // ── تنظیمات ──
  await tx
    .insert(settings)
    .values([
      { key: 'restaurant_open', value: true },
      { key: 'next_open_time', value: '۱۱:۰۰ صبح' },
      { key: 'temporarily_closed', value: false },
      { key: 'live_tracking_enabled', value: false },
      // stage-10: packaging_fee حذف شد — بسته‌بندی per-product در ستون packaging_cost
      { key: 'restaurant_location', value: { lat: 35.6892, lng: 51.389 } },
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

  // ── درباره‌ما ──
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
    })
    .onConflictDoNothing()

  // ── گالری نمونه ──
  const galleryCount = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(galleryImages)
    .then((r) => r[0]?.count ?? 0)

  if (galleryCount === 0) {
    await tx.insert(galleryImages).values([
      { src: '/uploads/seed-gallery-1.webp', alt: 'رستوران سین‌شین', span: 'wide', sortOrder: 1, isActive: true },
      { src: '/uploads/seed-gallery-2.webp', alt: 'پیتزا مخصوص', span: 'normal', sortOrder: 2, isActive: true },
      { src: '/uploads/seed-gallery-3.webp', alt: 'کباب کوبیده', span: 'normal', sortOrder: 3, isActive: true },
      { src: '/uploads/seed-gallery-4.webp', alt: 'سالاد سزار', span: 'normal', sortOrder: 4, isActive: true },
      { src: '/uploads/seed-gallery-5.webp', alt: 'فضای داخلی', span: 'wide', sortOrder: 5, isActive: true },
      { src: '/uploads/seed-gallery-6.webp', alt: 'پیش‌غذای سین‌شین', span: 'normal', sortOrder: 6, isActive: true },
    ])
    console.log('[seed] sample gallery images inserted')
  }

  // ── قوانین نسخه ۱ ──
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
    })
    .onConflictDoNothing()

  // ── محصولات نمونه — فقط وقتی products خالی است ──
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
      sizes?: { name: string; price: number }[]
    }> = [
        {
          c: pizza?.id,
          row: {
            name: 'پیتزا پپرونی',
            description: 'پنیر موزارلا و پپرونی با خمیر تازه و سس مخصوص',
            originalPrice: 185000,
            discountPercentage: 15,
            prepTime: 25,
            sizesEnabled: true,
            ingredients: ['پنیر موزارلا', 'پپرونی', 'خمیر تازه', 'سس مخصوص'],
            views: 150,
            sales: 40,
          },
          sizes: [
            { name: 'کوچک', price: 120000 },
            { name: 'متوسط', price: 157250 },
            { name: 'بزرگ', price: 200000 },
          ],
        },
        {
          c: pizza?.id,
          row: {
            name: 'پیتزا قارچ',
            description: 'پنیر و قارچ تازه با سس گوجه خانگی',
            originalPrice: 165000,
            discountPercentage: 0,
            prepTime: 25,
            sizesEnabled: true,
            ingredients: ['پنیر', 'قارچ تازه'],
            views: 120,
            sales: 30,
          },
          sizes: [
            { name: 'کوچک', price: 110000 },
            { name: 'متوسط', price: 165000 },
          ],
        },
        {
          c: burger?.id,
          row: {
            name: 'برگر کلاسیک',
            description: 'گوشت قرمز ۱۵۰ گرم با سیب‌زمینی و سس مخصوص',
            originalPrice: 145000,
            discountPercentage: 15,
            prepTime: 15,
            sizesEnabled: false,
            ingredients: ['گوشت قرمز', 'نان بریوش', 'سیب‌زمینی'],
            views: 200,
            sales: 80,
          },
        },
        {
          c: drinks?.id,
          row: {
            name: 'نوشیدنی کوکاکولا',
            description: 'قوطی ۳۳۰ سی‌سی خنک',
            originalPrice: 25000,
            discountPercentage: 0,
            prepTime: 2,
            sizesEnabled: false,
            ingredients: [],
            views: 300,
            sales: 150,
          },
        },
        {
          c: sandwich?.id,
          row: {
            name: 'کباب کوبیده',
            description: 'دو سیخ کباب کوبیده با برنج زعفرانی و گوجه کبابی',
            originalPrice: 320000,
            discountPercentage: 0,
            prepTime: 35,
            sizesEnabled: false,
            ingredients: ['گوشت گوسفندی', 'برنج زعفرانی', 'گوجه کبابی', 'کره'],
            views: 95,
            sales: 25,
          },
        },
        {
          c: salad?.id,
          row: {
            name: 'سالاد سزار',
            description: 'سالاد سزار با مرغ گریل، نان برشته و سس مخصوص',
            originalPrice: 180000,
            discountPercentage: 15,
            prepTime: 10,
            sizesEnabled: false,
            ingredients: ['کاهو رومی', 'مرغ گریل', 'نان برشته', 'پنیر پارمزان'],
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
            price: s.price,
            sortOrder: i,
          })),
        )
      }
    }
    console.log('[seed] sample products inserted')
  }

  // ── مقالات نمونه — فقط وقتی articles خالی است ──
  const articleCount = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(articles)
    .then((r) => r[0]?.count ?? 0)

  if (articleCount === 0) {
    await tx
      .insert(articleCategories)
      .values([
        { name: 'آموزش آشپزی', slug: 'cooking-tips', hasSubCategories: false },
        { name: 'معرفی غذاها', slug: 'food-guides', hasSubCategories: true },
        { name: 'سبک زندگی', slug: 'lifestyle', hasSubCategories: false },
      ])
      .onConflictDoNothing()

    const catArticle = async (slug: string) =>
      (await tx.select().from(articleCategories).where(eq(articleCategories.slug, slug)).limit(1))[0]
    const cooking = await catArticle('cooking-tips')
    const foodGuides = await catArticle('food-guides')

    if (foodGuides) {
      await tx
        .insert(articleSubCategories)
        .values([
          { categoryId: foodGuides.id, name: 'پیتزا', slug: 'pizza-guides' },
          { categoryId: foodGuides.id, name: 'برگر', slug: 'burger-guides' },
        ])
        .onConflictDoNothing()
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
        views: 1250,
        status: 'ACTIVE',
      })
    }

    if (cooking) {
      await tx.insert(articles).values({
        title: 'برگر ذغالی یا پخته؟ راهنمای انتخاب گوشت برگر',
        excerpt: 'سایز، چربی و روش پخت — سه فاکتوری که برگر شما را می‌سازند.',
        content: 'برگر خوب از گوشت خوب شروع می‌شود. نسبت استاندارد: ۸۰٪ گوشت قرمز، ۲۰٪ چربی. اگر چربی کمتر باشد برگر خشک می‌شود، بیشتر باشد بریز.\n\nسایز هم مهم است: ۱۵۰ گرم برای برگر کلاسیک، ۲۵۰ گرم برای دوبل. گوشت را زیاده ورز ندهید — فقط شکل بدهید و بگذارید بماند.\n\nدر سین‌شین ما برگر را روی ذغال می‌پزیم چون دمای بالاتر کرم برگر را سریع می‌سازد و رطوبت داخل گوشت می‌ماند. اگر در خانه هستید، تابه چدنی داغ بهترین جایگزین است.\n\nسس مخصوص ما ساده است: سس گوجه، کمی خردل، سیر له‌شده و یک قاشق مربا. ساده ولی همه‌چیز.',
        author: 'کادر سین‌شین',
        categoryId: cooking.id,
        subCategoryId: subBurger?.id ?? null,
        profileImage: null,
        galleryImages: [],
        processes: [],
        views: 890,
        status: 'ACTIVE',
      })
    }

    console.log('[seed] sample articles inserted')
  }
})

console.log('[seed] done ✅')
await database.close()
// src/components/Footer.tsx
import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { Brand } from '#/components/Brand'
import { Instagram, Phone, Pin, Envelope2, Clock } from 'reicon-react'

// لینک‌های ثابت بیرون کامپوننت → بدون ری‌رندر مجدد در هر رندر
const ABOUT_LINKS: { label: string; to: string }[] = [
  // درباره ما و گالری هنوز صفحه ندارن، بعدا به لینک تبدیل می‌شن
  { label: 'درباره ما', to: '/about' },
  { label: 'گالری', to: '/gallery' },
  { label: 'مقالات', to: '/articles' },
] as const

const QUICK_LINKS = [
  { label: 'صفحه اصلی', to: '/' as const, tab: undefined },
  { label: 'فست‌فود', to: '/products' as const, tab: 'fastfood' },
  { label: 'رستوران', to: '/products' as const, tab: 'restaurant' },
  { label: 'سبد خرید', to: '/cart' as const, tab: undefined },
] as const

// فوتر کاملا استاتیک → memo برای جلوگیری از هر ری‌رندر
export const Footer = memo(function Footer() {
  return (
    <footer className="bg-white dark:bg-[#1a0a0e] border-t border-gray-200 dark:border-white/10">

      {/* نوار بالایی فوتر */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-10">

          {/* برند و توضیحات */}
          <div className="flex flex-col items-center sm:items-start gap-5">
            <Brand textSize="text-xl" />
            <p className="text-sm text-gray-500 dark:text-gray-400 font-DanaRegular leading-relaxed text-center sm:text-right">
              فودپارک سین شین؛ تجربه‌ای متفاوت از سفارش آنلاین غذا. طعم زندگی، درِ خانه شما، در سریع‌ترین زمان ممکن.
            </p>

          </div>

          {/* ستون درباره ما — مقالات دقیقا زیر درباره ما و گالری */}
          <div className="flex flex-col items-center sm:items-start">
            <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-5 relative pb-2
                           after:absolute after:right-0 after:bottom-0 after:w-10 after:h-0.5 after:bg-primary dark:after:bg-dark-primary">
              درباره ما
            </h3>
            <ul className="space-y-3">
              {ABOUT_LINKS.map((item) => (
                <li key={item.label}>
                  {item.to ? (
                    <Link
                      to={item.to}
                      className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary dark:hover:text-dark-primary transition font-DanaMedium"
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <span className="text-sm text-gray-400 dark:text-gray-500 font-DanaMedium select-none">
                      {item.label}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>


          {/* ستون تماس با ما */}
          <div className="flex flex-col items-center sm:items-start lg:col-start-4">
            <h3 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white mb-5 relative pb-2
                           after:absolute after:right-0 after:bottom-0 after:w-10 after:h-0.5 after:bg-primary dark:after:bg-dark-primary">
              تماس با ما
            </h3>
            <ul className="space-y-4 w-full">
              <li className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">
                <span className="w-9 h-9 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0">
                  <Pin size={16} />
                </span>
                <h2 className='text-sm font-MorabbaMedium bg-linear-to-l from-sky-500  to-emerald-500 bg-clip-text text-transparent '>
                  بندرانزلی ، کیلومتر یک پاسداران
                </h2>
              </li>
              <li className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">
                <a href="tel:01344552313" dir="ltr" className="w-9 h-9 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0 hover:opacity-80 transition">
                  <Phone size={16} />
                </a>
                <span dir="ltr">013-44552313</span>
              </li>
              <li className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">
              <a href="https://www.instagram.com/sinshin_foodpark" aria-label="اینستاگرام" className="w-9 h-9 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0 hover:opacity-80 transition">
                <Instagram size={20} />
              </a>
                <span dir="ltr">sinshin_foodpark</span>
              </li>
              <li className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 font-DanaMedium">
                <span className="w-9 h-9 rounded-lg bg-primary/10 dark:bg-dark-primary/10 text-primary dark:text-dark-primary flex items-center justify-center shrink-0">
                  <Clock size={16} />
                </span>
                <span>هر روز ۱۱ صبح تا ۱۲ شب</span>
              </li>
            </ul>
          </div>

        </div>
      </div>

      {/* نوار پایانی کپی‌رایت */}
      <div className="border-t border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-[#150910]">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 font-DanaRegular">
            © {new Date().getFullYear()} سین شین — تمامی حقوق محفوظ است
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 font-DanaRegular">
            طراحی و توسعه با ❤️ در سین شین
          </p>
        </div>
      </div>

    </footer>
  )
})
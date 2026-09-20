import { createFileRoute, Link } from '@tanstack/react-router';
import { ThemeToggle } from '#/components/ThemeToggle';
import { Brand } from '#/components/Brand';
import { WordSlider } from '#/components/WordSlider';
import { useAuthStore } from '#/stores/authStore';
import { useHydrated } from '#/hooks/useHydrated'


export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hydrated = useHydrated()
  const showAuthed = hydrated && isAuthenticated;
  return (
    <>
      <ThemeToggle className="fixed top-6 left-6 z-50" />
      <div className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden bg-white dark:bg-[#1a0a0e] transition-colors duration-500 px-6 py-10">
        <div className="absolute top-0 -right-20 w-72.5 h-62.5 sm:w-150 sm:h-150 sm:-right-40 bg-primary/20 dark:bg-dark-primary/10 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="absolute bottom-0 -left-20 w-62.5 h-62.5 sm:w-150 sm:h-150 sm:-left-40 bg-dark-primary/35 dark:bg-[#4a1a24]/30 rounded-full blur-[100px] pointer-events-none"></div>

        <div className="relative z-10 text-center max-w-4xl mx-auto flex flex-col items-center">
          <Brand />
          <div className="flex items-center mt-[18vh] sm:mt-[13vh] md:mt-[15vh] lg:mt-[22vh] text-2xl sm:text-4xl md:text-5xl max-sm:-mr-5">
            <div className="font-DanaRegular flex items-center">
              <span>تجربه لذت‌بخش</span>
              <WordSlider className="text-primary dark:text-dark-primary font-da mt-1 mr-1 sm:mr-1.5" words={['پیتزا', 'سوخاری', 'پاستا', 'موهیتو', 'قهوه', 'کباب']} />
            </div>
          </div>
          <h1 className="font-MorabbaBold text-3xl sm:text-5xl md:text-7xl text-black dark:text-white my-7 leading-tight tracking-tight">
            طعم زندگی، درِ خانه شما<br /><span className="text-primary dark:text-dark-primary">در سریع‌ترین زمان ممکن</span>
          </h1>
          <p className="font-DanaRegular text-base sm:text-lg md:text-xl text-gray-500 dark:text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            تجربه‌ای متفاوت از سفارش آنلاین غذا. با ثبت‌نام در سایت، لینک اختصاصی خود را دریافت کنید و با معرفی دوستانتان، تخفیف‌های ویژه و کیف پول فعال بگیرید.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
            {showAuthed ? (
              <Link to="/dashboard" className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold text-base sm:text-lg transition-all duration-300 shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5">پروفایل کاربری</Link>
            ) : (
              <Link to="/login" className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-primary dark:bg-dark-primary text-white font-DanaDemiBold text-base sm:text-lg transition-all duration-300 shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5">ورود / ثبت‌نام</Link>
            )}
            <Link to="/products" className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-transparent text-gray-800 dark:text-[#f5e0e6] border-2 border-gray-200 dark:border-[#3a151c] font-DanaDemiBold text-base sm:text-lg hover:border-primary dark:hover:border-dark-primary hover:bg-gray-50 dark:hover:bg-[#2a1015] transition-all duration-300">دیدن محصولات</Link>
          </div>
        </div>
      </div>
    </>
  )
}
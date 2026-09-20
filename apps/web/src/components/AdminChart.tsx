// src/components/AdminChart.tsx
import type { AdminChartProps } from '#/types/shared/ui';

export function AdminChart({ chartType, data }: AdminChartProps) {
  const maxVal = Math.max(...data.map(d => d.value), 1);

  const getTooltipClass = (index: number, total: number) => {
    if (total <= 10) return 'left-1/2 -translate-x-1/2';
    if (index < 5) return 'right-0';
    if (index >= total - 5) return 'left-0';
    return 'left-1/2 -translate-x-1/2';
  };

  if (chartType === 'bar') {
    return (
      <div>
        <div className="flex items-end justify-between gap-px h-48 border-b border-gray-100 dark:border-white/5 pb-2 w-full pt-8">
          {data.map((item, index) => (
            <div key={index} className="flex-1 h-full flex flex-col items-center justify-end relative group cursor-pointer px-1">
              <div className={`absolute bottom-full mb-2 ${getTooltipClass(index, data.length)} opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-50 whitespace-nowrap pointer-events-none`}>
                <div className="bg-gray-800 dark:bg-black text-white text-xs font-DanaMedium px-2 py-1 rounded-md shadow-lg">{item.value.toLocaleString('fa-IR')}</div>
              </div>
              <div className="w-full bg-primary dark:bg-dark-primary rounded-t-sm transition-all duration-500 group-hover:opacity-80 relative overflow-hidden" style={{ height: `${(item.value / maxVal) * 100}%`, minHeight: '2px' }}></div>
            </div>
          ))}
        </div>
        <div className="flex justify-between gap-px mt-2 px-1">
          {data.map((item, index) => (
            <div key={index} className="flex-1 text-center">
              <span className="text-[8px] sm:text-[10px] text-gray-400 dark:text-gray-500 font-DanaMedium">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (chartType === 'pie') {
    // حداکثر ۱۰ برش — مازاد تو «دیگر» (نمودار و لیست هم‌خوان می‌مونن)
    const chartData = data.length > 10
      ? [...data.slice(0, 9), { label: 'دیگر', value: data.slice(9).reduce((s, d) => s + d.value, 0) }]
      : data
    const sum = chartData.reduce((s, d) => s + d.value, 0)
    const total = sum || 1 // محافظ تقسیم بر صفر
    let offset = 0
    const getColor = (i: number) => `hsl(${(i * 360) / chartData.length}, 70%, 60%)`
    const gradient = chartData.map((d, i) => {
      const start = (offset / total) * 360
      offset += d.value
      const end = (offset / total) * 360
      return `${getColor(i)} ${start}deg ${end}deg`
    }).join(', ')

    return (
      <div className="flex flex-col md:flex-row items-center justify-center gap-8 py-4">
        <div className="relative w-48 h-48 rounded-full shadow-lg shrink-0" style={{ background: `conic-gradient(${gradient})` }}>
          <div className="absolute inset-6 bg-white dark:bg-[#2a1015] rounded-full flex items-center justify-center flex-col shadow-inner">
            <span className="text-xs text-gray-400 dark:text-gray-500 font-DanaMedium">مجموع</span>
            <span className="font-MorabbaBold text-lg text-gray-800 dark:text-white mt-1">{sum.toLocaleString('fa-IR')}</span>
          </div>
        </div>
        <div className="max-h-40 overflow-y-auto w-full md:w-auto pr-2 grid grid-cols-2 md:grid-cols-1 gap-2">
          {chartData.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: getColor(i) }}></span>
              <span className="text-xs font-DanaMedium text-gray-600 dark:text-gray-300 truncate">{d.label}: <span className="font-DanaDemiBold text-gray-800 dark:text-white">{d.value.toLocaleString('fa-IR')}</span></span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Line Chart
  const points = data.map((d, i) => {
    const x = data.length > 1 ? (i / (data.length - 1)) * 100 : 50;
    const y = 100 - (d.value / maxVal) * 85 - 5;
    return { x, y, value: d.value, label: d.label };
  });

  let pathD = "";
  if (points.length > 0) {
    pathD = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const x_mid = (points[i - 1].x + points[i].x) / 2;
      const y_mid = (points[i - 1].y + points[i].y) / 2;
      pathD += ` Q ${x_mid},${points[i - 1].y} ${x_mid},${y_mid}`;
      pathD += ` Q ${x_mid},${points[i].y} ${points[i].x},${points[i].y}`;
    }
  }

  return (
    <div>
      <div className="relative h-48 w-full pt-8">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ paddingTop: '30px' }}>
          <line x1="0" y1="25" x2="100" y2="25" stroke="currentColor" strokeWidth="0.2" className="text-gray-200 dark:text-white/5" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeWidth="0.2" className="text-gray-200 dark:text-white/5" />
          <line x1="0" y1="75" x2="100" y2="75" stroke="currentColor" strokeWidth="0.2" className="text-gray-200 dark:text-white/5" />
          <path d={pathD} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-primary dark:text-dark-primary" />
          <path d={`${pathD} L 100,100 L 0,100 Z`} fill="currentColor" className="text-primary/10 dark:text-dark-primary/10" />
        </svg>
        <div className="absolute inset-0" style={{ paddingTop: '30px' }}>
          {points.map((p, i) => (
            <div key={i} className="absolute group" style={{ left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%, -50%)' }}>
              <div className="w-2 h-2 rounded-full bg-primary dark:bg-dark-primary border border-white dark:border-[#2a1015] shadow-sm"></div>
              <div className={`absolute bottom-full mb-1 ${getTooltipClass(i, points.length)} opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-50 whitespace-nowrap pointer-events-none`}>
                <div className="bg-gray-800 dark:bg-black text-white text-xs font-DanaMedium px-2 py-1 rounded-md shadow-lg">{p.value.toLocaleString('fa-IR')}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-between gap-px mt-2 px-1">
        {points.map((p, index) => (
          <div key={index} className="flex-1 text-center">
            <span className="text-[8px] sm:text-[10px] text-gray-400 dark:text-gray-500 font-DanaMedium">{p.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
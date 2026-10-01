// ═══════════════════════════════════════════════════════════════
// round-36 — sinshin-food-delivery — فایل 13 از 14
// مسیر مقصد: apps/api/deep-tests/markdown.test.ts
// وضعیت: فایل جدید — پوشه را در صورت نیاز بسازید
// کامیت پیشنهادی: stage thirty two
// ═══════════════════════════════════════════════════════════════

// تست عمیق ر۳۵ — planText: شکستن Markdown با حفظ عین ساختار
import { describe, expect, test } from 'bun:test'
import { planText } from '#/domain/translation/markdown'

describe('R35 — planText درون‌گری (identity)', () => {
	const samples: Record<string, string> = {
		'متن ساده': 'یک متن ساده فارسی است.',
		'سرتیترها':
			'# عنوان اصلی\n## زیر عنوان\nپاراگراف بعد از سرتیتر.\n\nپاراگراف دوم با **متن پررنگ** و *مورب*.',
		'لیست‌ها':
			'- مورد اول\n- مورد دوم\n  - زیرمورد\n\n1. شماره یک\n2. شماره دو',
		'بلوک کد':
			'متن قبل\n\n```ts\nconst x: number = 42\nconsole.log(`hello ${x}`)\n```\n\nمتن بعد',
		'کد درون‌خطی': 'این یک `variable` درون‌خطی است و `one more` هم هست.',
		'لینک و تصویر':
			'[متن لینک](https://example.com/page) و تصویر ![alt](/uploads/img.png) کنار هم.',
		'URL خالی':
			'برای جزئیات به https://sinshin.example.com/products مراجعه کنید یا http://bit.ly/abc123.',
		'جدول':
			'| ستون یک | ستون دو |\n| --- | --- |\n| مقدار ۱ | مقدار ۲ |\n| مقدار ۳ | مقدار ۴ |',
		'خط افقی': 'بالا\n\n---\n\nپایین',
		'نقل‌قول': '> این یک نقل‌قول است\n> خط دوم نقل‌قول',
		'خطوط خالی متوالی': 'پاراگراف یک\n\n\n\nپاراگراف دو\n\n\nپاراگراف سه',
		'فارسی با اعداد و علائم': 'قیمت ۴۵,۰۰۰ تومان است! می‌خواهید؟ (بله/خیر)',
		'اموجی و یونیکد': 'غذای 🍕 پیتزا و 🍔 برگر — سالم و تازه 🌿',
		'متن فقط فاصله': '   ',
		'خالی': '',
	}

	for (const [name, input] of Object.entries(samples)) {
		test(`identity: ${name}`, () => {
			const plan = planText(input)
			const out = plan.assemble([...plan.segments])
			expect(out).toBe(input)
		})
	}

	test('identity: پاراگراف بسیار بلند (مرز جمله/کلمه)', () => {
		const longPara = Array.from({ length: 60 }, (_, i) => `این جمله‌ی شماره‌ی ${i} برای طولانی شدن متن است.`).join(' ')
		const input = `# عنوان\n\n${longPara}\n\nپایان.`
		const plan = planText(input)
		expect(plan.assemble([...plan.segments])).toBe(input)
		// همه‌ی قطعات در سقف طول هستند
		for (const seg of plan.segments) expect(seg.length).toBeLessThanOrEqual(400)
	})

	test('identity: جدول + کد + لینک با هم', () => {
		const input = [
			'# راهنمای سفارش',
			'',
			'| مرحله | توضیح |',
			'| --- | --- |',
			'| ۱ | انتخاب [منو](https://example.com/menu) |',
			'| ۲ | پرداخت با درگاه |',
			'',
			'```json',
			'{"status": "ok", "code": 200}',
			'```',
			'',
			'![نمودار](/uploads/chart.png)',
			'',
			'پایان راهنما.',
		].join('\n')
		const plan = planText(input)
		expect(plan.assemble([...plan.segments])).toBe(input)
	})

	test('قطعات ترجمه‌شدنی نحوِ حفاظت‌شده ندارند', () => {
		const input = 'لینک: [کلیک](https://example.com/a) و تصویر ![i](/u.png) و `code` و https://plain.url'
		const plan = planText(input)
		for (const seg of plan.segments) {
			expect(seg).not.toContain('https://')
			expect(seg).not.toContain('](/u.png)')
			expect(seg).not.toContain('`')
		}
	})

	test('ترجمه‌ی واقعی جایگزین می‌شود (نه identity)', () => {
		const input = 'سلام دنیا'
		const plan = planText(input)
		expect(plan.segments.length).toBeGreaterThanOrEqual(1)
		expect(plan.assemble(plan.segments.map(() => 'مرحبا بالعالم'))).toBe('مرحبا بالعالم')
	})

	test('قطعات خالی نداریم', () => {
		const input = 'خط یک\n\nخط دو\n\n- آیتم'
		const plan = planText(input)
		for (const seg of plan.segments) expect(seg.trim().length).toBeGreaterThan(0)
	})
})

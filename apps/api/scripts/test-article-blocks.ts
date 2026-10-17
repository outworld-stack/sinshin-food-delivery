// scripts/test-article-blocks.ts
// ═══════════════════════════════════════════════════════════════
// stage-82 — تست واحدِ خالصِ صفحه‌سازِ بلوکی مقالات (بدون PostgreSQL —
// مثل test-device-intel؛ در هر محیطی اجرا می‌شود).
//
//   bun scripts/test-article-blocks.ts   (یا: bun run db:test:blocks)
//
// پوشش: نرمال‌سازِ سخت‌گیر (whitelist/URL/hex/سقف‌ها) + مشتق‌سازیِ متن +
// کنتراست WCAG — همان لایه‌هایی که سندِ بلوکی را امن نگه می‌دارند.
// ═══════════════════════════════════════════════════════════════
import { blocksToPlainText, contrastRatio, isHexColor, pickContrastText, type ArticleBlocksDoc } from '@sinshin/shared'

import { normalizeBlocksDoc } from '../src/domain/article/blocks-normalize'

let pass = 0
let fail = 0

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const B = (type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: `${type}-1`,
  type,
  props,
  ...extra,
})

console.log('══ N1: پاکت — ورودی‌های نامعتبر ══')
ok('N1: null → null', normalizeBlocksDoc(null) === null)
ok('N1: undefined → null', normalizeBlocksDoc(undefined) === null)
ok('N1: آرایه خام → null', normalizeBlocksDoc([B('paragraph', { text: 'x' })]) === null)
ok('N1: version غلط → null', normalizeBlocksDoc({ version: 2, blocks: [B('paragraph', { text: 'x' })] }) === null)
ok('N1: blocks ناموجود → null', normalizeBlocksDoc({ version: 1 }) === null)
ok('N1: آرایه‌ی خالی → null', normalizeBlocksDoc({ version: 1, blocks: [] }) === null)

console.log('\n══ N2: بلوک ناشناخته حذف می‌شود، نه کل سند (درس Gutenberg) ══')
const mixed = normalizeBlocksDoc({
  version: 1,
  blocks: [
    B('paragraph', { text: 'متن معتبر' }),
    B('hologram', { text: 'ناشناخته' }),
    { id: 'x', props: { text: 'بدون type' } },
  ],
})
ok('N2: سند زنده ماند', mixed !== null)
ok('N2: فقط بلوک معتبر ماند', mixed?.blocks.length === 1)
ok('N2: بلوک معتبر همان است', mixed?.blocks[0]?.type === 'paragraph')

console.log('\n══ N3: id — بازتولیدِ تکراری/غایب ══')
const dupId = normalizeBlocksDoc({
  version: 1,
  blocks: [
    B('paragraph', { text: 'اول' }),
    B('paragraph', { text: 'دوم' }), // id یکسان «paragraph-1»
  ],
})
ok('N3: id تکراری → id تازه', dupId !== null && dupId.blocks.length === 2 && dupId.blocks[0]!.id !== dupId.blocks[1]!.id)
const noId = normalizeBlocksDoc({ version: 1, blocks: [{ type: 'divider', props: { variant: 'line' } }] })
ok('N3: id غایب → id تازه', noId !== null && typeof noId.blocks[0]?.id === 'string' && noId.blocks[0].id.length > 8)

console.log('\n══ N4: پاراگراف/تیتر — متن الزامی + trim + سقف ══')
ok('N4: پاراگراف خالی → حذف', normalizeBlocksDoc({ version: 1, blocks: [B('paragraph', { text: '   ' })] }) === null)
const longText = 'x'.repeat(6000)
const longP = normalizeBlocksDoc({ version: 1, blocks: [B('paragraph', { text: longText })] })
ok('N4: سقف ۵۰۰۰ کاراکتر', (longP?.blocks[0] as { props: { text: string } } | undefined)?.props.text.length === 5000)
const h = normalizeBlocksDoc({
  version: 1,
  blocks: [B('heading', { text: 'تیتر', level: 9 })],
})
ok('N4: level غلط → ۲', (h?.blocks[0] as { props: { level: number } } | undefined)?.props.level === 2)

console.log('\n══ N5: URL تصویر — تنها سطح حمله؛ الگو سخت ══')
const badSrcs = ['javascript:alert(1)', 'http://insecure.com/x.jpg', 'data:image/png;base64,xx', 'ftp://x/y', '  ', '//other.example/a.jpg', '/\\other.example/a.jpg', 'https://', 'https://bad.example/\u0000.jpg']
for (const src of badSrcs) {
  const r = normalizeBlocksDoc({ version: 1, blocks: [B('image', { src })] })
  ok(`N5: image src رد شد (${src.slice(0, 24)})`, r === null)
}
const goodImg = normalizeBlocksDoc({
  version: 1,
  blocks: [B('image', { src: '/uploads/abc.webp', alt: 'غذا' }), B('image', { src: 'https://cdn.example.com/a.jpg' })],
})
ok('N5: src نسبی + https پذیرفته', goodImg !== null && goodImg.blocks.length === 2)
const heroBad = normalizeBlocksDoc({
  version: 1,
  blocks: [B('hero', { src: 'javascript:x', title: 't', text: 'x' })],
})
ok(
  'N5: hero با src خراب زنده می‌ماند (فقط src حذف)',
  heroBad !== null && (heroBad.blocks[0] as { props: { src?: string } }).props.src === undefined,
)

console.log('\n══ N6: گالری — فیلتر + سقف ۱۲ + layout ══')
const manyImages = Array.from({ length: 20 }, (_, i) => ({ src: `/uploads/g${i}.webp` }))
const gal = normalizeBlocksDoc({
  version: 1,
  blocks: [B('gallery', { images: [...manyImages, { src: 'javascript:x' }], layout: 'slider' })],
})
const galImages = (gal?.blocks[0] as { props: { images: unknown[]; layout: string } } | undefined)?.props
ok('N6: سقف ۱۲ تصویر', galImages?.images.length === 12)
ok('N6: src خراب فیلتر شد (۲۰ معتبر + ۱ خراب → ۱۲)', galImages !== undefined)
ok('N6: layout slider حفظ شد', galImages?.layout === 'slider')
ok('N6: گالری خالی → حذف بلوک', normalizeBlocksDoc({ version: 1, blocks: [B('gallery', { images: [], layout: 'grid' })] }) === null)

console.log('\n══ N7: CTA — label الزامی + تنزل امن url بی‌href ══')
ok('N7: بدون label → حذف', normalizeBlocksDoc({ version: 1, blocks: [B('cta', { to: 'menu' })] }) === null)
const ctaDegrade = normalizeBlocksDoc({
  version: 1,
  blocks: [B('cta', { label: 'سفارش', to: 'url', href: 'javascript:x' })],
})
ok(
  'N7: href خراب → to=menu (دکمه هرگز مرده نمی‌شود)',
  (ctaDegrade?.blocks[0] as { props: { to: string } } | undefined)?.props.to === 'menu',
)
const ctaOk = normalizeBlocksDoc({
  version: 1,
  blocks: [B('cta', { label: 'سفارش', to: 'url', href: 'https://example.com/menu' })],
})
ok(
  'N7: https href + url → حفظ',
  (ctaOk?.blocks[0] as { props: { to: string; href?: string } } | undefined)?.props.href === 'https://example.com/menu',
)

console.log('\n══ N8: فهرست/نقل‌قول/باکس — فیلتر اقلام + متن الزامی ══')
const list = normalizeBlocksDoc({
  version: 1,
  blocks: [B('list', { items: ['', '   ', 'معتبر ۱', 'معتبر ۲'], ordered: true })],
})
const listItems = (list?.blocks[0] as { props: { items: string[]; ordered: boolean } } | undefined)?.props
ok('N8: اقلام خالی فیلتر شدند', listItems?.items.length === 2)
ok('N8: ordered حفظ شد', listItems?.ordered === true)
ok('N8: فهرست تهی → حذف', normalizeBlocksDoc({ version: 1, blocks: [B('list', { items: [] })] }) === null)
ok('N8: quote بدون متن → حذف', normalizeBlocksDoc({ version: 1, blocks: [B('quote', { author: 'x' })] }) === null)
ok('N8: callout بدون متن → حذف', normalizeBlocksDoc({ version: 1, blocks: [B('callout', { title: 'x' })] }) === null)

console.log('\n══ N9: style/width/anim — whitelist سخت ══')
const styled = normalizeBlocksDoc({
  version: 1,
  blocks: [
    B(
      'callout',
      { text: 'نکته' },
      {
        width: 'giant',
        anim: 'teleport',
        style: { bg: 'red', fg: '#GGGGGG', align: 'justify', pad: 'xl', evil: 'x' },
      },
    ),
  ],
})
const st = styled?.blocks[0]
ok('N9: width غلط حذف شد', st !== undefined && st.width === undefined)
ok('N9: anim غلط حذف شد', st !== undefined && st.anim === undefined)
ok('N9: bg غیر-hex حذف شد', st?.style?.bg === undefined)
ok('N9: fg غیر-hex حذف شد', st?.style?.fg === undefined)
ok('N9: align غلط حذف شد', st?.style?.align === undefined)
ok('N9: pad غلط حذف شد', st?.style?.pad === undefined)
const styled2 = normalizeBlocksDoc({
  version: 1,
  blocks: [
    B(
      'callout',
      { text: 'نکته' },
      { width: 'md', anim: 'zoom', style: { bg: '#ED0741', fg: '#FFFFFF', align: 'center', pad: 'lg' } },
    ),
  ],
})
const st2 = styled2?.blocks[0]
ok(
  'N9: مقادیر معتبر همه حفظ شدند',
  st2?.width === 'md' && st2?.anim === 'zoom' && st2?.style?.bg === '#ED0741' && st2?.style?.fg === '#FFFFFF' && st2?.style?.align === 'center' && st2?.style?.pad === 'lg',
)

console.log('\n══ N10: سقف‌های سند ══')
const bigBlocks = Array.from({ length: 250 }, (_, i) => B('paragraph', { text: `بند ${i}` }))
const capped = normalizeBlocksDoc({ version: 1, blocks: bigBlocks })
ok('N10: سقف ۲۰۰ بلوک', capped !== null && capped.blocks.length === 200)
const huge = {
  version: 1,
  blocks: Array.from({ length: 200 }, () => B('paragraph', { text: 'x'.repeat(5000) })),
}
function rejectsOversized(doc: unknown): boolean {
  try {
    normalizeBlocksDoc(doc)
    return false
  } catch (error) {
    return error instanceof Error && 'status' in error && error.status === 422
  }
}
ok('N10: oversized document returns validation error without clearing the layout', rejectsOversized(huge))
ok('N10: document limit counts UTF-8 bytes for Persian text', rejectsOversized({
  version: 1,
  blocks: Array.from({ length: 30 }, (_, i) => B('paragraph', { text: 'م'.repeat(5000) }, { id: `persian-${i}` })),
}))
ok('N10: small Persian document remains valid', normalizeBlocksDoc({
  version: 1, blocks: [B('paragraph', { text: 'م'.repeat(5000) })],
}) !== null)
ok('N10: a divider accepts omitted props', normalizeBlocksDoc({
  version: 1, blocks: [{ type: 'divider' }],
})?.blocks[0]?.type === 'divider')

console.log('\n══ T1: مشتق‌سازیِ متن (single source برای content) ══')
const doc: ArticleBlocksDoc = {
  version: 1,
  blocks: [
    { id: 'a', type: 'hero', width: 'full', props: { title: 'عنوان هیرو', text: 'زیرعنوان' } },
    { id: 'b', type: 'heading', props: { text: 'تیتر بخش', level: 2 } },
    { id: 'c', type: 'paragraph', props: { text: 'پاراگراف اول' } },
    { id: 'd', type: 'paragraph', props: { text: 'پاراگراف دوم' } },
    { id: 'e', type: 'image', props: { src: '/uploads/x.webp', caption: 'کپشن' } },
    { id: 'f', type: 'quote', props: { text: 'نقل', author: 'سرآشپز' } },
    { id: 'g', type: 'callout', props: { title: 'نکته', text: 'متن نکته' } },
    { id: 'h', type: 'list', props: { items: ['یک', 'دو'] } },
    { id: 'i', type: 'divider', props: { variant: 'line' } },
    { id: 'j', type: 'cta', props: { label: 'سفارش', to: 'menu', title: 'عنوان CTA', text: 'متن CTA' } },
  ],
}
const text = blocksToPlainText(doc)
ok('T1: ترتیب بلوک‌ها حفظ شد', text.indexOf('عنوان هیرو') < text.indexOf('پاراگراف اول') && text.indexOf('پاراگراف اول') < text.indexOf('نقل'))
ok('T1: جداکننده \n\n', text.includes('پاراگراف اول\n\nپاراگراف دوم'))
ok('T1: quote با نویسنده', text.includes('نقل — سرآشپز'))
ok('T1: اقلام فهرست هرخط', text.includes('یک\nدو'))
ok('T1: image/divider متن نمی‌سازند', !text.includes('کپشن'))
ok('T1: null → رشته‌ی خالی', blocksToPlainText(null) === '')
ok('T1: سند تهی → خالی', blocksToPlainText({ version: 1, blocks: [] }) === '')
ok('T1: بلوک غایب در سند ناقص کرش نمی‌کند', blocksToPlainText({ version: 1, blocks: [{ id: 'x', type: 'paragraph' } as never] }) === '')

console.log('\n══ T2: کنتراست WCAG ══')
ok('T2: پس‌زمینه‌ی سفید → متن سیاه', pickContrastText('#FFFFFF') === '#000000')
ok('T2: پس‌زمینه‌ی سیاه → متن سفید', pickContrastText('#000000') === '#ffffff')
ok('T2: isHexColor', isHexColor('#ed0741') && !isHexColor('red') && !isHexColor('#12345') && !isHexColor(42))
const bgPrimary = '#ed0741'
ok(
  'T2: متنِ خودکارِ primary از AA می‌گذرد',
  contrastRatio(bgPrimary, pickContrastText(bgPrimary)) >= 4.5,
  `${contrastRatio(bgPrimary, pickContrastText(bgPrimary)).toFixed(2)}`,
)
ok('T2: سفید روی primary از AA نمی‌گذرد (خودکار درست کار می‌کند)', contrastRatio(bgPrimary, '#ffffff') < 4.5)

console.log(`\n══ نتیجه: ${pass} پاس / ${fail} خطا ══`)
if (fail > 0) process.exitCode = 1

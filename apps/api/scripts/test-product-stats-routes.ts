/** HTTP visitor identity regressions; no database or network required. */
import assert from 'node:assert/strict'
import { Elysia } from 'elysia'
import { menuRoutes } from '../src/http/routes/menu.routes'
import { UUID_RE } from '../src/domain/shared/ids'

const productId = crypto.randomUUID()
const visitors: string[] = []
const seen = new Set<string>()
const record = async (kind: string, id: string, visitor: string) => {
  visitors.push(visitor)
  const key = `${kind}:${id}:${visitor}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
}
const app = new Elysia().use(menuRoutes({
  menu: {} as never,
  cart: {} as never,
  settings: {} as never,
  redis: { incr: async () => 1, expire: async () => 1 } as never,
  stats: {
    recordView: (id: string, visitor: string) => record('view', id, visitor),
    recordCartAdd: (id: string, visitor: string) => record('cart', id, visitor),
  } as never,
})).compile()

const beacon = (kind: string, cookie?: string, ua: string | null = 'Mozilla/5.0', id: string = productId) =>
  app.handle(new Request(`http://localhost/menu/products/${id}/${kind}`, {
    method: 'POST',
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      ...(ua === null ? {} : { 'user-agent': ua }),
    },
  }))

for (const kind of ['view', 'cart-event']) {
  for (const invalid of [undefined, '', 'x'.repeat(65), 'not-a-uuid', '%E0%A4%A']) {
    const response = await beacon(kind, invalid === undefined ? undefined : `sinshin_vid=${invalid}`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { counted: true })
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const cookie = response.headers.get('set-cookie')
    assert.ok(cookie, `${kind}: missing and malformed visitor cookies are replaced`)
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=Lax/)
    const cookiePair = cookie.split(';')[0]!
    const visitor = cookiePair.slice('sinshin_vid='.length)
    assert.ok(UUID_RE.test(visitor), 'server issues a UUID identity')
    assert.equal(visitors.at(-1), visitor, 'counting uses the newly issued identity')

    const repeat = await beacon(kind, `unrelated=value; ${cookiePair}`)
    assert.deepEqual(await repeat.json(), { counted: false }, 'replacement identity deduplicates the next request')
    assert.equal(repeat.headers.get('set-cookie'), null, 'valid identities remain stable')
    assert.equal(visitors.at(-1), visitor)
  }
}

const sharedIdentity = `sinshin_vid=${crypto.randomUUID()}`
assert.deepEqual(await (await beacon('view', sharedIdentity)).json(), { counted: true })
assert.deepEqual(await (await beacon('cart-event', sharedIdentity)).json(), { counted: true })
assert.equal(visitors.at(-1), visitors.at(-2), 'view and cart events share one visitor identity')

for (const kind of ['view', 'cart-event']) {
  for (const ua of [null, 'Googlebot/2.1', 'Mozilla/5.0 HeadlessChrome']) {
    const before = visitors.length
    const response = await beacon(kind, undefined, ua)
    assert.deepEqual(await response.json(), { counted: false })
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(visitors.length, before, 'bots and missing user agents are not recorded')
  }
  const before = visitors.length
  assert.equal((await beacon(kind, undefined, 'Mozilla/5.0', 'invalid-product')).status, 422)
  assert.equal(visitors.length, before, 'invalid product IDs cannot reach the stats service')
}

console.log('PASS product stats routes: cookie repair, identity reuse, view/cart identity, bot filtering, UUID validation')

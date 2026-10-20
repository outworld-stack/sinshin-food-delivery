import { parsePaymentTarget } from '@sinshin/shared'

/** Navigate only to a supported bank. Mellat requires a browser form POST. */
export function navigateToPayment(paymentUrl: string): void {
  const target = parsePaymentTarget(paymentUrl)
  if (!target || target.method === 'MOCK') throw new Error('نشانی درگاه پرداخت معتبر نیست.')
  if (target.method === 'GET') {
    window.location.href = target.url
    return
  }
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = target.url
  form.style.display = 'none'
  const reference = document.createElement('input')
  reference.type = 'hidden'
  reference.name = 'RefId'
  reference.value = target.token
  form.appendChild(reference)
  document.body.appendChild(form)
  // Keep the form connected until navigation; removing it immediately can
  // cancel a browser's queued submission. Successful navigation discards it.
  try { form.submit() } catch (error) { form.remove(); throw error }
}

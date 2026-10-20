import assert from 'node:assert/strict'
import { parsePaymentTarget } from '@sinshin/shared'

assert.equal(parsePaymentTarget('https://payment.zarinpal.com/pg/StartPay/A123')?.gateway, 'ZARINPAL')
assert.equal(parsePaymentTarget('https://sandbox.zarinpal.com/pg/StartPay/S123')?.method, 'GET')
const sep = 'https://sep.shaparak.ir/api/v1/Payment/PaymentPage?Token=a%2Bb%2Fc%3D'
assert.deepEqual(parsePaymentTarget(sep), { gateway: 'SEP', method: 'GET', url: sep, token: 'a+b/c=' })
assert.deepEqual(parsePaymentTarget('https://bpm.shaparak.ir/StartPay/REF123'), {
  gateway: 'MELLAT', method: 'POST', url: 'https://bpm.shaparak.ir/pgwchannel/startpay.mellat', token: 'REF123',
})
const mock = '/api/payments/mock/00000000-0000-4000-8000-000000000001.0123456789abcdef0123456789abcdef'
assert.equal(parsePaymentTarget(mock)?.method, 'MOCK')

for (const value of [
  '', 'javascript:alert(1)', '//payment.zarinpal.com/pg/StartPay/A123',
  'http://payment.zarinpal.com/pg/StartPay/A123',
  'https://payment.zarinpal.com.attacker.example/pg/StartPay/A123',
  'https://payment.zarinpal.com@attacker.example/pg/StartPay/A123',
  'https://attacker@payment.zarinpal.com/pg/StartPay/A123',
  'https://payment.zarinpal.com:8443/pg/StartPay/A123',
  'https://payment.zarinpal.com/other/../pg/StartPay/A123',
  'https://payment.zarinpal.com/pg/StartPay/A123?redirect=https://attacker.example',
  'https://payment.zarinpal.com/pg/StartPay/A123#fragment',
  ' https://payment.zarinpal.com/pg/StartPay/A123',
  'https://payment.zarinpal.com/pg/StartPay/A123\n',
  'https://payment.zarinpal.com\\@attacker.example/pg/StartPay/A123',
  'https://sep.shaparak.ir/api/v1/Payment/PaymentPage?Token=a+b/c=',
  'https://sep.shaparak.ir/api/v1/Payment/PaymentPage?Token=%ZZ',
  'https://sep.shaparak.ir/api/v1/Payment/PaymentPage?Token=%22%3E%3Cscript%3E',
  'https://sep.shaparak.ir/api/v1/Payment/PaymentPage?Token=first&Token=second',
  'https://sep.shaparak.ir/api/v1/Payment/PaymentPage?Token=first&redirect=second',
  'https://bpm.shaparak.ir/StartPay/REF123?RefId=other',
  'https://bpm.shaparak.ir/StartPay/%22%3E%3Cscript%3E',
  'https://bpm.shaparak.ir/pgwchannel/startpay.mellat',
  '/api/payments/mock/not-a-signed-state',
  `https://attacker.example${mock}`,
]) assert.equal(parsePaymentTarget(value), null, value)
console.log('Payment target security passed: provider endpoints, encoded tokens, Mellat POST and malicious URL rejection.')

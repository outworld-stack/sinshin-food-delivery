// src/server/address.ts — CRUD آدرس از API واقعی
// ورودی‌ها برنددار — caller از UI خام با asAddressId() cast می‌کند

import { authJson } from '#/lib/api-fetch'
import type { AddressId, AddressDto } from '@sinshin/shared'

export async function listAddresses(): Promise<AddressDto[]> {
  return authJson<AddressDto[]>('/addresses', 'GET')
}

export async function addAddress(input: {
  title: string
  address: string
  lat: number
  lng: number
}): Promise<AddressDto> {
  return authJson<AddressDto>('/addresses', 'POST', input)
}

export async function updateAddress(input: {
  id: AddressId
  title: string
  address: string
  lat: number
  lng: number
}): Promise<AddressDto> {
  return authJson<AddressDto>(`/addresses/${input.id}`, 'PATCH', {
    title: input.title,
    address: input.address,
    lat: input.lat,
    lng: input.lng,
  })
}

export async function deleteAddress(id: AddressId): Promise<{ ok: boolean }> {
  return authJson<{ ok: boolean }>(`/addresses/${id}`, 'DELETE')
}
//src/domain/auth/token.service.ts
import { SignJWT, jwtVerify } from 'jose'
import type { AppConfig } from '#/infra/config/env'


const ISSUER = 'sinshin-foodpark'

export interface AccessClaims {
  /** شناسه‌ی کاربر */
  sub: string
  /** شناسه‌ی دستگاه */
  dev: string
  /** شناسه‌ی نشست */
  ses: string
  /** token_version — ابطال گروهی */
  tv: number
}

export class TokenService {
  private readonly secret: Uint8Array
  private readonly ttlMinutes: number

  constructor(config: AppConfig) {
    this.secret = new TextEncoder().encode(config.jwtSecret)
    this.ttlMinutes = config.accessTokenTtlMinutes
  }

  async sign(claims: AccessClaims): Promise<string> {
    return new SignJWT({ dev: claims.dev, ses: claims.ses, tv: claims.tv })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlMinutes}m`)
      .sign(this.secret)
  }

  async verify(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: ISSUER })
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.dev !== 'string' ||
        typeof payload.ses !== 'string' ||
        typeof payload.tv !== 'number'
      ) {
        return null
      }
      return { sub: payload.sub, dev: payload.dev, ses: payload.ses, tv: payload.tv }
    } catch {
      return null
    }
  }
}
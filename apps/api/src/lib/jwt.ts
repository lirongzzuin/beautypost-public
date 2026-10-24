import { randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'

const accessSecret = () => new TextEncoder().encode(process.env.JWT_SECRET!)
const refreshSecret = () => new TextEncoder().encode(process.env.JWT_REFRESH_SECRET!)

const ACCESS_EXPIRES = '15m'
const REFRESH_EXPIRES = '30d'

export async function signAccessToken(payload: { sub: string; email: string; role: string }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_EXPIRES)
    .sign(accessSecret())
}

export async function signRefreshToken(sub: string) {
  // jti: 같은 초에 두 번 로그인해도 토큰이 겹치지 않게 (refresh_tokens.token 은 unique)
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(REFRESH_EXPIRES)
    .sign(refreshSecret())
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, accessSecret())
  return payload as { sub: string; email: string; role: string; iat: number; exp: number }
}

export async function verifyRefreshToken(token: string) {
  const { payload } = await jwtVerify(token, refreshSecret())
  return payload as { sub: string; iat: number; exp: number }
}

export function getRefreshExpiryDate() {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d
}

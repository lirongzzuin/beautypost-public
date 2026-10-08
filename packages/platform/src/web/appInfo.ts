import type { AppInfoAdapter } from '../interface'
import { APP_VERSION } from '@beautypost/shared'

function detectInAppBrowser(): boolean {
  const ua = navigator.userAgent
  // Kakao/Naver in-app browser detection
  return /KAKAOTALK|NAVER|Line|Instagram|FB_IAB/i.test(ua)
}

function detectDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  const ua = navigator.userAgent
  if (/iPad|tablet/i.test(ua) || (window.innerWidth >= 768 && window.innerWidth < 1024)) return 'tablet'
  if (/iPhone|iPod|Android/i.test(ua) || window.innerWidth < 768) return 'mobile'
  return 'desktop'
}

export const webAppInfo: AppInfoAdapter = {
  platform: 'web',
  appVersion: APP_VERSION,
  buildNumber: '1',
  get isInAppBrowser() { return detectInAppBrowser() },
  get deviceType() { return detectDeviceType() },
}

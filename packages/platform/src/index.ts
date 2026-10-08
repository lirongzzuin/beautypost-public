// Platform interface — feature code imports only from here
// Web implementation: @beautypost/platform/web
// Future native implementation: @beautypost/platform/native (same interface)

export type { Platform, PlatformCapabilities } from './interface'
export type {
  PickedFile,
  UploadProgress,
  StorageAdapter,
  FilePickerAdapter,
  UploadTransportAdapter,
  ShareAdapter,
  ClipboardAdapter,
  ExternalBrowserAdapter,
  PushAdapter,
  DeepLinkAdapter,
  AppInfoAdapter,
  LifecycleAdapter,
} from './interface'

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPERATIONS_API_URL?: string;
  readonly VITE_APP_STAGE?: "development"|"staging"|"production";
  readonly VITE_AUTH_MODE?: "development"|"provider";
}

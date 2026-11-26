/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_IPFS_GATEWAY?: string;
  readonly VITE_CONTRACT_ADDRESS_ROLE_MANAGER?: string;
  readonly VITE_CONTRACT_ADDRESS_USER_REGISTRY?: string;
  readonly VITE_CONTRACT_ADDRESS_PRODUCT_REGISTRY?: string;
  readonly VITE_CONTRACT_ADDRESS_SUPPLY_CHAIN?: string;
  readonly VITE_CONTRACT_ADDRESS_PAYMENT_ESCROW?: string;
  readonly VITE_CONTRACT_ADDRESS_PAYMENT_TOKEN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: any[]) => void): void;
  removeListener?(event: string, handler: (...args: any[]) => void): void;
  isMetaMask?: boolean;
}
interface Window {
  ethereum?: Eip1193Provider;
}

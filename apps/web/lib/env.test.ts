import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { getAppEnv, getChainId } from './env';

describe('env', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('getChainId defaults to 421614 in development', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_CHAIN_ID', '');
    expect(getChainId()).toBe(421614);
  });

  it('getChainId defaults to 42161 in production', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_CHAIN_ID', '');
    expect(getChainId()).toBe(42161);
  });

  it('getChainId respects NEXT_PUBLIC_CHAIN_ID when a finite positive number', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_CHAIN_ID', '11155111');
    expect(getChainId()).toBe(11155111);
  });

  it('getChainId falls back to the env default when NEXT_PUBLIC_CHAIN_ID is not a finite positive number', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_CHAIN_ID', 'not-a-number');
    expect(getChainId()).toBe(421614);

    vi.stubEnv('NEXT_PUBLIC_CHAIN_ID', '-1');
    expect(getChainId()).toBe(421614);

    vi.stubEnv('NEXT_PUBLIC_CHAIN_ID', '0');
    expect(getChainId()).toBe(421614);
  });

  it('getAppEnv returns development when NEXT_PUBLIC_VERCEL_ENV is preview, regardless of NEXT_PUBLIC_APP_ENV', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview');
    expect(getAppEnv()).toBe('development');
  });

  it('getAppEnv returns production only when NEXT_PUBLIC_APP_ENV is exactly production and not a preview', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '');
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
    expect(getAppEnv()).toBe('production');

    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'staging');
    expect(getAppEnv()).toBe('development');
  });
});

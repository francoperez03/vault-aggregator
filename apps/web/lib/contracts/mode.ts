import { isContractConfigured } from './config';

/** Without addresses there is no vault: the app shows the config banner instead of faking data. */
export function isMisconfigured(): boolean {
  return !isContractConfigured();
}

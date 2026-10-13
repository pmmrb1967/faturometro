import type { AiErrorCode } from '../../ai/provider';
import { t } from '../../i18n/pt-PT';

export function aiErrorText(code: AiErrorCode): string {
  return t.ai.errors[code];
}

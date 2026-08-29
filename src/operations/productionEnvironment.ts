export interface ProductionEnvironmentIssue {
  key: string;
  code: string;
  message: string;
}

export interface ProductionEnvironmentReport {
  valid: boolean;
  issues: ProductionEnvironmentIssue[];
}

function has(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function isHttpsUrl(value: string | undefined): boolean {
  if (!has(value)) return false;
  try {
    return new URL(value as string).protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateProductionEnvironment(env: NodeJS.ProcessEnv = process.env): ProductionEnvironmentReport {
  const issues: ProductionEnvironmentIssue[] = [];
  const required = ['SESSION_SECRET', 'FIREBASE_PROJECT_ID', 'PUBLIC_APP_URL'] as const;

  for (const key of required) {
    if (!has(env[key])) issues.push({ key, code: 'REQUIRED', message: `${key} is required in production.` });
  }

  if (has(env.SESSION_SECRET) && (env.SESSION_SECRET as string).length < 32) {
    issues.push({ key: 'SESSION_SECRET', code: 'TOO_SHORT', message: 'SESSION_SECRET must contain at least 32 characters.' });
  }

  if (has(env.PUBLIC_APP_URL) && !isHttpsUrl(env.PUBLIC_APP_URL)) {
    issues.push({ key: 'PUBLIC_APP_URL', code: 'HTTPS_REQUIRED', message: 'PUBLIC_APP_URL must use HTTPS.' });
  }

  const whatsappToken = has(env.WHATSAPP_ACCESS_TOKEN);
  const whatsappPhone = has(env.WHATSAPP_PHONE_NUMBER_ID);
  if (whatsappToken !== whatsappPhone) {
    issues.push({ key: 'WHATSAPP_REAL_PROVIDER', code: 'PARTIAL_CONFIGURATION', message: 'WhatsApp access token and phone number id must be configured together.' });
  }

  return { valid: issues.length === 0, issues };
}

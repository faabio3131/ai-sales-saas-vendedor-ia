export type PilotCheckStatus = 'READY' | 'MISSING' | 'STRUCTURAL_ONLY';

/** External approvals are never inferred from environment-variable presence. */
export interface PilotExternalCertification {
 ownerAttested?:boolean;
 deploymentVerified?:boolean;
 tenJourneysVerified?:boolean;
 directorGoLiveApproved?:boolean;
}

export interface PilotReadinessCheck {
  key: string;
  required: boolean;
  status: PilotCheckStatus;
  note: string;
}

export interface PilotReadinessReport {
  tenantId: string;
  status: 'GO' | 'NO_GO';
  checks: PilotReadinessCheck[];
}

export function evaluatePilotReadiness(tenantId: string, env: NodeJS.ProcessEnv = process.env,
  evidence: PilotExternalCertification = {}): PilotReadinessReport {
  const has = (key: string) => Boolean(env[key]?.trim());
  const checks: PilotReadinessCheck[] = [
    { key: 'T08_1_OWNER_ATTESTED', required: true, status: evidence.ownerAttested===true?'READY':'MISSING',
      note: 'Authenticated owner approved exact unit/profile/catalog; not inferred from collected menu.' },
    { key: 'T08_3_DEPLOY_CERTIFIED', required: true, status: evidence.deploymentVerified===true?'READY':'MISSING',
      note: 'Real deploy, backup and rollback evidence is required; a CI alone is insufficient.' },
    { key: 'T08_4_TEN_JOURNEYS', required: true, status: evidence.tenJourneysVerified===true?'READY':'MISSING',
      note: 'All ten end-to-end pilot journeys require real evidence.' },
    { key: 'T08_5_DIRECTOR_APPROVAL', required: true, status: evidence.directorGoLiveApproved===true?'READY':'MISSING',
      note: 'Director must approve go-live explicitly.' },
    { key: 'SESSION_SECRET', required: true, status: has('SESSION_SECRET') ? 'READY' : 'MISSING', note: 'Server-side session signing secret configured.' },
    { key: 'FIREBASE_PROJECT_ID', required: true, status: has('FIREBASE_PROJECT_ID') ? 'READY' : 'MISSING', note: 'Firebase project configured for real tenant persistence/auth.' },
    { key: 'WHATSAPP_REAL_PROVIDER', required: true, status: has('WHATSAPP_ACCESS_TOKEN') && has('WHATSAPP_PHONE_NUMBER_ID') ? 'READY' : 'STRUCTURAL_ONLY', note: 'WhatsApp adapter exists structurally; real credentials are required for pilot traffic.' },
    { key: 'AI_REAL_PROVIDER', required: true, status: has('GEMINI_API_KEY') || has('OPENAI_API_KEY') || has('ANTHROPIC_API_KEY') ? 'READY' : 'STRUCTURAL_ONLY', note: 'Universal AI layer exists; at least one approved real provider credential is required.' },
    { key: 'PAYMENT_REAL_PROVIDER', required: false, status: has('PAYMENT_PROVIDER_API_KEY') ? 'READY' : 'STRUCTURAL_ONLY', note: 'Real payments are optional for initial conversational pilot unless the pilot scope includes checkout.' },
  ];
  const requiredReady = checks.filter((check) => check.required).every((check) => check.status === 'READY');
  return { tenantId, status: requiredReady ? 'GO' : 'NO_GO', checks };
}

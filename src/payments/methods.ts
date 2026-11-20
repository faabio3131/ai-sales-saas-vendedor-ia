import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ApplicationError } from '../infrastructure/errors';
import { TenantContext } from '../types/contracts';
import { CreatePaymentInput } from './model';

export interface PaymentMethodsConfig {
  tenantId: string;
  pixManualEnabled: boolean;
  cardOnDeliveryEnabled: boolean;
  cashOnDeliveryEnabled: boolean;
  pixKey?: string;
  updatedAt?: string;
}

export interface PaymentMethodsRepository {
  get(tenantId: string): Promise<PaymentMethodsConfig | null>;
  save(config: PaymentMethodsConfig): Promise<PaymentMethodsConfig>;
}

function firestore() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    initializeApp(projectId ? { projectId } : undefined);
  }
  return getFirestore();
}

export class FirestorePaymentMethodsRepository implements PaymentMethodsRepository {
  async get(tenantId: string) {
    const snapshot = await firestore().collection('paymentMethodSettings').doc(tenantId).get();
    const config = snapshot.data() as PaymentMethodsConfig | undefined;
    return config?.tenantId === tenantId ? config : null;
  }
  async save(config: PaymentMethodsConfig) {
    await firestore().collection('paymentMethodSettings').doc(config.tenantId).set(config);
    return config;
  }
}

export class InMemoryPaymentMethodsRepository implements PaymentMethodsRepository {
  private readonly configs = new Map<string, PaymentMethodsConfig>();
  async get(tenantId: string) { return this.configs.get(tenantId) ?? null; }
  async save(config: PaymentMethodsConfig) { this.configs.set(config.tenantId, config); return config; }
}

function denied(message: string): never {
  throw new ApplicationError({ category:'FORBIDDEN', code:'PAYMENT_METHODS_FORBIDDEN', message });
}

export class PaymentMethodsService {
  constructor(private readonly repository: PaymentMethodsRepository) {}

  async get(context: TenantContext): Promise<PaymentMethodsConfig> {
    const tenantId = context.tenantId?.trim();
    if (!tenantId) return denied('Authorized tenant context is required.');
    return await this.repository.get(tenantId) ?? {
      tenantId, pixManualEnabled:false, cardOnDeliveryEnabled:false, cashOnDeliveryEnabled:false,
    };
  }

  async isEnabled(tenantId: string, method: CreatePaymentInput['method']): Promise<boolean> {
    const config = await this.get({ tenantId, requestId:'payment-methods-check' });
    if (method === 'PIX_MANUAL') return config.pixManualEnabled && Boolean(config.pixKey);
    if (method === 'CARD_ON_DELIVERY') return config.cardOnDeliveryEnabled;
    if (method === 'CASH_ON_DELIVERY') return config.cashOnDeliveryEnabled;
    return false;
  }

  async update(context: TenantContext, payload: unknown): Promise<PaymentMethodsConfig> {
    if (context.role !== 'OWNER') return denied('Only the business owner can configure payment methods.');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ApplicationError({ category:'VALIDATION', code:'PAYMENT_METHODS_INVALID', message:'Invalid payment methods configuration.' });
    }
    const raw = payload as Record<string, unknown>;
    const keys = ['pixManualEnabled','cardOnDeliveryEnabled','cashOnDeliveryEnabled','pixKey'];
    if (Object.keys(raw).some(key => !keys.includes(key)) ||
      typeof raw.pixManualEnabled !== 'boolean' ||
      typeof raw.cardOnDeliveryEnabled !== 'boolean' ||
      typeof raw.cashOnDeliveryEnabled !== 'boolean' ||
      (raw.pixKey !== undefined && typeof raw.pixKey !== 'string')) {
      throw new ApplicationError({ category:'VALIDATION', code:'PAYMENT_METHODS_INVALID', message:'Invalid payment methods configuration.' });
    }
    const pixKey = typeof raw.pixKey === 'string' ? raw.pixKey.trim() : '';
    if (pixKey.length > 140 || (raw.pixManualEnabled && !pixKey)) {
      throw new ApplicationError({ category:'VALIDATION', code:'PAYMENT_PIX_KEY_REQUIRED', message:'A valid configured Pix key is required for manual Pix.' });
    }
    const current = await this.get(context);
    return this.repository.save({
      tenantId:current.tenantId,
      pixManualEnabled:raw.pixManualEnabled,
      cardOnDeliveryEnabled:raw.cardOnDeliveryEnabled,
      cashOnDeliveryEnabled:raw.cashOnDeliveryEnabled,
      ...(pixKey ? {pixKey}:{}),
      updatedAt:new Date().toISOString(),
    });
  }
}

import { useEffect, useMemo, useState } from 'react';
import { Activity, Bot, LockKeyhole, MessageCircle, RefreshCw, Target, Users } from 'lucide-react';
import { resolveWorkspaceMemberships, WorkspaceMembership } from './workspaceAccess';
import { authorizedWorkspacePage, workspacePageFromHash, workspacePageLinks } from './workspaceNavigation';
import { FinancialPanel } from './FinancialPanel';
import {CapabilityManager} from './CapabilityManager';
import { PilotOnboardingPanel } from './PilotOnboardingPanel';
import {ProviderConnectionPanel} from './ProviderConnectionPanel';

interface AttentionItem {
  kind: string;
  entityId: string;
  customerId: string;
  dueAt?: string;
  reason: string;
}

interface DashboardSnapshot {
  tenantId: string;
  generatedAt: string;
  attention: AttentionItem[];
  metrics: {
    leadsTotal: number;
    opportunitiesOpen: number;
    pipelineValueMinor: number;
    followUpsDue: number;
    recoveryOpen: number;
  };
}

function money(minor: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);
}

export function ProductWorkspaceView() {
  const [memberships, setMemberships] = useState<WorkspaceMembership[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessBlocked, setAccessBlocked] = useState(false);
  const [requestedPage, setRequestedPage] = useState(() => workspacePageFromHash(window.location.hash));

  useEffect(() => {
    const changePage = () => {
      setRequestedPage(workspacePageFromHash(window.location.hash));
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    window.addEventListener('hashchange', changePage);
    return () => window.removeEventListener('hashchange', changePage);
  }, []);

  const selectedMembership = useMemo(
    () => memberships.find((membership) => membership.tenantId === tenantId) ?? null,
    [memberships, tenantId],
  );

  const role = selectedMembership?.role ?? '';
  const page = authorizedWorkspacePage(requestedPage, role);
  const navigation = workspacePageLinks(role);
  const roleLabel = ({ OWNER: 'Proprietário', ADMIN: 'Administrador', MANAGER: 'Gerente', ATTENDANT: 'Atendente', OPERATOR: 'Operador', STAFF: 'Equipe', CASHIER: 'Caixa', DELIVERY: 'Entregador' } as Record<string,string>)[role] ?? 'Usuário';

  useEffect(() => {
    async function bootstrap() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/tenancy/memberships', { credentials: 'same-origin' });
        const payload = response.ok
          ? await response.json() as { ok: boolean; data: WorkspaceMembership[] }
          : { ok: false, data: [] as WorkspaceMembership[] };
        const resolution = resolveWorkspaceMemberships({
          responseStatus: response.status,
          memberships: payload.data,
          rememberedTenantId: localStorage.getItem('vendedor-ia:tenant-id'),
        });

        if (resolution.kind === 'BLOCKED') {
          localStorage.removeItem('vendedor-ia:tenant-id');
          setMemberships([]);
          setTenantId('');
          setDashboard(null);
          setAccessBlocked(true);
          return;
        }

        if (resolution.kind === 'ERROR') {
          throw new Error('Não foi possível carregar sua empresa.');
        }

        setAccessBlocked(false);
        setMemberships(resolution.memberships);
        setTenantId(resolution.tenantId);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Falha ao iniciar o ambiente comercial.');
      } finally {
        setLoading(false);
      }
    }
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    const controller = new AbortController();
    setDashboard(null);
    localStorage.setItem('vendedor-ia:tenant-id', tenantId);
    async function loadDashboard() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/dashboard', {
          signal: controller.signal,
          credentials: 'same-origin',
          headers: { 'x-tenant-id': tenantId },
        });
        if (!response.ok) throw new Error('Não foi possível carregar o painel comercial.');
        const payload = await response.json() as { ok: boolean; data: DashboardSnapshot };
        if (!controller.signal.aborted && payload.data.tenantId === tenantId) {
          setDashboard(payload.data);
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
        setDashboard(null);
        setError(caught instanceof Error ? caught.message : 'Falha ao carregar o painel comercial.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadDashboard();
    return () => controller.abort();
  }, [tenantId]);

  const cards = dashboard ? [
    { label: 'Leads', value: dashboard.metrics.leadsTotal, icon: Users },
    { label: 'Oportunidades', value: dashboard.metrics.opportunitiesOpen, icon: Target },
    { label: 'Pipeline', value: money(dashboard.metrics.pipelineValueMinor), icon: Activity },
    { label: 'Follow-ups hoje', value: dashboard.metrics.followUpsDue, icon: RefreshCw },
    { label: 'Recuperações', value: dashboard.metrics.recoveryOpen, icon: MessageCircle },
  ] : [];

  if (accessBlocked) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
        <section className="rounded-3xl border border-amber-500/20 bg-slate-900/70 p-6 text-center sm:p-10">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10">
            <LockKeyhole className="h-6 w-6 text-amber-300" />
          </div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Acesso comercial bloqueado</div>
          <h1 className="mt-3 text-2xl font-bold text-white">Nenhuma empresa autorizada para esta conta.</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">
            Sua autenticação foi reconhecida, mas esta conta não possui membership ativa em nenhuma empresa. Nenhum tenant, dashboard ou módulo comercial foi liberado.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <section className="mb-6 rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-slate-900 to-slate-950 p-5 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
              <Bot className="h-3.5 w-3.5" /> Vendedor IA ativo
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Seu comercial, em um só lugar.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Acompanhe leads, oportunidades, follow-ups e recuperação de vendas com isolamento seguro por empresa.</p>
          </div>
          {memberships.length > 0 && (
            <label className="text-xs text-slate-400">
              Empresa
              <select
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                className="mt-1 block min-w-48 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
              >
                {memberships.map((membership) => <option key={membership.tenantId} value={membership.tenantId}>{membership.tenantId}</option>)}
              </select>
            </label>
          )}
        </div>
      </section>

      {error && <div className="mb-5 rounded-2xl border border-rose-900/60 bg-rose-950/30 p-4 text-sm text-rose-300">{error}</div>}
      {loading && <div className="mb-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">Atualizando seu ambiente comercial...</div>}

      {selectedMembership && (
        <>
        <nav aria-label="Navegação principal" className="sticky top-0 z-30 mb-5 rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-lg">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2">
            <span className="text-sm font-semibold text-slate-100">{navigation.find(link => link.id === page)?.label}</span>
            <a href="#inicio" onClick={() => window.scrollTo({ top: 0, behavior: 'auto' })} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-emerald-300 focus-visible:outline-2 focus-visible:outline-emerald-400">Voltar ao início</a>
          </div>
          <div className="flex flex-wrap gap-1">
            {navigation.map(link => (
              <a key={link.id} href={'#' + link.id} aria-current={page === link.id ? 'page' : undefined}
                onClick={() => window.scrollTo({ top: 0, behavior: 'auto' })}
                className={'inline-flex min-h-11 items-center rounded-lg px-3 text-base font-medium focus-visible:outline-2 focus-visible:outline-emerald-400 ' +
                  (page === link.id ? 'bg-emerald-500 text-slate-950' : 'text-slate-200 hover:bg-slate-800')}>
                {link.label}
              </a>
            ))}
          </div>
        </nav>
        <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-slate-300">
          <span className="rounded-full border border-slate-800 px-2.5 py-1">Perfil: <strong>{roleLabel}</strong></span>
          <span className="rounded-full border border-slate-800 px-2.5 py-1">Empresa protegida</span>
        </div>

      <div hidden={page !== 'inicio'}>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map(({ label, value, icon: Icon }) => (
          <article key={label} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <Icon className="mb-3 h-5 w-5 text-emerald-400" />
            <div className="text-xl font-bold text-white">{value}</div>
            <div className="mt-1 text-xs text-slate-500">{label}</div>
          </article>
        ))}
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_0.6fr]">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-white">O que precisa da sua atenção</h2>
              <p className="mt-1 text-xs text-slate-500">Prioridades comerciais calculadas para a empresa selecionada.</p>
            </div>
            <Target className="h-5 w-5 text-emerald-400" />
          </div>
          {!dashboard?.attention.length && !loading && <p className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-400">Nenhuma ação pendente neste momento.</p>}
          <div className="space-y-2">
            {dashboard?.attention.slice(0, 8).map((item) => (
              <div key={`${item.kind}-${item.entityId}`} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <div className="text-sm font-medium text-slate-200">{item.reason}</div>
                <div className="mt-1 text-xs text-slate-500">{item.kind}{item.dueAt ? ` • ${new Date(item.dueAt).toLocaleString('pt-BR')}` : ''}</div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="font-semibold text-white">Capacidades multissetoriais</h2>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            As capacidades de cada empresa são configuradas por unidade em Empresa e módulos.
            Módulos planejados não aparecem como disponíveis até certificação.
          </p>
          <p className="mt-3 text-xs text-amber-300">Ativação comercial não autorizada.</p>
        </article>
      </section>
      </div>
      {(selectedMembership.role === 'OWNER' || selectedMembership.role === 'ADMIN') && (
        <div hidden={page !== 'financeiro'}>
          <FinancialPanel key={tenantId} tenantId={tenantId} role={selectedMembership.role} />
        </div>
      )}
      {selectedMembership.role === 'OWNER' && (
        <div hidden={page !== 'piloto'}>
          <PilotOnboardingPanel key={'onboarding-'+tenantId} tenantId={tenantId} role={selectedMembership.role} />
        </div>
      )}
      {selectedMembership.role === 'OWNER' && (
        <div hidden={page !== 'conexoes'}>
          <ProviderConnectionPanel key={'providers-'+tenantId} tenantId={tenantId} role={selectedMembership.role} />
        </div>
      )}
      <div hidden={page !== 'empresa'}>
        <CapabilityManager key={'capabilities-'+tenantId} tenantId={tenantId} role={selectedMembership.role} />
      </div>
        </>
      )}
    </div>
  );
}

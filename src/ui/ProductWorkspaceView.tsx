import { useEffect, useMemo, useState } from 'react';
import { Activity, Bot, Boxes, MessageCircle, RefreshCw, Target, Users } from 'lucide-react';

interface Membership {
  tenantId: string;
  userId: string;
  role: string;
  status: 'ACTIVE';
}

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
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedMembership = useMemo(
    () => memberships.find((membership) => membership.tenantId === tenantId) ?? null,
    [memberships, tenantId],
  );

  useEffect(() => {
    async function bootstrap() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/tenancy/memberships', { credentials: 'same-origin' });
        if (!response.ok) throw new Error('Não foi possível carregar sua empresa.');
        const payload = await response.json() as { ok: boolean; data: Membership[] };
        const active = payload.data ?? [];
        setMemberships(active);
        const remembered = localStorage.getItem('vendedor-ia:tenant-id');
        const initial = active.find((item) => item.tenantId === remembered)?.tenantId ?? active[0]?.tenantId ?? '';
        setTenantId(initial);
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
    localStorage.setItem('vendedor-ia:tenant-id', tenantId);
    async function loadDashboard() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/dashboard', {
          credentials: 'same-origin',
          headers: { 'x-tenant-id': tenantId },
        });
        if (!response.ok) throw new Error('Não foi possível carregar o painel comercial.');
        const payload = await response.json() as { ok: boolean; data: DashboardSnapshot };
        setDashboard(payload.data);
      } catch (caught) {
        setDashboard(null);
        setError(caught instanceof Error ? caught.message : 'Falha ao carregar o painel comercial.');
      } finally {
        setLoading(false);
      }
    }
    void loadDashboard();
  }, [tenantId]);

  const cards = dashboard ? [
    { label: 'Leads', value: dashboard.metrics.leadsTotal, icon: Users },
    { label: 'Oportunidades', value: dashboard.metrics.opportunitiesOpen, icon: Target },
    { label: 'Pipeline', value: money(dashboard.metrics.pipelineValueMinor), icon: Activity },
    { label: 'Follow-ups hoje', value: dashboard.metrics.followUpsDue, icon: RefreshCw },
    { label: 'Recuperações', value: dashboard.metrics.recoveryOpen, icon: MessageCircle },
  ] : [];

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
        <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full border border-slate-800 px-2.5 py-1">Perfil: <strong className="text-slate-300">{selectedMembership.role}</strong></span>
          <span className="rounded-full border border-slate-800 px-2.5 py-1">Tenant protegido</span>
        </div>
      )}

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
          <div className="mb-4 flex items-center gap-2"><Boxes className="h-5 w-5 text-sky-400" /><h2 className="font-semibold text-white">Módulos comerciais</h2></div>
          <div className="space-y-2 text-sm">
            {['Clientes e CRM', 'Conversas', 'Leads e oportunidades', 'Follow-up', 'Recuperação de vendas', 'Catálogo'].map((label) => (
              <div key={label} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
                <span className="text-slate-300">{label}</span><span className="text-xs text-emerald-400">Disponível</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

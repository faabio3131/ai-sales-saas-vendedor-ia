import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Terminal, 
  Layers, 
  FileText, 
  CheckCircle2, 
  Cpu, 
  Activity,
  AlertTriangle,
  BookOpen,
  Server
} from 'lucide-react';

interface HealthStatus {
  status: string;
  block: string;
  foundation: string;
  service: string;
  version: string;
  environment: string;
  uptimeSeconds?: number;
  timestamp: string;
  governance: {
    canonicalDocs: string;
    authority: string;
    tenantBoundaryPrepared: boolean;
    secretsServerSideOnly: boolean;
  };
  system?: {
    nodeVersion: string;
    rssMemoryMb: number;
  };
}

export const FoundationView: React.FC = () => {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then((data: HealthStatus) => {
        setHealth(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const architectureLayers = [
    { name: '1. Presentation Layer', desc: 'Web App / PWA Mobile First UI (React + Tailwind)', status: 'Foundation Active' },
    { name: '2. Application Layer', desc: 'Use Cases, Orquestração e Handlers', status: 'Ready for BLK-020' },
    { name: '3. Domain Layer', desc: 'Regras Comerciais, Entidades e State Machines', status: 'Contracts Defined' },
    { name: '4. AI Layer', desc: 'Universal AI Provider Interface & AI Router', status: 'Contracts Defined' },
    { name: '5. Automation Layer', desc: 'Events, Jobs, Timers, Follow-ups e Recovery', status: 'Planned' },
    { name: '6. Integration Layer', desc: 'WhatsApp, Pagamentos (Pix), Canais e Webhooks', status: 'Planned' },
    { name: '7. Infrastructure Layer', desc: 'Node.js server-side, Config, Error Handler & Telemetry', status: 'Foundation Active' },
  ];

  const governanceDocuments = [
    { code: '00', title: 'Authority and Execution Rules', file: '00_AUTHORITY_AND_EXECUTION_RULES.md' },
    { code: '01', title: 'Master Blueprint', file: 'MASTER.md' },
    { code: '02', title: 'Architecture Specification', file: 'ARCHITECTURE.md' },
    { code: '03', title: 'System Design & Rules', file: 'SYSTEM_DESIGN.md' },
    { code: '04', title: 'Requirements Specification', file: 'REQUIREMENTS.md' },
    { code: '05', title: 'Technical Contracts', file: 'TECHNICAL_CONTRACTS.md' },
    { code: '06', title: 'Data Model', file: 'DATA_MODEL.md' },
    { code: '07', title: 'Implementation Plan', file: 'IMPLEMENTATION_PLAN.md' },
    { code: '08', title: 'AI Studio Execution Protocol', file: 'AI_STUDIO_EXECUTION_PROTOCOL.md' },
  ];

  return (
    <div id="foundation-view" className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <header id="foundation-header" className="border-b border-slate-800 pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              BLK-010 Application Foundation Active
            </span>
            <span className="text-slate-400 text-xs tracking-wide uppercase font-mono">v1.0 Ready</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white mt-2">
            AI Sales SaaS — Vendedor IA
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Application Foundation & Repositório Estruturado
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-right">
            <p className="text-xs text-slate-400 font-mono">Runtime & Server</p>
            <p className="text-sm font-semibold text-emerald-400 flex items-center gap-1.5 justify-end">
              <Activity className="w-4 h-4" /> Node.js 22 + Express (Port 3000)
            </p>
          </div>
        </div>
      </header>

      <section id="system-status-card" className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Terminal className="w-5 h-5 text-blue-400" />
            Health Check & Status Técnico
          </h2>
          <span className="text-xs font-mono text-slate-500">GET /api/health</span>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            Verificando status da fundação...
          </div>
        )}

        {error && (
          <div className="bg-rose-950/40 border border-rose-800/60 text-rose-300 p-4 rounded-lg flex items-center gap-3 text-sm">
            <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
            <div>
              <p className="font-semibold">Erro ao consultar health check:</p>
              <p className="text-xs opacity-90">{error}</p>
            </div>
          </div>
        )}

        {health && (
          <div className="space-y-4 font-mono">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="bg-slate-950/80 border border-slate-800/80 p-3.5 rounded-lg">
                <span className="text-xs text-slate-500 block">Service Status</span>
                <span className="text-emerald-400 font-semibold text-base mt-0.5 block flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> {health.status.toUpperCase()} ({health.block})
                </span>
              </div>
              <div className="bg-slate-950/80 border border-slate-800/80 p-3.5 rounded-lg">
                <span className="text-xs text-slate-500 block">Tenant Boundary</span>
                <span className="text-sky-400 font-semibold text-base mt-0.5 block">
                  {health.governance.tenantBoundaryPrepared ? 'TenantContext Prepared' : 'Unchecked'}
                </span>
              </div>
              <div className="bg-slate-950/80 border border-slate-800/80 p-3.5 rounded-lg">
                <span className="text-xs text-slate-500 block">Secrets Security</span>
                <span className="text-amber-400 font-semibold text-base mt-0.5 block">
                  {health.governance.secretsServerSideOnly ? 'Server-Side Only' : 'Exposed'}
                </span>
              </div>
            </div>

            {health.system && (
              <div className="bg-slate-950/50 border border-slate-800/60 p-3 rounded-lg flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2">
                <span className="flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-slate-500" />
                  Node: <strong className="text-slate-300">{health.system.nodeVersion}</strong>
                </span>
                <span>Uptime: <strong className="text-slate-300">{health.uptimeSeconds}s</strong></span>
                <span>Memória RSS: <strong className="text-slate-300">{health.system.rssMemoryMb} MB</strong></span>
                <span>Ambiente: <strong className="text-slate-300">{health.environment}</strong></span>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section id="architecture-layers" className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            Camadas Arquiteturais Oficiais
          </h2>
          <div className="space-y-2.5">
            {architectureLayers.map((layer, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-slate-950/50 border border-slate-800/70 rounded-lg text-sm">
                <div>
                  <p className="font-medium text-slate-200">{layer.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{layer.desc}</p>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {layer.status}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section id="governance-matrix" className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-400" />
            Governança Canônica (/docs)
          </h2>
          <p className="text-xs text-slate-400">
            A documentação técnica é a autoridade canônica. Nenhum executor técnico possui autonomia para alterar o domínio comercial.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {governanceDocuments.map((doc, idx) => (
              <div key={idx} className="p-2.5 bg-slate-950/50 border border-slate-800/70 rounded-lg flex items-center gap-2.5">
                <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <div className="truncate">
                  <p className="text-xs font-medium text-slate-300 truncate">{doc.title}</p>
                  <p className="text-[11px] text-slate-500 font-mono truncate">{doc.file}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 bg-blue-950/30 border border-blue-800/40 rounded-lg text-xs text-blue-300">
            <p className="font-semibold flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
              Hierarquia de Decisão:
            </p>
            <p className="mt-1 text-slate-400">
              1. Diretor Humano &rarr; 2. ChatGPT Arquiteto/Engenheiro/Executor &rarr; 3. GitHub como fonte canônica do código.
            </p>
          </div>
        </section>
      </div>

      <footer id="foundation-footer" className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-5 text-xs text-slate-400 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-slate-400" />
          <span>Status do Bloco: <strong>BLK-010 — Application Foundation Consolidado</strong></span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span>TypeScript: Estrito</span>
          <span>&bull;</span>
          <span>Porta: 3000 (0.0.0.0)</span>
          <span>&bull;</span>
          <span>Build: Validador CJS/Vite</span>
        </div>
      </footer>
    </div>
  );
};

import { FormEvent, useEffect, useState } from 'react';
import { LogIn, LogOut, ShieldCheck, UserPlus } from 'lucide-react';
import { AuthClientError, loginWithEmail, logout, registerWithEmail } from '../auth/client';
import { AuthPrincipal } from '../auth/contracts';
import { FoundationView } from './FoundationView';

interface SessionResponse {
  ok: boolean;
  data?: { authenticated: true; user: AuthPrincipal };
}

function authErrorMessage(error: unknown): string {
  const code = error instanceof AuthClientError ? error.publicCode : 'UNKNOWN';
  const messages: Record<string, string> = {
    'auth/email-already-in-use': 'Esta conta já existe. Use a opção Entrar.',
    'auth/invalid-credential': 'E-mail ou senha inválidos.',
    'auth/invalid-email': 'O e-mail informado não é válido.',
    'auth/operation-not-allowed': 'Login por e-mail e senha não está habilitado no Firebase.',
    'auth/unauthorized-domain': 'Este domínio do Cloud Run ainda não está autorizado no Firebase Authentication.',
    'auth/weak-password': 'A senha não atende aos requisitos mínimos do Firebase.',
    'auth/network-request-failed': 'Falha de rede ao acessar o Firebase Authentication.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'A chave pública do Firebase Web está inválida ou não foi aplicada corretamente.',
    FIREBASE_WEB_CONFIG_UNAVAILABLE: 'A configuração pública do Firebase não está disponível neste ambiente.',
    FIREBASE_WEB_CONFIG_INVALID: 'A configuração pública do Firebase está incompleta ou inválida.',
    SERVER_SESSION_FAILED: 'O Firebase autenticou o usuário, mas o backend não conseguiu criar a sessão segura.',
    FIREBASE_AUTH_FAILED: 'O Firebase Authentication rejeitou a solicitação. Código técnico: FIREBASE_AUTH_FAILED.',
  };
  return messages[code] ?? 'Não foi possível autenticar. Confira os dados e tente novamente.';
}

export function AuthView() {
  const [user, setUser] = useState<AuthPrincipal | null>(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshSession() {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
      if (!response.ok) {
        setUser(null);
        return;
      }
      const payload = (await response.json()) as SessionResponse;
      setUser(payload.data?.user ?? null);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void refreshSession();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await loginWithEmail(email.trim(), password);
      else await registerWithEmail(email.trim(), password);
      await refreshSession();
      setPassword('');
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    await logout();
    setUser(null);
    setBusy(false);
  }

  if (checking) {
    return <main className="min-h-screen bg-slate-950 text-slate-300 grid place-items-center">Verificando sessão segura...</main>;
  }

  if (user) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="max-w-6xl mx-auto px-4 pt-4 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            Sessão autenticada: <strong className="text-slate-200">{user.email ?? user.authUserId}</strong>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-900 disabled:opacity-50"
          >
            <LogOut className="w-4 h-4" /> Sair
          </button>
        </div>
        <FoundationView />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-2.5">
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Vendedor IA</h1>
            <p className="text-sm text-slate-400">Acesso seguro ao seu ambiente comercial</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-5 rounded-xl bg-slate-950/70 p-1">
          <button type="button" onClick={() => setMode('login')} className={`rounded-lg px-3 py-2 text-sm ${mode === 'login' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}>Entrar</button>
          <button type="button" onClick={() => setMode('register')} className={`rounded-lg px-3 py-2 text-sm ${mode === 'register' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}>Criar conta</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm">
            <span className="text-slate-300">E-mail</span>
            <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 outline-none focus:border-emerald-500" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">Senha</span>
            <input type="password" required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 outline-none focus:border-emerald-500" />
          </label>

          {error && <div className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</div>}

          <button type="submit" disabled={busy} className="w-full rounded-lg bg-emerald-500 px-4 py-3 font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {mode === 'login' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            {busy ? 'Processando...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>

        <p className="mt-5 text-xs leading-relaxed text-slate-500">BLK-020 autentica a identidade do usuário. Empresa, tenant e permissões serão vinculados somente no BLK-030.</p>
      </section>
    </main>
  );
}

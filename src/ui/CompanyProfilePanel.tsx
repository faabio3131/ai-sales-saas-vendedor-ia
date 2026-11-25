import { useEffect, useState, type FormEvent } from 'react';
import type { BusinessProfileRevision } from '../business/model';
import { companyDraft, companyRevision, type CompanyDraft } from './companyProfileEditor';

const fields: readonly {key: keyof CompanyDraft; label: string; maxLength: number}[] = [
  {key:'business_name', label:'Nome do estabelecimento', maxLength:120},
  {key:'assistantName', label:'Nome do assistente', maxLength:60},
  {key:'contact', label:'Contato comercial', maxLength:160},
  {key:'address', label:'Endereço', maxLength:240},
  {key:'hours', label:'Horários de funcionamento', maxLength:400},
];

function message(code?: string) {
  if (code === 'BUSINESS_VERSION_CONFLICT') return 'O cadastro foi alterado em outra operação. Reabra os dados antes de editar.';
  if (code === 'BUSINESS_MANAGEMENT_DENIED') return 'Você não tem permissão para editar este cadastro.';
  if (code === 'BUSINESS_TEXT_INVALID' || code === 'BUSINESS_IDENTITY_INVALID') return 'Confira os campos obrigatórios e seus limites de tamanho.';
  return 'Não foi possível concluir a operação. Confira os dados ou tente novamente.';
}

export function CompanyProfilePanel({tenantId,unitId}:{tenantId:string;unitId:string}) {
  const [profile,setProfile]=useState<BusinessProfileRevision|null>(null);
  const [draft,setDraft]=useState<CompanyDraft|null>(null);
  const [editing,setEditing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [reload,setReload]=useState(0);
  const base='/api/business/units/'+encodeURIComponent(unitId);

  useEffect(()=>{
    const ctrl=new AbortController();
    setLoading(true);setError('');setNotice('');setEditing(false);setProfile(null);setDraft(null);
    fetch(base+'/latest',{credentials:'same-origin',headers:{'x-tenant-id':tenantId},signal:ctrl.signal})
      .then(async res=>{
        const body=await res.json() as {ok:boolean;data:BusinessProfileRevision|null;error?:{code:string}};
        if(!res.ok||!body.ok)throw new Error(message(body.error?.code));
        if(!ctrl.signal.aborted && body.data?.tenantId===tenantId && body.data.unitId===unitId) {
          setProfile(body.data);setDraft(companyDraft(body.data));
        }
      }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:message());})
      .finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[base,tenantId,unitId,reload]);

  async function save(event:FormEvent){
    event.preventDefault();
    if(!profile||!draft||busy||!editing)return;
    setBusy(true);setError('');setNotice('');
    try{
      const body=companyRevision(profile,draft,new Date().toISOString());
      const res=await fetch(base+'/revisions',{method:'POST',credentials:'same-origin',
        headers:{'content-type':'application/json','x-tenant-id':tenantId},body:JSON.stringify(body)});
      const result=await res.json() as {ok:boolean;data:BusinessProfileRevision;error?:{code:string}};
      if(!res.ok||!result.ok)throw new Error(message(result.error?.code));
      if(result.data?.tenantId!==tenantId||result.data.unitId!==unitId||result.data.version!==profile.version+1)throw new Error('A gravação não pôde ser confirmada. Consulte o cadastro antes de tentar novamente.');
      setProfile(result.data);setDraft(companyDraft(result.data));setEditing(false);
      setNotice('Dados da empresa salvos com sucesso. Versão '+result.data.version+'.');
    }catch(e){setError(e instanceof Error?e.message:message());}
    finally{setBusy(false);}
  }

  return <section className="mt-5 rounded-2xl border border-slate-700 bg-slate-900/70 p-5 sm:p-6" aria-label="Dados da empresa">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold text-white">Dados da empresa</h2>
      <p className="mt-1 text-base text-slate-300">Consulte e atualize o cadastro existente da unidade {unitId}.</p></div>
      {profile&&<span className="text-sm text-slate-300">Versão {profile.version}</span>}
    </div>
    {loading&&<p role="status" className="mt-3 text-base">Consultando cadastro...</p>}
    {!loading&&profile&&draft&&<form onSubmit={save} className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
      {fields.map(({key,label,maxLength})=><label key={key} className="block text-base text-slate-200">
        {label}
        <input required minLength={2} maxLength={maxLength} readOnly={!editing||busy}
          className="mt-1 block min-h-12 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white focus-visible:outline-2 focus-visible:outline-emerald-400"
          value={draft[key]} onChange={e=>setDraft(old=>old?{...old,[key]:e.target.value}:old)} />
      </label>)}
      </div>
      <p className="text-sm text-slate-300">Os módulos, o modo operacional e as permissões permanecem inalterados.</p>
      <div className="flex flex-wrap gap-2">
        {editing?<><button disabled={busy} type="submit" className="min-h-11 rounded-lg bg-emerald-500 px-4 text-base font-semibold text-slate-950 disabled:opacity-50">{busy?'Salvando...':'Salvar alterações'}</button>
        <button disabled={busy} type="button" className="min-h-11 rounded-lg border border-slate-600 px-4 text-base" onClick={()=>{setDraft(companyDraft(profile));setEditing(false);setError('');}}>Cancelar</button></>:
        <button type="button" className="min-h-11 rounded-lg bg-emerald-500 px-4 text-base font-semibold text-slate-950" onClick={()=>{setEditing(true);setNotice('');}}>Editar dados da empresa</button>}
        <button disabled={busy} type="button" className="min-h-11 rounded-lg border border-slate-600 px-4 text-base disabled:opacity-50" onClick={()=>{if(!editing||window.confirm('Descartar alterações não salvas?'))setReload(n=>n+1);}}>Atualizar cadastro</button>
      </div>
    </form>}
    {!loading&&!profile&&!error&&<p className="mt-3 text-base text-amber-300">Cadastro não encontrado para esta unidade.</p>}
    {error&&<p role="alert" className="mt-3 text-base text-rose-300">{error}</p>}
    {notice&&<p role="status" className="mt-3 text-base text-emerald-300">{notice}</p>}
  </section>;
}

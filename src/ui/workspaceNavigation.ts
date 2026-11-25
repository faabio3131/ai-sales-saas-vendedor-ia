export type WorkspacePage = 'inicio' | 'financeiro' | 'empresa' | 'conexoes' | 'piloto';

export interface WorkspacePageLink {
  id: WorkspacePage;
  label: string;
}

const links: readonly WorkspacePageLink[] = [
  {id: 'inicio', label: 'Início'},
  {id: 'empresa', label: 'Empresa e módulos'},
  {id: 'financeiro', label: 'Financeiro'},
  {id: 'conexoes', label: 'Conexões'},
  {id: 'piloto', label: 'Piloto alimentar'},
];

export function workspacePageFromHash(hash: string): WorkspacePage {
  return links.find(link => '#' + link.id === hash)?.id ?? 'inicio';
}

export function workspacePageLinks(role: string): WorkspacePageLink[] {
  return links.filter(({id}) => {
    if (id === 'financeiro') return role === 'OWNER' || role === 'ADMIN';
    if (id === 'conexoes' || id === 'piloto') return role === 'OWNER';
    return true;
  });
}

export function authorizedWorkspacePage(page: WorkspacePage, role: string): WorkspacePage {
  return workspacePageLinks(role).some(link => link.id === page) ? page : 'inicio';
}

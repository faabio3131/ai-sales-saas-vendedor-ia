import { describe, expect, it } from 'vitest';
import { authorizedWorkspacePage, workspacePageFromHash, workspacePageLinks } from '../src/ui/workspaceNavigation';

describe('workspace navigation', () => {
  it('returns to home for missing or unsupported routes', () => {
    expect(workspacePageFromHash('')).toBe('inicio');
    expect(workspacePageFromHash('#unknown')).toBe('inicio');
    expect(workspacePageFromHash('#inicio')).toBe('inicio');
  });
  it('supports direct navigation and history for each visible module', () => {
    for (const {id} of workspacePageLinks('OWNER')) {
      expect(workspacePageFromHash('#' + id)).toBe(id);
      expect(authorizedWorkspacePage(id, 'OWNER')).toBe(id);
    }
  });
  it('preserves the existing role restrictions', () => {
    expect(workspacePageLinks('OWNER').map(x => x.id)).toEqual(['inicio','empresa','financeiro','conexoes','piloto']);
    expect(workspacePageLinks('ADMIN').map(x => x.id)).toEqual(['inicio','empresa','financeiro']);
    for (const role of ['MANAGER','ATTENDANT','OPERATOR','STAFF','CASHIER','DELIVERY','']) {
      expect(workspacePageLinks(role).map(x => x.id)).toEqual(['inicio','empresa']);
      expect(authorizedWorkspacePage('financeiro',role)).toBe('inicio');
      expect(authorizedWorkspacePage('conexoes',role)).toBe('inicio');
      expect(authorizedWorkspacePage('piloto',role)).toBe('inicio');
    }
  });
  it('blocks owner-only routes for administrators and allows finance', () => {
    expect(authorizedWorkspacePage('conexoes','ADMIN')).toBe('inicio');
    expect(authorizedWorkspacePage('piloto','ADMIN')).toBe('inicio');
    expect(authorizedWorkspacePage('financeiro','ADMIN')).toBe('financeiro');
  });
});

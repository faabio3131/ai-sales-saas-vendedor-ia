import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProviderConnectionPanel} from '../src/ui/ProviderConnectionPanel';
describe('Evolution owner-only UI surface',()=>{
 it('renders both channels only for OWNER and preserves disabled commercial wording',()=>{
  const owner=renderToStaticMarkup(createElement(ProviderConnectionPanel,{tenantId:'fixture',role:'OWNER'}));
  expect(owner).toContain('WhatsApp por QR Code');expect(owner).toContain('WhatsApp oficial (Meta)');
  expect(owner).toContain('Pareamento não libera atendimento automático');
  expect(owner).toContain('Estado não verificado');
  expect(renderToStaticMarkup(createElement(ProviderConnectionPanel,{tenantId:'fixture',role:'STAFF'}))).toBe('');
 });
});

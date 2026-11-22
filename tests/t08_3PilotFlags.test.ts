import {describe,expect,it} from 'vitest';
import {pilotLiveFeatureEnabled,requirePilotLiveFeature} from '../src/operations/pilotFlags';

const allowed=JSON.stringify({
  'tenant-one': { main: ['ONLINE_PAYMENT_CREATE','WHATSAPP_OUTBOUND'] },
  'tenant-two': { kiosk: ['WHATSAPP_OUTBOUND'] },
});
const prod={NODE_ENV:'production',ATENDEVENDE_PILOT_LIVE_ENABLED:'true',
  ATENDEVENDE_PILOT_GO_LIVE_APPROVED:'true',ATENDEVENDE_PILOT_ALLOWED_UNITS:allowed};
describe('T08.3 — pilot global kill switch and exact tenant/unit allowlist',()=>{
  it('denies by default in production, staging and development',()=>{
    for(const mode of ['production','development','staging']) {
      expect(pilotLiveFeatureEnabled('WHATSAPP_OUTBOUND','tenant-one','main',{NODE_ENV:mode})).toBe(false);
    }
    expect(()=>requirePilotLiveFeature('ONLINE_PAYMENT_CREATE','tenant-one','main',{NODE_ENV:'production'}))
      .toThrowError(expect.objectContaining({code:'PILOT_FEATURE_DISABLED'}));
  });
  it('requires BOTH global switch and human-approval declaration',()=>{
    expect(pilotLiveFeatureEnabled('ONLINE_PAYMENT_CREATE','tenant-one','main',{...prod,ATENDEVENDE_PILOT_LIVE_ENABLED:'false'})).toBe(false);
    expect(pilotLiveFeatureEnabled('ONLINE_PAYMENT_CREATE','tenant-one','main',{...prod,ATENDEVENDE_PILOT_GO_LIVE_APPROVED:'false'})).toBe(false);
  });
  it('enforces exact tenant, unit and feature with no wildcard',()=>{
    expect(pilotLiveFeatureEnabled('ONLINE_PAYMENT_CREATE','tenant-one','main',prod)).toBe(true);
    expect(pilotLiveFeatureEnabled('WHATSAPP_OUTBOUND','tenant-two','kiosk',prod)).toBe(true);
    expect(pilotLiveFeatureEnabled('ONLINE_PAYMENT_CREATE','tenant-two','kiosk',prod)).toBe(false);
    expect(pilotLiveFeatureEnabled('PSP_REFUND','tenant-one','main',prod)).toBe(false);
    expect(pilotLiveFeatureEnabled('PSP_REFUND','tenant-two','kiosk',prod)).toBe(false);
    expect(pilotLiveFeatureEnabled('PSP_REFUND','tenant-one','main',{...prod,ATENDEVENDE_PILOT_ALLOWED_UNITS:JSON.stringify({'tenant-one':{main:['PSP_REFUND']}})})).toBe(true);
    expect(pilotLiveFeatureEnabled('WHATSAPP_OUTBOUND','tenant-two','main',prod)).toBe(false);
    expect(pilotLiveFeatureEnabled('WHATSAPP_OUTBOUND','tenant-other','main',prod)).toBe(false);
    expect(pilotLiveFeatureEnabled('WHATSAPP_OUTBOUND','tenant-one',undefined,prod)).toBe(false);
  });
  it('rejects malformed, oversized and non-array allowlists',()=>{
    for(const json of ['{', '{"tenant-one":{"main":"WHATSAPP_OUTBOUND"}}',
      '{"tenant-one":{"main":["WHATSAPP_OUTBOUND","UNKNOWN"]}}', '[]', ' '.repeat(16385)]) {
      expect(pilotLiveFeatureEnabled('WHATSAPP_OUTBOUND','tenant-one','main',
        {...prod,ATENDEVENDE_PILOT_ALLOWED_UNITS:json})).toBe(false);
    }
  });
  it('permits injected isolated test doubles without enabling live deployment',()=>{
    expect(pilotLiveFeatureEnabled('ONLINE_PAYMENT_CREATE','tenant-one','main',{NODE_ENV:'test'})).toBe(true);
  });
});

import { Request, Response, Router } from 'express';
import { AIRouterInterface } from '../ai/contracts';
import { FirestoreConversationRepository } from '../conversations/firestoreRepository';
import { FirestoreCustomerRepository } from '../customers/firestoreRepository';
import { ApplicationError } from '../infrastructure/errors';
import { LeadRepository, OpportunityRepository } from './contracts';
import { FirestoreLeadRepository, FirestoreOpportunityRepository } from './firestoreRepository';
import { LeadService } from './service';

function requireContext(req: Request) {
  if (!req.tenantContext) throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
  return req.tenantContext;
}

export function createLeadsRouter(
  leads: LeadRepository = new FirestoreLeadRepository(),
  opportunities: OpportunityRepository = new FirestoreOpportunityRepository(),
  ai?: AIRouterInterface,
): Router {
  const router = Router();
  const service = new LeadService(leads, opportunities, new FirestoreCustomerRepository(), new FirestoreConversationRepository(), ai);

  router.get('/', async (req: Request, res: Response, next) => { try { res.status(200).json({ ok: true, data: await service.listLeads(requireContext(req)) }); } catch (e) { next(e); } });
  router.post('/', async (req: Request, res: Response, next) => { try { res.status(201).json({ ok: true, data: await service.createLead(requireContext(req), req.body ?? {}) }); } catch (e) { next(e); } });
  router.get('/:id', async (req: Request, res: Response, next) => { try { res.status(200).json({ ok: true, data: await service.getLead(requireContext(req), req.params.id) }); } catch (e) { next(e); } });
  router.patch('/:id', async (req: Request, res: Response, next) => { try { res.status(200).json({ ok: true, data: await service.updateLead(requireContext(req), req.params.id, req.body ?? {}) }); } catch (e) { next(e); } });
  router.post('/analyze/:conversationId', async (req: Request, res: Response, next) => { try { res.status(200).json({ ok: true, data: await service.analyzeConversation(requireContext(req), req.params.conversationId) }); } catch (e) { next(e); } });
  router.get('/opportunities/list', async (req: Request, res: Response, next) => { try { res.status(200).json({ ok: true, data: await service.listOpportunities(requireContext(req)) }); } catch (e) { next(e); } });
  router.post('/opportunities', async (req: Request, res: Response, next) => { try { res.status(201).json({ ok: true, data: await service.createOpportunity(requireContext(req), req.body ?? {}) }); } catch (e) { next(e); } });
  router.get('/opportunities/:id', async (req: Request, res: Response, next) => { try { res.status(200).json({ ok: true, data: await service.getOpportunity(requireContext(req), req.params.id) }); } catch (e) { next(e); } });
  router.patch('/opportunities/:id', async (req: Request, res: Response, next) => { try { res.status(200).json({ ok: true, data: await service.updateOpportunity(requireContext(req), req.params.id, req.body ?? {}) }); } catch (e) { next(e); } });

  return router;
}

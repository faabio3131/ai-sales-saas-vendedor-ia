import { Request, Response, Router } from 'express';
import { FirestoreCustomerRepository } from '../customers/firestoreRepository';
import { ApplicationError } from '../infrastructure/errors';
import { ConversationRepository, MessageRepository } from './contracts';
import { FirestoreConversationRepository, FirestoreMessageRepository } from './firestoreRepository';
import { ConversationService } from './service';

function requireContext(req: Request) {
  if (!req.tenantContext) {
    throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
  }
  return req.tenantContext;
}

export function createConversationRouter(
  conversations: ConversationRepository = new FirestoreConversationRepository(),
  messages: MessageRepository = new FirestoreMessageRepository(),
): Router {
  const router = Router();
  const service = new ConversationService(conversations, messages, new FirestoreCustomerRepository());

  router.get('/', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.list(requireContext(req)) }); } catch (error) { next(error); }
  });

  router.post('/', async (req: Request, res: Response, next) => {
    try { res.status(201).json({ ok: true, data: await service.create(requireContext(req), req.body ?? {}) }); } catch (error) { next(error); }
  });

  router.get('/:id', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.get(requireContext(req), req.params.id) }); } catch (error) { next(error); }
  });

  router.patch('/:id', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.update(requireContext(req), req.params.id, req.body ?? {}) }); } catch (error) { next(error); }
  });

  router.get('/:id/messages', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.listMessages(requireContext(req), req.params.id) }); } catch (error) { next(error); }
  });

  router.post('/:id/messages', async (req: Request, res: Response, next) => {
    try { res.status(201).json({ ok: true, data: await service.addMessage(requireContext(req), req.params.id, req.body ?? {}) }); } catch (error) { next(error); }
  });

  return router;
}

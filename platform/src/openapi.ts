export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Centro Fashion Consent API',
    version: '0.2.0',
    description: 'API multi-site de registro e evidência de consentimentos.'
  },
  servers: [{ url: 'http://localhost:3333' }],
  paths: {
    '/api/health': { get: { summary: 'Saúde da aplicação', responses: { '200': { description: 'Saudável' } } } },
    '/v1/public/config': { get: { summary: 'Configuração publicada do site', responses: { '200': { description: 'Configuração' } } } },
    '/v1/public/policies/{revision}': {
      get: {
        summary: 'Snapshot imutável e hash da política',
        parameters: [
          { in: 'path', name: 'revision', required: true, schema: { type: 'integer' } },
          { in: 'query', name: 'siteKey', required: true, schema: { type: 'string' } }
        ],
        responses: { '200': { description: 'Política publicada ou substituída' }, '404': { description: 'Não encontrada' } }
      }
    },
    '/v1/public/consent-events/browser': {
      post: {
        summary: 'Registra um evento vindo do SDK do navegador',
        parameters: [
          { in: 'header', name: 'X-Consent-Site-Key', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string' } }
        ],
        responses: { '201': { description: 'Evento e recibo criados' }, '200': { description: 'Evento deduplicado' } }
      }
    },
    '/v1/public/integration-dispatches/browser': {
      post: {
        summary: 'Registra a evidência de um disparo real para uma integração autorizada',
        parameters: [
          { in: 'header', name: 'X-Consent-Site-Key', required: true, schema: { type: 'string' } },
          { in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '201': { description: 'Disparo correlacionado e assinado' },
          '200': { description: 'Disparo deduplicado' },
          '409': { description: 'Serviço não autorizado no consentimento' }
        }
      }
    },
    '/v1/public/receipts/{id}/verify': {
      get: {
        summary: 'Verifica a integridade de um recibo',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Resultado da verificação' }, '404': { description: 'Não encontrado' } }
      }
    },
    '/v1/admin/summary': { get: { summary: 'Resumo administrativo', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Resumo' } } } },
    '/v1/admin/events': { get: { summary: 'Eventos recentes', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Eventos' } } } }
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }
  }
};

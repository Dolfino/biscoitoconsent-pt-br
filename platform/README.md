# Plataforma de Consentimento — Centro Fashion

MVP local com API, PostgreSQL, evidências HMAC, SDK/browser, banner e painel administrativo.

## Executar

```powershell
docker compose up --build -d
```

Abra:

- Banner: http://localhost:3333/demo.html
- Painel: http://localhost:3333/admin.html
- Saúde: http://localhost:3333/api/health
- OpenAPI: http://localhost:3333/openapi.json
- Política piloto: http://localhost:3333/privacy.html

O site piloto é criado automaticamente com a chave pública `qez_local_public_key`, revisão 1 e validade de 182 dias.

## Desenvolvimento sem Docker

Se `DATABASE_URL` não estiver definida, a API usa PGlite e persiste um PostgreSQL embarcado em `.data/consent-pg`.

## Testes

```powershell
npm test
npm run typecheck
npm run test:postgres
npm run test:browser
npm run test:qez
```

Os screenshots do teste do navegador são gravados em `.artifacts/`.

## Integração com qez.com.br

O projeto `centrofashion-fortaleza` usa esta biblioteca como dependência fixada no GitHub. Durante o desenvolvimento, execute a plataforma na porta 3333 e o Next.js na porta 3000. A API permite essas origens locais e devolve categorias, serviços, revisão e validade para o cliente.

O navegador mantém:

- `cc_qez_consent`: escolha local da biblioteca;
- `cf_consent_outbox`: eventos ainda não enviados;
- `cf_consent_receipt`: último recibo assinado;
- `cf_consent_config`: última configuração publicada conhecida.

Em produção, a URL prevista da API é `https://consent.qez.com.br`.

## Recursos implementados

- isolamento por organização e site no modelo de dados;
- revisão publicada validada por site;
- escolhas por categoria e serviço;
- ações `accepted`, `updated` e `revoked`;
- modos `accepted_all`, `rejected_optional` e `customized`;
- idempotência, recibos e evidência HMAC;
- outbox processada em segundo plano;
- CORS restrito e rate limiting do endpoint público;
- migrations controladas pela tabela `schema_migrations`;
- painel e SDK/browser do piloto.

## Evidência versão 2

A revisão 2 preserva um snapshot canônico completo da política e calcula seu
`content_hash` com SHA-256. A revisão 1 permanece no banco como `superseded`
para que os recibos históricos continuem válidos.

Os novos eventos também registram, sem parâmetros de consulta:

- URL da página em que a escolha ocorreu;
- origem do referenciador;
- fuso horário informado pelo navegador.

Não são armazenados IP bruto nem fingerprint do dispositivo.

## Auditoria de integrações

A tabela `integration_dispatches` correlaciona um disparo real de Meta ou
Google ao evento de consentimento que o autorizou. O endpoint é:

```text
POST /v1/public/integration-dispatches/browser
```

O cliente deve informar `consentEventId`, `providerEventId`, serviço, nome do
evento, horário e status. A API impede o status `sent` quando o serviço não
estava autorizado, deduplica a requisição e assina a evidência com HMAC.

No site QEZ, integrações reais podem chamar, logo após o envio ao provedor:

```js
await window.CentroFashionConsent.recordIntegrationDispatch({
  provider: "meta",
  serviceKey: "meta_pixel",
  providerEventId: eventIdEnviadoParaAMeta,
  eventName: "PageView",
  status: "sent",
  metadata: { pagePath: location.pathname }
});
```

Essa função não ativa Meta ou Google; ela somente registra um envio que a
integração efetivamente realizou. O payload bruto do provedor não é salvo.

O pgAdmin pode exportar um dossiê diário pela view somente leitura:

```sql
SELECT *
FROM consent_evidence_report
WHERE (consent_timestamp AT TIME ZONE 'America/Fortaleza')::date = DATE '2026-11-05'
ORDER BY consent_timestamp;
```

O token administrativo local é `centro-fashion-local-admin`. O painel solicita esse token e o mantém somente na aba atual (`sessionStorage`); ele não fica embutido no JavaScript.

## Produção

A imagem é publicada em `ghcr.io/dolfino/biscoitoconsent-platform` pelo workflow `platform-image.yml`. Em produção, a inicialização é bloqueada se qualquer uma destas variáveis estiver ausente ou usar um valor local:

- `DATABASE_URL`;
- `CONSENT_HMAC_KEY`;
- `CONSENT_HMAC_KEY_ID`;
- `ADMIN_TOKEN`.

Os manifestos GitOps ficam no repositório `vps-k8s-infra`. A aplicação usa o host `consent.qez.com.br`, um banco lógico e usuário PostgreSQL exclusivos e segredos criptografados com SOPS/Age.

Para acompanhar ou encerrar:

```powershell
docker compose logs -f api
docker compose down
```

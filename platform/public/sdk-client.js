const SITE_KEY = 'qez_local_public_key';
const API_URL = '/v1/public/consent-events/browser';
const SDK_VERSION = '0.2.0';
const QUEUE_KEY = 'cf_consent_outbox';
const RECEIPT_KEY = 'cf_consent_receipt';

const config = await fetch(`/v1/public/config?siteKey=${SITE_KEY}`).then((response) => response.json());

function eventFingerprint(cookie) {
  return `${cookie.consentId}:${cookie.lastConsentTimestamp}:${JSON.stringify(cookie.categories)}:${JSON.stringify(cookie.services || {})}`;
}

function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}

function saveQueue(queue) { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); }

function enqueueCurrentConsent() {
  const cookie = CookieConsent.getCookie();
  if (!cookie?.consentId) return;
  const fingerprint = eventFingerprint(cookie);
  const queue = getQueue();
  if (!queue.some((item) => item.fingerprint === fingerprint)) {
    queue.push({
      fingerprint,
      idempotencyKey: crypto.randomUUID(),
      payload: {
        eventId: crypto.randomUUID(),
        consentId: cookie.consentId,
        categories: cookie.categories || [],
        services: cookie.services || {},
        revision: cookie.revision,
        consentTimestamp: cookie.consentTimestamp,
        lastConsentTimestamp: cookie.lastConsentTimestamp,
        languageCode: cookie.languageCode || 'pt-BR',
        sdkVersion: SDK_VERSION,
        sourceUrl: `${location.origin}${location.pathname}`,
        ...(document.referrer ? { referrerOrigin: new URL(document.referrer).origin } : {}),
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    });
    saveQueue(queue);
  }
  flushQueue();
}

async function flushQueue() {
  const queue = getQueue();
  while (queue.length) {
    const item = queue[0];
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Consent-Site-Key': SITE_KEY,
          'Idempotency-Key': item.idempotencyKey
        },
        body: JSON.stringify(item.payload)
      });
      if (!response.ok) throw new Error(`API respondeu ${response.status}`);
      const result = await response.json();
      localStorage.setItem(RECEIPT_KEY, JSON.stringify(result.receipt));
      queue.shift();
      saveQueue(queue);
      renderReceipt();
    } catch (error) {
      console.warn('Consentimento ficará na fila para nova tentativa.', error);
      break;
    }
  }
}

function renderReceipt() {
  const element = document.querySelector('#receipt');
  if (!element) return;
  const value = localStorage.getItem(RECEIPT_KEY);
  element.textContent = value ? JSON.stringify(JSON.parse(value), null, 2) : 'Nenhum consentimento enviado ainda.';
}

CookieConsent.run({
  revision: config.policy.revision,
  disablePageInteraction: true,
  cookie: { name: 'cc_qez_consent', expiresAfterDays: config.consentDays },
  guiOptions: {
    consentModal: { layout: 'cloud', position: 'bottom center', equalWeightButtons: true },
    preferencesModal: { layout: 'box', equalWeightButtons: true }
  },
  onFirstConsent: enqueueCurrentConsent,
  onChange: enqueueCurrentConsent,
  categories: {
    necessary: { readOnly: true, enabled: true },
    analytics: { services: { google_analytics: { label: 'Google Analytics' } } },
    advertising: { services: { meta_pixel: { label: 'Meta Pixel' } } }
  },
  language: {
    default: 'pt-BR',
    translations: {
      'pt-BR': {
        consentModal: {
          title: 'Sua privacidade importa',
          description: 'Usamos cookies necessários e, com sua autorização, recursos de análise e publicidade.',
          acceptAllBtn: 'Aceitar todos',
          acceptNecessaryBtn: 'Rejeitar opcionais',
          showPreferencesBtn: 'Personalizar',
          footer: '<a href="/privacy.html">Política de privacidade</a><a href="/terms.html">Termos</a>'
        },
        preferencesModal: {
          title: 'Preferências de privacidade',
          acceptAllBtn: 'Aceitar todos',
          acceptNecessaryBtn: 'Rejeitar opcionais',
          savePreferencesBtn: 'Salvar escolhas',
          closeIconLabel: 'Fechar',
          serviceCounterLabel: 'Serviço|Serviços',
          sections: [
            { title: 'Controle seus dados', description: 'Você pode alterar suas escolhas a qualquer momento.' },
            { title: 'Necessários', description: 'Essenciais para o funcionamento do site.', linkedCategory: 'necessary' },
            { title: 'Análise', description: 'Ajudam a compreender o uso do site.', linkedCategory: 'analytics' },
            { title: 'Publicidade', description: 'Permitem medir e personalizar campanhas.', linkedCategory: 'advertising' }
          ]
        }
      }
    }
  }
});

document.querySelector('#clear-consent')?.addEventListener('click', () => {
  CookieConsent.reset(true);
  localStorage.removeItem(RECEIPT_KEY);
  location.reload();
});
fetch('/api/health').then((response) => response.json()).then((health) => {
  document.querySelector('#api-status').textContent = `API ${health.status} · banco ${health.database} · ${health.time}`;
});
renderReceipt();
flushQueue();

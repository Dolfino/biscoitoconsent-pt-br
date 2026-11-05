export const PILOT_POLICY_V2_ID = '30000000-0000-4000-8000-000000000002';

export const PILOT_POLICY_V2 = {
  schemaVersion: 2,
  revision: 2,
  title: 'Política de Privacidade e Cookies do Centro Fashion Fortaleza',
  effectiveDate: '2026-11-05',
  language: 'pt-BR',
  controller: {
    name: 'Centro Fashion Fortaleza',
    address: 'Av. Filomeno Gomes, 430 - Jacarecanga, Fortaleza - CE',
    privacyContact: 'privacidade@centrofashion.com'
  },
  site: {
    name: 'QEZ',
    domain: 'qez.com.br',
    policyUrl: 'https://qez.com.br/politica-de-privacidade/',
    consentValidityDays: 182
  },
  principles: [
    'finalidade',
    'adequação',
    'necessidade',
    'livre acesso',
    'transparência',
    'segurança'
  ],
  categories: [
    {
      key: 'necessary',
      label: 'Cookies estritamente necessários',
      required: true,
      purpose: 'Operar o site, preservar segurança e armazenar as preferências de privacidade.',
      services: ['Plataforma de consentimento do Centro Fashion']
    },
    {
      key: 'analytics',
      label: 'Desempenho e estatísticas',
      required: false,
      purpose: 'Medir de forma agregada o uso do site e melhorar conteúdo, navegação e desempenho.',
      services: ['Google Analytics']
    },
    {
      key: 'advertising',
      label: 'Publicidade',
      required: false,
      purpose: 'Medir campanhas, atribuir conversões e limitar ou personalizar publicidade.',
      services: ['Meta Pixel']
    }
  ],
  optionalProviders: [
    {
      serviceKey: 'google_analytics',
      provider: 'Google Analytics',
      category: 'analytics',
      privacyUrl: 'https://policies.google.com/privacy',
      activatesOnlyAfterConsent: true
    },
    {
      serviceKey: 'meta_pixel',
      provider: 'Meta Pixel',
      category: 'advertising',
      privacyUrl: 'https://www.facebook.com/privacy/policy/',
      activatesOnlyAfterConsent: true
    }
  ],
  consentEvidence: {
    collectedFields: [
      'identificador pseudônimo do consentimento',
      'categorias e serviços escolhidos',
      'revisão da política',
      'datas da escolha e do recebimento',
      'URL de origem sem parâmetros de consulta',
      'origem do referenciador',
      'fuso horário do navegador',
      'hash e assinatura da evidência'
    ],
    excludedFields: [
      'nome',
      'e-mail',
      'CPF',
      'endereço IP em formato bruto',
      'fingerprint do dispositivo'
    ],
    purpose: 'Demonstrar a escolha do titular, permitir auditoria e atender solicitações de direitos.',
    integrity: 'SHA-256 e HMAC-SHA-256 com chave mantida fora do banco de dados.'
  },
  retention: {
    preferenceDays: 182,
    evidenceRule: 'A evidência é mantida pelo período necessário para demonstrar conformidade, exercer direitos e cumprir obrigações aplicáveis, com acesso restrito.'
  },
  rights: [
    'confirmação e acesso',
    'correção',
    'anonimização, bloqueio ou eliminação quando aplicável',
    'informação sobre compartilhamento',
    'revogação do consentimento',
    'revisão das preferências pelo botão Privacidade'
  ],
  internationalProcessingNotice: 'Google e Meta podem tratar dados em outros países conforme suas políticas, quando os respectivos serviços opcionais forem autorizados.',
  changeRule: 'Mudanças de finalidade, serviços opcionais ou conteúdo relevante exigem nova revisão e nova solicitação de consentimento.'
} as const;

export const t = {
  appName: 'Faturómetro',
  tagline: 'As faturas da casa, sem os teus dados saírem do dispositivo.',
  nav: {
    home: 'Início',
    contracts: 'Contratos',
    invoices: 'Faturas',
    compare: 'Comparar',
    settings: 'Definições',
  },
  placeholder: 'Em construção.',
  lock: 'Bloquear',
  sectors: {
    electricity: 'Eletricidade',
    gas: 'Gás',
    water: 'Água',
    telecom: 'Telecomunicações',
    other: 'Outras despesas',
  },
  invoices: {
    empty: 'Ainda não tens faturas. Adiciona a primeira acima.',
    listTitle: 'Faturas guardadas',
    review: {
      title: 'Confirma e guarda',
      fromQr: 'Os campos marcados vêm do código QR e não podem ser alterados.',
      manualTitle: 'Introduzir à mão',
      manualIntro: 'Preenche os dados que estão na fatura.',
      manual: 'Introduzir à mão',
      save: 'Guardar fatura',
      saved: 'Fatura guardada.',
      skip: 'Não guardar',
      saving: 'A guardar…',
      checkPassed: 'Os valores lidos da fatura batem com o código QR.',
      checkFailed: 'Alguns valores lidos não batem com o código QR: confirma-os antes de guardar.',
      checkNone: 'Sem código QR para confirmar os valores lidos: confirma-os antes de guardar.',
      readCounts: (lines: number, readings: number) =>
        'Lido da fatura: ' +
        [
          lines === 1 ? '1 linha' : `${lines} linhas`,
          readings > 0 ? (readings === 1 ? '1 leitura' : `${readings} leituras`) : '',
        ]
          .filter(Boolean)
          .join(' e ') +
        '.',
    },
    fields: {
      issuerNif: 'NIF do fornecedor',
      providerName: 'Nome do fornecedor',
      providerNameHint: 'Como aparece na fatura (por exemplo, “NOS”).',
      sector: 'Tipo de despesa',
      contract: 'Contrato',
      newContract: 'Novo contrato',
      contractLabel: 'Nome do contrato',
      contractLabelHint: 'Para o reconheceres, por exemplo “Luz de casa” ou “Internet”.',
      customerNumber: 'N.º de cliente (opcional)',
      docId: 'N.º do documento',
      issueDate: 'Data da fatura',
      periodStart: 'Início do período (opcional)',
      periodEnd: 'Fim do período (opcional)',
      dueDate: 'Data-limite de pagamento (opcional)',
      total: 'Total (€)',
      vat: 'IVA (€)',
    },
    errors: {
      required: 'Preenche este campo.',
      nif: 'Escreve um NIF com 9 dígitos válido.',
      date: 'Escolhe uma data válida.',
      periodOrder: 'O fim do período tem de ser depois do início.',
      amount: 'Escreve um valor como 42,79.',
      duplicate: 'Já tens esta fatura guardada.',
      unexpected: 'Não foi possível guardar. Tenta outra vez.',
    },
  },
  contracts: {
    empty:
      'Ainda não tens contratos. São criados quando guardas a primeira fatura de cada fornecedor.',
    invoiceCount: (count: number) => (count === 1 ? '1 fatura' : `${count} faturas`),
    lastInvoice: 'Última fatura',
  },
  ingest: {
    title: 'Adicionar fatura',
    intro:
      'Escolhe o PDF descarregado da área de cliente ou tira uma fotografia à fatura em papel.',
    chooseFile: 'Escolher ficheiro',
    takePhoto: 'Tirar fotografia',
    reading: 'A ler a fatura…',
    another: 'Adicionar outra',
    unsupported: 'Este ficheiro não é um PDF nem uma imagem.',
    failed: 'Não foi possível ler este ficheiro. Experimenta outro ou tira uma fotografia.',
    duplicateFile: 'Já adicionaste este ficheiro.',
    duplicateInvoice: 'Já tens esta fatura guardada.',
    noQr: 'Não encontrei o código QR desta fatura. Preenche os dados à mão.',
    invalidQr: 'Encontrei um código QR, mas não o consegui interpretar.',
    foundCount: (count: number) =>
      count === 1 ? 'Encontrei 1 documento.' : `Encontrei ${count} documentos neste ficheiro.`,
    password: {
      title: 'Este PDF tem palavra-passe',
      needed: 'Em muitas faturas (por exemplo, da Repsol) a palavra-passe é o NIF do titular.',
      incorrect: 'A palavra-passe não abriu o PDF. Confirma e tenta outra vez.',
      label: 'Palavra-passe do PDF',
      remember: 'É o meu NIF: guardar nas definições para abrir estes PDFs automaticamente.',
      submit: 'Abrir',
      cancel: 'Cancelar',
    },
    fields: {
      issuer: 'NIF do fornecedor',
      docType: 'Tipo',
      docId: 'Documento',
      date: 'Data',
      vat: 'IVA',
      total: 'Total',
      page: 'Página',
    },
    docTypes: {
      FT: 'Fatura',
      FS: 'Fatura simplificada',
      ND: 'Nota de débito',
      PF: 'Fatura pró-forma',
      GT: 'Guia de transporte',
    } as Record<string, string>,
  },
  auth: {
    email: 'Email',
    emailHint: 'Serve só para identificar a tua conta neste dispositivo.',
    password: 'Palavra-passe',
    passwordHint:
      'Pelo menos 10 carateres. Não há forma de a recuperar sem a chave de recuperação.',
    confirmPassword: 'Repete a palavra-passe',
    working: 'A preparar a cifra…',
    register: {
      title: 'Criar conta',
      intro:
        'A conta fica só neste dispositivo. A palavra-passe cifra as tuas faturas: sem ela, ninguém as consegue ler, nem nós.',
      submit: 'Criar conta',
      haveAccount: 'Já tens conta neste dispositivo?',
    },
    recoveryKey: {
      title: 'Guarda a tua chave de recuperação',
      intro:
        'Se te esqueceres da palavra-passe, esta chave é a única forma de voltar a abrir os teus dados. Guarda-a fora deste dispositivo: num gestor de palavras-passe ou impressa.',
      copy: 'Copiar',
      copied: 'Copiada',
      download: 'Descarregar ficheiro',
      fileName: 'faturometro-chave-de-recuperacao.txt',
      fileIntro:
        'Chave de recuperação do Faturómetro. Guarda este ficheiro num sítio seguro e apaga-o deste dispositivo.',
      confirm: 'Guardei a chave de recuperação num sítio seguro.',
      continue: 'Continuar',
    },
    login: {
      title: 'Entrar',
      intro: 'Abre a tua conta neste dispositivo.',
      submit: 'Entrar',
      noAccounts: 'Ainda não há contas neste dispositivo.',
      createAccount: 'Criar conta',
      forgot: 'Esqueceste-te da palavra-passe?',
    },
    recover: {
      title: 'Recuperar acesso',
      intro:
        'Usa a chave de recuperação que guardaste ao criar a conta e escolhe uma palavra-passe nova.',
      recoveryKey: 'Chave de recuperação',
      newPassword: 'Palavra-passe nova',
      submit: 'Recuperar e entrar',
      back: 'Voltar a entrar',
    },
    errors: {
      email: 'Escreve um email válido.',
      passwordShort: 'A palavra-passe tem de ter pelo menos 10 carateres.',
      passwordMismatch: 'As palavras-passe não coincidem.',
      required: 'Preenche este campo.',
      email_taken: 'Já existe uma conta com este email neste dispositivo.',
      not_found: 'Não há nenhuma conta com este email neste dispositivo.',
      wrong_secret: 'A palavra-passe não está correta.',
      wrong_recovery: 'A chave de recuperação não está correta.',
      unexpected: 'Não foi possível concluir. Tenta outra vez.',
    },
  },
  notFound: {
    title: 'Esta página não existe',
    body: 'Verifica o endereço ou volta ao início.',
    back: 'Voltar ao início',
  },
  landing: {
    status: 'Em desenvolvimento: algumas funções ainda não estão disponíveis.',
    signIn: 'Entrar',
    createAccount: 'Criar conta',
    howItWorksLink: 'Como funciona',
    hero: {
      title: 'Quanto custa a tua casa, fatura a fatura.',
      lead: 'O Faturómetro lê as faturas de luz, gás, água e telecomunicações, guarda o histórico e avisa-te quando o preço sobe ou a fidelização está a acabar.',
    },
    qr: {
      title: 'O que está no código QR de uma fatura',
      hint: 'Passa o cursor ou o foco por cada linha para ver de onde vem.',
      source: 'Exemplo da especificação técnica do código QR da Autoridade Tributária.',
      fields: {
        A: { label: 'NIF de quem emite', value: '123456789' },
        D: { label: 'Tipo de documento', value: 'Fatura simplificada' },
        F: { label: 'Data', value: '12-08-2019' },
        I7: { label: 'Base tributável', value: '0,65 €' },
        I8: { label: 'IVA à taxa normal', value: '0,15 €' },
        O: { label: 'Total', value: '0,80 €' },
      },
    },
    features: {
      title: 'O que faz por ti',
      items: [
        {
          title: 'Lê qualquer fatura portuguesa',
          body: 'As faturas emitidas em Portugal têm um código QR com o NIF do fornecedor, a data, o IVA e o total. A app lê-o do PDF ou de uma fotografia.',
        },
        {
          title: 'Avisa a tempo',
          body: 'Fim da fidelização, aumentos de preço, leituras estimadas seguidas e faturas que deviam ter chegado e não chegaram.',
        },
        {
          title: 'Compara a eletricidade',
          body: 'Calcula quanto pagarias com cada oferta publicada pela ERSE, com base no teu consumo real.',
        },
      ],
    },
    privacy: {
      title: 'Os teus dados ficam contigo',
      items: [
        'As faturas ficam no teu dispositivo, cifradas com a tua palavra-passe.',
        'Sem publicidade e sem comissões dos fornecedores.',
        'Se quiseres os mesmos dados no telemóvel e no computador, ativas a sincronização: os dados saem cifrados e o servidor não os consegue ler.',
        'A inteligência artificial é opcional e usa a tua própria chave.',
      ],
    },
    steps: {
      title: 'Como funciona',
      items: [
        {
          title: 'Carrega a fatura',
          body: 'Um PDF descarregado da área de cliente ou uma fotografia da fatura em papel.',
        },
        {
          title: 'Confirma o que foi lido',
          body: 'A app mostra o fornecedor, o período, os consumos e o total. Corriges o que for preciso.',
        },
        {
          title: 'Acompanha',
          body: 'Vês a evolução de cada contrato e recebes avisos quando algo muda.',
        },
      ],
    },
    install: {
      title: 'Instalar no telemóvel',
      android: {
        title: 'Android',
        body: 'No Chrome, abre o menu ⋮ e escolhe “Instalar aplicação”.',
      },
      iphone: {
        title: 'iPhone',
        body: 'No Safari, toca em Partilhar e depois em “Adicionar ao ecrã principal”.',
      },
      desktop: { title: 'Computador', body: 'Funciona no browser, sem instalar nada.' },
    },
    footer: {
      free: 'O Faturómetro é gratuito e de código aberto.',
      source: 'Código no GitHub',
    },
  },
} as const;

export const t = {
  appName: 'Faturómetro',
  tagline: 'As faturas da casa, sem os teus dados saírem do dispositivo.',
  privacyPage: {
    title: 'Privacidade',
    updated: 'Última atualização: 14 de outubro de 2026.',
    intro:
      'O Faturómetro foi feito para que as tuas faturas fiquem contigo. Esta página explica, sem letra miudinha, que dados existem, onde ficam e quem os pode ver.',
    sections: [
      {
        title: 'Quem é responsável',
        body: [
          'O Faturómetro é um projeto pessoal e gratuito de Paulo Barbosa, com o código aberto no GitHub. Não tem publicidade nem vende dados.',
          'Para dúvidas ou pedidos, abre uma questão no repositório do projeto no GitHub (não escrevas lá dados pessoais: é público).',
        ],
      },
      {
        title: 'No teu dispositivo (sempre)',
        body: [
          'A conta, as faturas, os contratos, os alertas e os PDFs originais ficam no armazenamento do browser deste dispositivo (IndexedDB), cifrados com uma chave que só a tua palavra-passe ou a tua chave de recuperação abrem.',
          'Se usares a app sem conta, os dados ficam cifrados com uma chave guardada no próprio browser, sem palavra-passe: quem usar este browser consegue vê-los. Sem conta não há sincronização nem IA. Podes criar uma conta a qualquer momento sem perder nada.',
          'Não há cookies, estatísticas de utilização, publicidade nem registos com os teus dados.',
          'Se limpares os dados do site ou desinstalares a app, esses dados desaparecem deste dispositivo. Por isso existe a exportação (Definições → Os teus dados).',
        ],
      },
      {
        title: 'Sincronização entre dispositivos (só se a ligares)',
        body: [
          'Os dados são cifrados no teu dispositivo antes de saírem, e o servidor não tem a chave para os ler.',
          'O servidor guarda: o teu email e o dia em que sincronizaste pela última vez; um código derivado da palavra-passe para confirmar que és tu (só o seu hash); a chave das tuas faturas cifrada com chaves que ele não tem; e os registos cifrados, cada um com um identificador, o tipo (fatura, contrato…) e a data da última alteração. Se ligares a sincronização dos originais, guarda também os PDFs, cifrados da mesma forma.',
          'O servidor funciona na Cloudflare, com as bases de dados restritas à União Europeia. A Cloudflare processa os pedidos (por exemplo, o endereço IP) para entregar o serviço e protegê-lo de abusos, nos termos da sua política de privacidade; o Faturómetro não guarda registos de acesso.',
          'As sessões expiram ao fim de 30 dias. Os dados ficam no servidor até desligares a sincronização com a opção de apagar ou até apagares tudo (Definições).',
          'Para o serviço continuar gratuito há limites: os PDFs originais com mais de 12 meses saem do servidor e ficam só nos teus dispositivos; uma conta que não sincronize há 12 meses é apagada do servidor (os dados nos teus dispositivos ficam); e, quando o servidor está perto da lotação, não é possível ligar a sincronização em contas novas.',
        ],
      },
      {
        title: 'Contribuir com um layout (só se o fizeres)',
        body: [
          'Quando a app não conhece o layout de uma fatura, podes enviar a sua estrutura ao responsável do projeto para a app passar a lê-la. Antes de enviar vês exatamente o que sai: as posições do texto, as palavras típicas de faturas e números trocados ao acaso. As outras palavras vão tapadas (fica só o número de letras e a posição), e os dados pessoais lidos da fatura nunca se podem destapar.',
          'O envio vai cifrado com uma chave que só o responsável tem e passa pelo mesmo servidor da sincronização, que guarda só o conteúdo cifrado, o tamanho e a data. É apagado depois de usado e, no máximo, ao fim de 90 dias.',
        ],
      },
      {
        title: 'Inteligência artificial (só se a usares)',
        body: [
          'Com uma chave tua da Anthropic, podes pedir à IA que leia uma fatura, a explique ou escreva uma carta. O pedido vai diretamente do teu dispositivo para a Anthropic, sem passar por nenhum servidor do Faturómetro, e é regido pelos termos entre ti e a Anthropic.',
          'Antes de enviar, a app mostra o que vai ser enviado. Para ler uma fatura, envia o texto da fatura (ou o ficheiro, se não tiver texto). Para explicações e cartas, envia só valores, datas, linhas e consumos: nunca o teu nome, morada, NIF, número de cliente ou CPE.',
          'A chave fica guardada cifrada com a tua conta e não é incluída nas exportações.',
        ],
      },
      {
        title: 'O que a app descarrega',
        body: [
          'A própria app e as ofertas de eletricidade publicadas pela ERSE, a partir do site do Faturómetro. Estes pedidos não levam dados teus.',
        ],
      },
      {
        title: 'Os teus direitos',
        body: [
          'Podes ver, exportar e apagar todos os teus dados a qualquer momento, sem pedir a ninguém: Definições → Os teus dados. Apagar a conta do servidor também está nas Definições.',
          'Podes ainda apresentar reclamação à Comissão Nacional de Proteção de Dados (CNPD).',
        ],
      },
    ],
    back: 'Voltar ao início',
  },
  backup: {
    title: 'Os teus dados',
    localOnlyWarning:
      'Sem sincronização, as faturas existem só neste dispositivo: se limpares os dados do browser ou perderes o telemóvel, perdem-se. Faz exportações regulares.',
    exportTitle: 'Exportar tudo',
    exportHint:
      'Descarrega um ficheiro ZIP com todas as faturas, contratos e definições (em JSON) e os PDFs originais. Fica em claro, para o poderes ler ou guardar onde quiseres: guarda-o num sítio seguro. A chave da IA não é incluída.',
    export: 'Exportar (ZIP)',
    exported: (records: number, files: number) =>
      `Exportados ${records} registos e ${files} ${files === 1 ? 'original' : 'originais'}.`,
    importTitle: 'Importar uma exportação',
    importHint:
      'Junta os dados de uma exportação a esta conta. Se um registo já existir aqui com uma versão mais recente, fica o daqui.',
    import: 'Escolher ficheiro ZIP',
    imported: (added: number, skipped: number, files: number) =>
      `Importados ${added} registos e ${files} ${files === 1 ? 'original' : 'originais'}` +
      (skipped > 0 ? ` (${skipped} já estavam atualizados).` : '.'),
    deleteTitle: 'Apagar tudo',
    deleteHint:
      'Apaga deste dispositivo a conta, as faturas, os contratos e os originais. Não há forma de desfazer: exporta antes, se quiseres guardar alguma coisa.',
    deleteRemote: 'Apagar também a conta e os dados no servidor de sincronização',
    deleteConfirm: 'Confirmo que quero apagar todos os dados desta conta.',
    delete: 'Apagar tudo',
    failed: 'Não foi possível concluir. Tenta outra vez.',
    errors: {
      not_a_backup: 'Este ficheiro não é uma exportação do Faturómetro.',
      too_large: 'O ficheiro é demasiado grande.',
    },
  },
  install: {
    title: 'Aplicação',
    intro:
      'Instala o Faturómetro no telemóvel ou no computador: abre pelo ícone, em ecrã inteiro, e funciona sem internet.',
    button: 'Instalar app',
    installed: 'O Faturómetro está instalado neste dispositivo.',
    version: (commit: string, built: string) => `Versão ${commit} · ${built}`,
    installedPhone:
      'O Faturómetro já está instalado neste telemóvel: abre-o pelo ícone no ecrã principal. Também podes continuar aqui no browser, com “Entrar”.',
    installedComputer:
      'O Faturómetro já está instalado neste computador: abre-o pelo ícone, ou pelo botão “Abrir na app” que o Chrome e o Edge mostram à direita da barra de endereço.',
    steps: {
      ios: [
        'Abre esta página no Safari.',
        'Toca no botão Partilhar (o quadrado com a seta para cima).',
        'Escolhe “Adicionar ao ecrã principal” e confirma.',
      ],
      'safari-mac': [
        'No Safari, abre o menu Ficheiro (ou o botão Partilhar).',
        'Escolhe “Adicionar à Dock” e confirma.',
      ],
      'firefox-android': [
        'Abre o menu do Firefox (⋮).',
        'Escolhe “Instalar” ou “Adicionar ao ecrã principal” e confirma.',
      ],
      'firefox-desktop': [
        'O Firefox para computador não instala apps web.',
        'Para instalar, abre esta página no Chrome ou no Edge. Também podes usar a app aqui no Firefox: funciona igual, só não tem ícone próprio.',
      ],
      samsung: [
        'Abre o menu do Samsung Internet (☰).',
        'Escolhe “Adicionar página a” → “Ecrã principal” e confirma.',
      ],
      chromium: [
        'No Chrome ou Edge: abre o menu do browser (⋮).',
        'Escolhe “Instalar app” ou “Adicionar ao ecrã principal”.',
        'Se o browser só oferecer “Criar atalho”, atualiza o Chrome e os Serviços do Google Play e tenta de novo; o atalho também funciona.',
      ],
    },
    dataNote:
      'Os dados ficam neste dispositivo: desinstalar a app ou limpar os dados do site apaga-os, a não ser que tenhas a sincronização ligada ou uma exportação recente.',
  },
  providerCoverage: {
    title: 'Que faturas a app lê sozinha?',
    intro:
      'Todas as faturas portuguesas têm um código QR com o fornecedor, a data, o IVA e o total: a app lê-o sempre. Para estes fornecedores, lê também o resto (linhas, consumos, períodos, contrato) sem IA.',
    provider: 'Fornecedor',
    type: 'Tipo',
    documents: 'O que lê',
    updated: 'Atualizado a',
    invoices: 'Faturas',
    documentsOf: {
      nos: 'Faturas de telecomunicações',
      meo: 'Faturas de telemóvel',
      digi: 'Faturas de fibra',
      repsol: 'Faturas de eletricidade e gás',
      indaqua: 'Faturas de água e saneamento, com a de resíduos urbanos',
      'aguas-porto': 'Faturas de água e saneamento, com a de resíduos urbanos',
      generali: 'Recibos, cartas de renovação e condições particulares',
      fidelidade: 'Recibos e condições particulares (Multicare)',
    },
    withoutTitle: 'Ainda sem leitor automático',
    withoutIntro:
      'Destes, a app lê o código QR (total, IVA, data). O resto podes pedir à IA, com a tua chave da Anthropic (Definições), ou preencher à mão.',
    andOthers: ' e outros',
    waterNote:
      'a entidade gestora do teu concelho (por agora, só a Indaqua Matosinhos e a Águas do Porto têm leitor)',
    requestTitle: 'Pedir um leitor automático',
    request:
      'Ao carregar uma fatura de um fornecedor sem leitor, usa "Contribuir com este layout": envia só a estrutura da fatura, anonimizada e cifrada, e é o que permite fazer o leitor. Não envies faturas por email: têm o teu nome, morada e NIF.',
  },
  feedback: {
    title: 'Sugestões e problemas',
    intro:
      'Abre o teu programa de email com uma mensagem já endereçada ao Faturómetro. Não envies faturas nem dados pessoais: para um leitor automático, usa "Contribuir com este layout" ao carregar a fatura.',
    footer: 'Sugestões e problemas',
    links: {
      suggestion: 'Enviar uma sugestão',
      problem: 'Reportar um problema',
      parser: 'Pedir um leitor automático',
    },
    subjects: {
      general: 'Sugestão ou problema',
      suggestion: 'Sugestão',
      problem: 'Problema',
      parser: 'Pedido de leitor automático',
    },
    bodyStart: 'Escreve aqui a tua mensagem.',
    technical: '— Informação técnica (podes apagar) —',
    version: (commit: string, built: string) => `Versão: ${commit} (${built})`,
    page: (page: string) => `Página: ${page}`,
  },
  legal: {
    copyright: '© 2026 Paulo Barbosa',
    license: 'Código aberto, licença AGPL-3.0',
    source: 'Código no GitHub',
    privacy: 'Privacidade',
  },
  nav: {
    home: 'Início',
    contracts: 'Contratos',
    invoices: 'Faturas',
    compare: 'Comparar',
    settings: 'Definições',
  },
  placeholder: 'Em construção.',
  update: {
    available: 'Há uma nova versão da app.',
    hint: 'A página vai recarregar: guarda primeiro o que estiveres a escrever.',
    apply: 'Atualizar',
  },
  signOut: 'Sair',
  password: {
    show: 'Mostrar palavra-passe',
    hide: 'Esconder palavra-passe',
  },
  adminBadge: 'Administrador',
  contribute: {
    offer:
      'A app ainda não conhece bem este layout. Queres ajudar? Envia só a estrutura da fatura, sem os teus dados, para que a próxima seja lida sozinha.',
    open: 'Contribuir com este layout',
    title: 'Contribuir com este layout',
    intro:
      'É isto que vai ser enviado. Os números são todos trocados por outros ao acaso. As palavras a cinzento estão tapadas; toca numa para a destapar ou tapar.',
    warning: 'Não destapes o teu nome, morada nem outros dados teus.',
    locked: 'Dados pessoais lidos da fatura: ficam sempre tapados.',
    consent:
      'Aceito enviar esta estrutura ao responsável do Faturómetro. Vai cifrada e só ele a consegue ler; serve só para a app passar a ler este layout e é apagada depois de usada (no servidor, no máximo ao fim de 90 dias).',
    send: 'Enviar',
    sending: 'A enviar…',
    sent: 'Obrigado! A contribuição foi enviada.',
    cancel: 'Cancelar',
    notPdf: 'Só é possível com faturas em PDF que tenham texto (não com fotografias).',
    errors: {
      too_large: 'Esta fatura é grande demais para enviar.',
      full: 'Não é possível receber contribuições agora. Tenta noutro dia.',
      offline: 'Sem ligação. Tenta outra vez quando estiveres online.',
      failed: 'Não foi possível enviar. Tenta outra vez.',
    },
  },
  guest: {
    badge: 'Sem conta',
    createAccount: 'Criar conta',
    aiNeedsAccount:
      'Cria uma conta para usar a IA: a chave da API fica protegida pela tua palavra-passe.',
    syncNeedsAccount: 'Cria uma conta para sincronizar entre dispositivos.',
    signOutLabel: 'Sair para a página de entrada (os dados ficam neste browser)',
    noticeTitle: 'Estás a usar a app sem conta',
    notice: [
      'Os teus dados ficam só neste browser e não estão protegidos por palavra-passe: quem usar este browser consegue vê-los.',
      'Se limpares os dados do site, perdes tudo. Faz uma cópia de segurança (mais abaixo) ou cria uma conta.',
    ],
  },
  signOutLabel: 'Sair da conta (a app fica bloqueada até voltares a entrar)',
  insurance: {
    section: {
      renewalTitle: (date: string) => `Renovação de ${date}`,
      premium: (current: string, next: string, pct: string) =>
        `O prémio passa de ${current} para ${next} (${pct} %).`,
      factors: 'Segundo a seguradora, o que mudou o prémio:',
      coveragesTitle: 'Coberturas',
      coverage: 'Cobertura',
      capital: 'Capital seguro',
      deductible: 'Franquia',
      network: 'Na rede',
      reimbursement: 'Por reembolso',
      waiting: 'Carência',
      coveragesNote:
        'Das condições particulares da apólice. Usa esta lista para pedir propostas com as mesmas coberturas a outras seguradoras.',
    },
    proposals: {
      title: 'Comparar propostas',
      intro:
        'Escreve aqui as propostas que outras seguradoras te enviarem: comparamos cada cobertura com a tua apólice e o preço com o que pagas. Ficam guardadas neste contrato.',
      summary: 'Copiar o resumo das coberturas',
      summaryHint:
        'Para preencheres os simuladores das seguradoras ou para pedires propostas com as mesmas coberturas.',
      copied: 'Resumo copiado.',
      summaryPremium: (amount: string) => `Prémio anual atual: ${amount}`,
      add: 'Acrescentar proposta',
      insurer: 'Seguradora',
      premium: 'Prémio anual, em euros',
      included: 'Incluída',
      capital: 'Capital (€)',
      deductible: 'Franquia (€)',
      save: 'Guardar proposta',
      cancel: 'Cancelar',
      remove: 'Apagar proposta',
      errors: {
        insurer: 'Escreve o nome da seguradora.',
        amount: 'Escreve um valor em euros, por exemplo 250,00.',
      },
      header: (insurer: string, premium: string) => `${insurer}: ${premium} por ano`,
      cheaper: (amount: string) => `${amount} mais barata do que o que pagas.`,
      dearer: (amount: string) => `${amount} mais cara do que o que pagas.`,
      samePrice: 'O mesmo preço que pagas.',
      worse: (count: number) =>
        count === 0
          ? 'Nas coberturas que dá para comparar, nenhuma fica pior.'
          : count === 1
            ? '1 cobertura fica pior ou falta.'
            : `${count} coberturas ficam piores ou faltam.`,
      current: 'Agora',
      proposed: 'Proposta',
      result: 'Resultado',
      verdicts: {
        missing: 'Não incluída',
        lower_capital: 'Capital mais baixo',
        higher_deductible: 'Franquia mais alta',
        ok: 'Igual ou melhor',
      } as Record<string, string>,
      note: 'Compara também as exclusões e as condições gerais de cada proposta: aqui só entram capitais e franquias.',
    },
    document: {
      renewalTitle: 'Carta de renovação',
      conditionsTitle: 'Condições particulares',
      notInvoice: (issuer: string) =>
        `Documento da ${issuer} sem código QR: não é uma fatura. Os dados ficam no contrato do seguro.`,
      renewal: (date: string, current: string, next: string, pct: string) =>
        `Renova a ${date}: o prémio passa de ${current} para ${next} (${pct} %).`,
      factor: (name: string, pct: string) => `${name}: ${pct} %`,
      capital: (name: string, current: string, next: string) => `${name}: ${current} → ${next}`,
      conditions: (count: number, premium?: string) =>
        `${count === 1 ? '1 cobertura' : `${count} coberturas`}` +
        (premium ? `, prémio anual de ${premium}.` : '.'),
      contract: 'Contrato do seguro',
      choose: 'Escolhe o contrato',
      save: 'Guardar no contrato',
      saved: (label: string) => `Guardado no contrato ${label}.`,
      noContract:
        'Ainda não tens nenhum seguro na app. Guarda primeiro um recibo (Fatura/Recibo) deste seguro: o contrato é criado com ele.',
    },
  },
  socialTariff: {
    title: 'Tarifa social',
    homeLink: 'Tens direito à tarifa social da luz, do gás ou da Internet? Verifica aqui.',
    back: 'Voltar ao início',
    intro:
      'Responde às perguntas para saber se a tua casa pode ter a tarifa social da luz, do gás natural e da Internet. As respostas ficam só neste ecrã: não são guardadas nem enviadas.',
    benefitsLegend: 'Recebes (ou podes receber) alguma destas prestações sociais?',
    benefits: {
      csi: 'Complemento solidário para idosos',
      rsi: 'Rendimento social de inserção',
      unemployment: 'Prestação de desemprego',
      family_allowance_1: 'Abono de família, 1.º escalão',
      family_allowance_other: 'Abono de família, outro escalão',
      invalidity:
        'Pensão social de invalidez (regime especial de proteção na invalidez ou complemento da prestação social para a inclusão)',
      old_age: 'Pensão social de velhice',
    },
    income: 'Rendimento anual do agregado, em euros (opcional)',
    incomeHint: 'Só conta para a luz e a Internet, se ninguém receber as prestações acima.',
    incomeError: 'Escreve um valor em euros, por exemplo 6500.',
    members: 'Pessoas do agregado sem nenhum rendimento (contigo, se for o caso)',
    membersHint: 'Cada uma aumenta o limite de rendimento em 50 %, até 10 pessoas.',
    services: { electricity: 'Luz', gas: 'Gás natural', internet: 'Internet' },
    eligibleBenefit:
      'Pelas tuas respostas, tens direito: recebes uma das prestações que dão acesso.',
    eligibleIncome: (limit: string) =>
      `Pelas tuas respostas, tens direito: o rendimento está dentro do limite para a tua casa (${limit} por ano).`,
    notEligible: (limit: string) =>
      `Pelas tuas respostas, não tens direito. Sem prestações, o limite de rendimento para a tua casa é ${limit} por ano.`,
    notEligibleGas:
      'Pelas tuas respostas, não tens direito: no gás natural só contam as prestações sociais.',
    conditions: {
      electricity:
        'Condições: o contrato tem de estar em teu nome, ser só para consumo doméstico na habitação permanente e ter potência até 6,9 kVA. O desconto médio é de 33,8 % (sem taxas e impostos), com isenção do IEC.',
      gas: 'Condições: o contrato tem de estar em teu nome, ser só para consumo doméstico na habitação permanente, em baixa pressão, com consumo até 500 m³ por ano (1.º e 2.º escalão). O desconto médio é de 31,2 % (sem taxas e impostos), com isenção do ISPGN.',
      internet: (price: string, activation: string) =>
        `Custa ${price} + IVA por mês, com pelo menos 15 GB de tráfego; a ativação ou o equipamento podem custar até ${activation} + IVA. Só uma por agregado.`,
    },
    how: {
      energy:
        'É atribuída automaticamente pela DGEG e o teu comercializador avisa-te. Se achas que tens direito e não recebeste nada, pede um comprovativo à Segurança Social ou às Finanças e entrega-o ao comercializador.',
      internet:
        'Pede-a a um operador de Internet. A ANACOM confirma se tens direito e o operador tem até 10 dias para ativar o serviço.',
    },
    notes: {
      already: 'A tua fatura de luz já mostra o desconto da tarifa social.',
      power_too_high:
        'O teu contrato de luz tem mais de 6,9 kVA: com esta potência não há tarifa social.',
      gas_tier_too_high:
        'O teu contrato de gás está acima do 2.º escalão: a tarifa social só cobre consumos até 500 m³ por ano.',
    } as Record<string, string>,
    water:
      'Água e resíduos: não há uma tarifa social nacional, depende do município. Vê o tarifário da tua entidade gestora.',
    sources: 'Critérios da ERSE (outubro de 2026) e da ANACOM. Confirma sempre junto de:',
    links: {
      dgeg: 'DGEG, tarifa social de energia',
      energy: 'Folheto da ERSE',
      internet: 'ANACOM, tarifa social de Internet',
    },
  },
  household: {
    title: 'A tua casa nos últimos 12 meses',
    total: 'Total',
    previous: (difference: string, pct: string, up: boolean) =>
      `${up ? '+' : '−'}${difference} (${up ? '+' : '−'}${pct} %) do que nos 12 meses anteriores`,
    same: 'O mesmo que nos 12 meses anteriores',
    bySector: 'Por tipo de despesa',
    share: (amount: string, pct: string) => `${amount} (${pct} %)`,
    chart: 'Faturas de cada mês',
    month: 'Mês',
    value: 'Valor',
    monthTitle: (month: string) => `Faturas emitidas em ${month}`,
    forecast: 'Próximos 12 meses (estimativa)',
    switchSaving: (amount: string) =>
      `Com as mudanças de fornecedor, poupaste cerca de ${amount} até agora (estimativa).`,
    switchCost: (amount: string) =>
      `As mudanças de fornecedor custaram até agora mais ${amount} (estimativa).`,
    forecastNote:
      'Para cada contrato ativo: na luz, gás e água com um ano de faturas, o mesmo que no último ano; nos outros, o custo por dia das últimas faturas. Não conta com aumentos futuros. Cada fatura conta no mês em que foi emitida.',
  },
  alerts: {
    title: 'Avisos',
    empty: 'Sem avisos. Quando algo mudar nos teus contratos, aparece aqui.',
    dismiss: 'Dispensar',
    admin: {
      contributions: (count: number) =>
        `${count === 1 ? 'Há 1 contribuição de layout' : `Há ${count} contribuições de layout`} por recolher no servidor. No PC, abre o projeto no Claude Code e escreve /novo-leitor: recolhe-as, cria o leitor com testes e pergunta antes de publicar. O aviso desaparece na sincronização seguinte.`,
      comEscolhaStale: (date: string) =>
        `Administrador: as ligações ao COM.escolha não são verificadas desde ${date}. Confirma que o PC esteve ligado e vê o registo da tarefa semanal (docs/anacom-comescolha.md).`,
    },
    messages: {
      loyaltyEnding: (label: string, date: string, days: number) =>
        `${label}: a fidelização termina a ${date} (daqui a ${days} ${days === 1 ? 'dia' : 'dias'}). Bom momento para comparar ou renegociar.`,
      baseFeeIncrease: (label: string, before: string, after: string) =>
        `${label}: a mensalidade subiu de ${before} para ${after}.`,
      totalIncrease: (label: string, before: string, after: string, pct: string) =>
        `${label}: a última fatura (${after}) está ${pct}% acima da média das três anteriores (${before}).`,
      unitPriceIncrease: (label: string, pct: string) =>
        `${label}: o preço da energia subiu ${pct}% em relação à fatura anterior.`,
      estimatedReadings: (label: string, count: number) =>
        `${label}: ${count} faturas seguidas com leituras estimadas. Comunica uma leitura real para evitar acertos.`,
      meterReading: (label: string, start: string, end: string) =>
        `${label}: comunica a leitura do contador entre ${start} e ${end}, como pede a última fatura. Assim a próxima é feita com o consumo real.`,
      missingInvoice: (label: string, date: string, days: number) =>
        `${label}: a última fatura é de ${date}, há ${days} dias. Confirma se chegou alguma nova.`,
      cheaperOffer: (label: string, saving: string) =>
        `${label}: há uma oferta que pode poupar cerca de ${saving} por ano (estimativa).`,
      premiumIncrease: (label: string, before: string, after: string, pct: string) =>
        `${label}: o prémio subiu de ${before} para ${after} (+${pct}%).`,
      premiumNotice: (label: string, date: string, before: string, after: string, pct: string) =>
        `${label}: a ${date} o prémio passa de ${before} para ${after} (+${pct}%). Ainda podes pedir propostas a outras seguradoras antes de renovar.`,
      renewal: (label: string, date: string, days: number) =>
        `${label}: o seguro renova a ${date} (daqui a ${days} ${days === 1 ? 'dia' : 'dias'}). Bom momento para pedir propostas com as mesmas coberturas.`,
      invoiceAudit: (label: string, date: string, parts: string[]) =>
        `${label}: na fatura de ${date}, ${parts.join(', ')}. Vê o detalhe na página do contrato.`,
      auditParts: {
        discount_ended: 'deixou de aparecer um desconto',
        discount_reduced: 'um desconto ficou mais pequeno',
        new_charge: 'há uma cobrança nova',
        above_contracted: 'pagas mais do que a mensalidade contratada',
        extra_usage: 'há consumos fora do pacote',
      } as Record<string, string>,
    },
  },
  compare: {
    title: 'Comparar',
    intro:
      'Estimativa do custo anual com os preços de cada oferta publicada pela ERSE, para o teu consumo real. Inclui IVA e as taxas da tua fatura.',
    tabs: { electricity: 'Luz', gas: 'Gás', both: 'Luz + gás' },
    gas: {
      noContract:
        'Para comparar o gás, adiciona uma fatura de gás lida automaticamente (por agora, da Repsol), com período e consumo em kWh.',
      noKwh:
        'As tuas faturas de gás não trazem o consumo em kWh: sem o fator de conversão da fatura, não é possível estimar.',
      escalao: 'Escalão de consumo',
      escalaoHint: 'Vem na tua fatura de gás (ex.: "Escalão 1").',
      escalaoChoose: 'Escolhe o escalão',
      distributor: 'Distribuidor de gás da tua zona',
      distributorHint:
        'Aparece no contrato ou na área de cliente. Serve só para mostrar a tarifa regulada da tua zona.',
      distributorChoose: 'Escolhe o distribuidor',
      distributorUnknown: 'Não sei',
      usage: (value: string) => `Consumo anual estimado: ${value} kWh de gás`,
      seasonal:
        'O gás varia muito entre inverno e verão: com menos de um ano de faturas, a estimativa pode falhar bastante.',
      regulated: (name: string, value: string) => `Tarifa regulada (${name}): ${value}/ano`,
      missingTaxes:
        'A tua última fatura não traz a taxa de ocupação do subsolo nem o imposto especial: não estão incluídos.',
      needsEscalao: 'Escolhe o escalão para ver a estimativa e as ofertas.',
      cannotEstimate:
        'Não foi possível estimar com as tuas faturas de gás: falta o preço da energia em kWh na última fatura lida.',
    },
    both: {
      current: 'Os teus contratos atuais (luz + gás, estimativa anual)',
      separate: 'Melhor combinação de ofertas separadas',
      separatePair: (electricity: string, gas: string) => `${electricity} (luz) + ${gas} (gás)`,
      duals: 'Ofertas conjuntas de luz e gás mais baratas',
      noneDual: 'Nenhuma oferta conjunta é mais barata do que os teus contratos atuais.',
      needsBoth:
        'Para comparar luz e gás juntos, precisas de um contrato de cada com faturas lidas.',
      incomplete:
        'Para comparar luz e gás juntos, completa primeiro os separadores Luz e Gás (por exemplo, o escalão do gás).',
    },
    loading: 'A carregar as ofertas da ERSE…',
    offersUnavailable: 'Não foi possível carregar as ofertas da ERSE. Tenta mais tarde.',
    noContract:
      'Para comparar, adiciona uma fatura de eletricidade lida automaticamente (por agora, da Repsol), com período e leituras.',
    contract: 'Contrato',
    dataDate: (date: string) => `Ofertas da ERSE atualizadas a ${date}.`,
    usage: (kwh: string) => `Consumo anual estimado: ${kwh} kWh`,
    usageExtrapolated: (days: number) =>
      `Calculado a partir de ${days} dias de leituras e extrapolado para um ano: o valor pode mudar com as estações.`,
    current: 'O teu contrato atual (estimativa anual)',
    best: 'Ofertas mais baratas',
    none: 'Nenhuma oferta é mais barata do que o teu contrato atual, para o teu consumo.',
    perYear: '/ano',
    saving: (value: string) => `Poupança estimada: ${value}/ano`,
    moreExpensive: (value: string) => `Mais cara: ${value}/ano`,
    cycles: { '1': 'Simples', '2': 'Bi-horária', '3': 'Tri-horária' } as Record<string, string>,
    conditions: {
      loyalty: 'Com fidelização',
      indexed: 'Preços indexados (variam)',
      requiredServices: 'Serviços adicionais obrigatórios',
      restrictions: 'Com restrições',
      directDebitOnly: 'Só débito direto',
      electronicOnly: 'Só fatura eletrónica',
      newClients: 'Descontos extra só para novos clientes (não incluídos)',
    },
    sheet: 'Ficha da oferta',
    glossary: {
      title: 'O que querem dizer as siglas e termos das ofertas?',
      items: [
        [
          'DD',
          'Débito direto: pagamento automático pela conta bancária. Muitas ofertas só têm este preço com débito direto.',
        ],
        ['FE', 'Fatura eletrónica: a fatura chega por email ou na área de cliente, sem papel.'],
        [
          'Dual / Gás + Eletricidade',
          'Oferta conjunta: a luz e o gás são contratados ao mesmo comercializador.',
        ],
        [
          'Simples, bi-horária, tri-horária',
          'Simples: o mesmo preço a qualquer hora. Bi-horária e tri-horária: preços diferentes consoante a hora (vazio, cheias, ponta).',
        ],
        [
          'Preços indexados',
          'O preço da energia acompanha o mercado e muda ao longo do tempo: a estimativa usa o valor publicado hoje.',
        ],
        ['Fidelização', 'Período mínimo de contrato; sair antes pode ter custos.'],
        [
          'Escalão',
          'Nível de consumo anual de gás (1 a 4) definido pelo distribuidor; os preços das ofertas dependem dele.',
        ],
        [
          'Distribuidor',
          'Empresa dona da rede de gás da tua zona (ex.: Lisboagás). É a mesma, seja qual for o comercializador.',
        ],
        [
          'Tarifa regulada',
          'Preço fixado pela ERSE para quem fica no mercado regulado; serve de referência.',
        ],
        ['TOS', 'Taxa de ocupação do subsolo: cobrada pelo município, igual em todas as ofertas.'],
        ['IEC', 'Imposto especial sobre o consumo de gás natural, igual em todas as ofertas.'],
      ] as [string, string][],
      source:
        'Os significados de DD e FE foram confirmados nas condições publicadas pela ERSE para cada oferta.',
    },
    disclaimer:
      'Estimativa, não poupança garantida. Confirma sempre a ficha padronizada da oferta antes de mudar de comercializador.',
    lowPowerNote:
      'Até 3,45 kVA, parte do termo fixo tem IVA a 6 %, mas as ofertas não separam essa parte: as estimativas ficam ligeiramente acima.',
  },
  adminStats: {
    title: 'Utilização do servidor (administrador)',
    intro:
      'Totais do servidor de sincronização: só contam contas com sincronização ligada. Quem usa a app sem conta, ou sem sincronização, não chega ao servidor e não é contado.',
    failed: 'Não foi possível obter os números do servidor.',
    accounts: 'Contas',
    ofMax: (count: number, max: number) => `${count} de ${max} possíveis`,
    newAccounts: 'Contas novas',
    period: (days7: number, days30: number) => `${days7} em 7 dias · ${days30} em 30 dias`,
    active: 'Contas ativas',
    activeValue: (today: number, days7: number, days30: number) =>
      `${today} hoje · ${days7} em 7 dias · ${days30} em 30 dias`,
    devices: 'Dispositivos com sessão',
    removed: 'Removidas por inatividade',
    removedValue: (count: number) => `${count} em 30 dias`,
    records: 'Dados',
    files: 'Originais',
    ofTotal: (used: string, total: string, percent: string) => `${used} de ${total} (${percent} %)`,
    spaceNote:
      'Dados: faturas, contratos e definições, cifrados. Originais: PDF e fotografias das faturas, só de quem ligou a sincronização dos originais. Quando um dos dois passa de 80 %, o servidor deixa de aceitar contas novas.',
    contributions: 'Contribuições por recolher',
  },
  settings: {
    title: 'Definições',
    preferences: 'Preferências',
    largeFamily:
      'Família numerosa (5 ou mais pessoas): IVA reduzido até 300 kWh por mês na eletricidade',
    keepOriginalFiles: 'Guardar o PDF ou a fotografia original de cada fatura (cifrado)',
    saved: 'Guardado.',
    account: {
      title: 'Conta',
      signedInAs: (email: string) => `Email: ${email}`,
      admin: 'Esta conta é de administrador: tem limites próprios no servidor de sincronização.',
      changePassword: 'Mudar a palavra-passe',
      current: 'Palavra-passe atual',
      next: 'Palavra-passe nova',
      confirm: 'Repete a palavra-passe nova',
      syncNote:
        'A sincronização está ligada: a palavra-passe muda também no servidor e os outros dispositivos vão pedir a nova na próxima sincronização.',
      submit: 'Mudar a palavra-passe',
      working: 'A mudar…',
      done: 'Palavra-passe alterada.',
      recoveryNote: 'A chave de recuperação continua a mesma.',
    },
  },
  sync: {
    title: 'Sincronização entre dispositivos',
    offIntro:
      'Desligada: as faturas existem só neste dispositivo. Se ligares, os dados são cifrados aqui antes de saírem e o servidor guarda apenas conteúdo cifrado, que não consegue ler.',
    serverSees:
      'O servidor fica a saber: o teu email, o dia em que sincronizaste pela última vez, quando cada registo foi alterado e de que tipo é (fatura, contrato…). Não vê nomes, valores, datas das faturas, NIF nem moradas.',
    serverUrl: 'Endereço do servidor de sincronização',
    password: 'A tua palavra-passe',
    passwordHint:
      'Confirma a palavra-passe desta conta. É usada para criar a chave de acesso ao servidor e não é enviada.',
    enable: 'Ligar sincronização',
    enabling: 'A ligar…',
    onIntro: (server: string) => `Ligada a ${server}.`,
    lastSync: (when: string) => `Última sincronização: ${when}.`,
    never: 'Ainda não sincronizou.',
    syncing: 'A sincronizar…',
    syncNow: 'Sincronizar agora',
    received: (count: number) =>
      count === 0
        ? 'Sem novidades dos outros dispositivos.'
        : `Recebidos ${count} registos dos outros dispositivos.`,
    conflicts: (count: number) =>
      `${count} registos não foram aplicados (por exemplo, a mesma fatura importada em dois dispositivos).`,
    disableTitle: 'Desligar',
    disableLocal: 'Desligar só neste dispositivo',
    disableDelete: 'Desligar e apagar todos os dados do servidor',
    disableConfirm:
      'Confirmo que quero apagar a conta e todos os dados no servidor. Os dados neste dispositivo ficam.',
    disabled: 'Sincronização desligada.',
    files: {
      label: 'Sincronizar também os PDFs e fotografias originais neste dispositivo',
      hint: 'Cifrados aqui, como o resto. Sem esta opção, os originais dos outros dispositivos descarregam-se só quando os abrires.',
      needsKeep:
        'Para enviar originais, liga também “Guardar o PDF ou a fotografia original” nas preferências.',
      usage: (used: string, quota: string) => `Espaço usado no servidor: ${used} de ${quota}.`,
      full: 'O espaço para originais no servidor está cheio: os novos ficam só neste dispositivo. As faturas continuam a sincronizar.',
      keep: (months: number) =>
        `Os originais com mais de ${months} meses ficam só nos teus dispositivos (saem do servidor).`,
      pruned: (count: number) =>
        count === 1
          ? '1 original antigo saiu do servidor (continua neste dispositivo).'
          : `${count} originais antigos saíram do servidor (continuam neste dispositivo).`,
      sent: (count: number) =>
        count === 1 ? 'Enviado 1 original.' : `Enviados ${count} originais.`,
      received: (count: number) =>
        count === 1 ? 'Recebido 1 original.' : `Recebidos ${count} originais.`,
    },
    reconnect: {
      password: 'Palavra-passe (a mais recente)',
      hint: 'Se a mudaste noutro dispositivo, usa a nova: passa também a ser a palavra-passe deste.',
      submit: 'Voltar a ligar',
      working: 'A ligar…',
    },
    connect: {
      question: 'Já usas o Faturómetro noutro dispositivo com sincronização?',
      link: 'Entrar com essa conta',
      title: 'Entrar com conta sincronizada',
      intro:
        'Traz para este dispositivo as faturas que já tens sincronizadas. Usa o mesmo email e a mesma palavra-passe.',
      submit: 'Entrar e sincronizar',
      // The server cannot say which (no account enumeration).
      wrongCredentials:
        'Email ou palavra-passe errados, ou esta conta ainda não tem a sincronização ligada. Liga-a primeiro no outro dispositivo (Definições).',
      working: 'A preparar…',
    },
    errors: {
      wrong_password: 'A palavra-passe não está correta.',
      account_exists:
        'Já existe uma conta sincronizada com este email. Para a usar aqui, entra com ela num perfil novo (“Entrar com conta sincronizada”).',
      wrong_credentials: 'Email ou palavra-passe errados.',
      locked: 'Demasiadas tentativas. Espera 15 minutos e tenta de novo.',
      email_taken_locally: 'Já existe um perfil com este email neste dispositivo.',
      offline: 'Sem ligação ao servidor. Verifica a internet ou o endereço do servidor.',
      session_expired:
        'A sessão no servidor terminou (por exemplo, porque a palavra-passe foi mudada noutro dispositivo). Volta a introduzir a palavra-passe.',
      different_account: 'Esta conta no servidor não corresponde aos dados deste dispositivo.',
      unexpected: 'Não foi possível sincronizar. Tenta mais tarde.',
      capacity:
        'A sincronização está lotada de momento. Os teus dados continuam neste dispositivo; tenta mais tarde.',
      records_full:
        'Atingiste o espaço para registos no servidor. Os novos dados ficam só neste dispositivo.',
      account_removed:
        'A tua conta de sincronização foi removida por inatividade (12 meses sem sincronizar). Os teus dados estão neste dispositivo; podes voltar a ligar a sincronização.',
      serverUrl: 'Escreve um endereço https:// válido.',
    },
  },
  ai: {
    settings: {
      title: 'Inteligência artificial (opcional)',
      intro:
        'Com uma chave tua da Anthropic, a IA lê faturas de fornecedores que a app ainda não conhece, explica faturas e escreve cartas. Sem chave, tudo o resto funciona igual.',
      privacy:
        'Só envia algo quando pedes (ou quando ligas o envio automático), diretamente do teu dispositivo para api.anthropic.com. Antes de enviar mostra o quê e quanto deve custar. Os custos são cobrados pela Anthropic na tua conta.',
      getKey: 'Criar uma chave em console.anthropic.com',
      key: 'Chave da API da Anthropic',
      keyHint:
        'Guardada cifrada com a tua palavra-passe. Com a sincronização ligada, vai também (cifrada) para os teus outros dispositivos.',
      keySaved: 'Chave guardada.',
      model: 'Modelo',
      modelOption: (label: string, input: string, output: string) =>
        `${label} — ${input} / ${output} US$ por milhão de tokens (entrada / saída)`,
      recommended: ' (recomendado)',
      autoSend: 'Enviar automaticamente as faturas que nenhum leitor reconhece (sem perguntar)',
      save: 'Guardar',
      test: 'Testar ligação',
      testing: 'A testar…',
      testOk: (cost: string) => `Ligação a funcionar. Este teste custou cerca de ${cost}.`,
      remove: 'Apagar a chave',
      removed: 'Chave apagada.',
      usage: (requests: number, cost: string) =>
        requests === 0
          ? 'Este mês ainda não usaste a IA neste dispositivo.'
          : `Este mês, neste dispositivo: ${requests} ${requests === 1 ? 'pedido' : 'pedidos'}, cerca de ${cost}.`,
      pricesNote: (date: string) => `Preços de tabela da Anthropic, verificados em ${date}.`,
    },
    extract: {
      noKey:
        'Este fornecedor ainda não tem leitor automático: a app leu o código QR (total, IVA, data). O resto preenches à mão, ou, com uma chave da Anthropic (Definições), a IA pode lê-lo por ti. Para pedir um leitor, usa "Contribuir com este layout".',
      intro:
        'Este fornecedor ainda não tem leitor automático: a app leu o código QR (total, IVA, data). Podes pedir à IA que leia o resto.',
      noKeyNoQr:
        'Sem código QR nem leitor automático: preenche os dados à mão, ou, com uma chave da Anthropic (Definições), a IA pode lê-los por ti.',
      introNoQr: 'Sem código QR nem leitor automático: podes pedir à IA que leia a fatura.',
      willSend: 'Vai ser enviado para api.anthropic.com:',
      sendText: (chars: number) => `o texto da fatura (${chars.toLocaleString('pt-PT')} carateres)`,
      sendPdf: 'o PDF da fatura (não tem texto, é uma digitalização)',
      sendImage: 'a fotografia da fatura',
      sendImages: (count: number) => `as ${count} fotografias da fatura`,
      showText: 'Ver o texto que vai ser enviado',
      model: (label: string) => `Modelo: ${label}.`,
      cost: (cost: string) => `Custo estimado: cerca de ${cost} (no máximo).`,
      send: 'Ler com IA',
      sending: 'A ler com IA…',
      done: 'A IA leu a fatura. Confirma os dados antes de guardar.',
      cannotSend:
        'Esta fatura não pode ser enviada: é um PDF protegido sem texto, ou uma imagem num formato que a IA não lê (usa JPEG ou PNG).',
    },
    assistant: {
      title: 'Ajuda da IA',
      intro:
        'Envia só valores, datas, linhas e consumos guardados na app. Nunca o teu nome, morada, NIF, n.º de cliente ou CPE.',
      noKey: 'Para usar, guarda uma chave da Anthropic nas Definições.',
      noInvoices: 'Ainda não há faturas neste contrato.',
      explain: 'Explica-me a última fatura',
      letters: {
        renegotiate: 'Carta: pedir um preço melhor',
        cancel: 'Carta: denunciar o contrato',
        estimated_reading: 'Carta: reclamar de leituras estimadas',
      },
      confirm: (cost: string, model: string) =>
        `Enviar para api.anthropic.com (${model})? Custo estimado: cerca de ${cost}.`,
      send: 'Enviar',
      cancel: 'Cancelar',
      working: 'A pensar…',
      showData: 'Ver o que vai ser enviado',
      copy: 'Copiar',
      copied: 'Copiado',
      placeholdersNote:
        'Os campos entre parênteses retos ([NOME], [MORADA], [NIF]…) ficam para preencheres tu. O n.º de cliente e o CPE foram preenchidos aqui, sem os enviar.',
      cost: (cost: string) => `Custou cerca de ${cost}.`,
    },
    errors: {
      no_key: 'Falta a chave da API da Anthropic (Definições).',
      invalid_key: 'A chave da API não é válida ou foi revogada.',
      no_credit: 'A conta da Anthropic não tem crédito. Carrega-a em console.anthropic.com.',
      rate_limited: 'Demasiados pedidos seguidos. Espera um minuto e tenta de novo.',
      unavailable: 'O serviço da Anthropic não respondeu. Tenta mais tarde.',
      offline: 'Sem ligação à internet.',
      invalid_output: 'A IA não devolveu dados utilizáveis. Preenche à mão ou tenta outro modelo.',
      refused: 'A IA recusou este pedido.',
      too_large: 'O documento é demasiado grande para enviar.',
    },
  },
  groups: {
    energy: 'Energia',
    telecom: 'Telecomunicações',
    water: 'Água e resíduos',
    insurance: 'Seguros',
    other: 'Outras despesas',
    invoices: (count: number, total: string) =>
      `${count === 1 ? '1 fatura' : `${count} faturas`} · ${total} nos últimos 12 meses`,
    contracts: (count: number) => (count === 1 ? '1 contrato' : `${count} contratos`),
  },
  frequency: {
    monthly: 'Mensal',
    bimonthly: 'Bimestral',
    quarterly: 'Trimestral',
    semiannual: 'Semestral',
    annual: 'Anual',
  },
  sectors: {
    electricity: 'Eletricidade',
    gas: 'Gás',
    water: 'Água',
    telecom: 'Telecomunicações',
    insurance: 'Seguros',
    other: 'Outras despesas',
  },
  invoices: {
    reparse: {
      button: (name: string) => `Ler de novo com o leitor da ${name}`,
      working: 'A ler…',
      done: (name: string) =>
        `Lida de novo com o leitor da ${name}: linhas, período e contrato atualizados.`,
      failed: {
        no_original: 'O original já não está neste dispositivo.',
        unreadable: 'Não foi possível abrir o original.',
        not_found: 'O leitor não reconheceu esta fatura.',
      },
    },
    empty: 'Ainda não tens faturas. Adiciona a primeira acima.',
    listTitle: 'Faturas guardadas',
    original: {
      open: 'Abrir original',
      openRemote: 'Abrir original (descarregar)',
      opening: 'A abrir…',
      unavailable: 'O original já não está no servidor.',
      failed: 'Não foi possível abrir o original. Verifica a ligação e tenta de novo.',
      gone: 'Este original já só está guardado nos dispositivos que o tinham.',
    },
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
    back: 'Contratos',
    notFound: 'Este contrato não existe.',
    facts: {
      provider: 'Fornecedor',
      sector: 'Tipo de despesa',
      customerNumber: 'N.º de cliente',
      supplyPoint: 'CPE / CUI',
      tariff: 'Tarifa',
      billing: 'Faturação',
      power: 'Potência contratada',
      cycle: 'Ciclo horário',
      socialTariff: 'Tarifa social',
      yes: 'Sim',
      product: 'Produto',
      policy: 'N.º da apólice',
      insuredPersons: 'Pessoas seguras',
      insuredObject: 'Objeto seguro',
      capital: (name: string) => `Capital: ${name}`,
      renewal: 'Renova a',
      annualPremium: 'Prémio anual',
      bonusMalus: 'Bónus/malus',
    },
    cycles: { simple: 'Simples', bi: 'Bi-horário', tri: 'Tri-horário' },
    loyalty: {
      title: 'Fim da fidelização',
      hint: 'Normalmente não vem na fatura: vê no contrato ou na área de cliente. Avisamos 60, 30 e 7 dias antes.',
      save: 'Guardar data',
      clear: 'Sem fidelização',
      saved: 'Data guardada.',
    },
    charts: {
      cost: 'Valor de cada fatura',
      consumption: 'Consumo faturado (kWh)',
      consumptionM3: 'Consumo de água (m³)',
      table: 'Ver como tabela',
      invoice: 'Fatura',
      value: 'Valor',
      invoiceOf: (date: string) => `Fatura de ${date}`,
    },
    invoicesTitle: 'Faturas deste contrato',
    earlyExit: {
      title: 'Vale a pena sair já?',
      intro:
        'Compara o que uma oferta mais barata te poupa até ao fim da fidelização com o máximo que o operador pode cobrar por saíres antes. É uma estimativa: confirma o valor com o operador antes de decidir.',
      start: 'Início da fidelização',
      startHint: 'Se não souberes, contamos 24 meses antes do fim.',
      kind: 'Tipo de fidelização',
      kinds: {
        initial: 'Primeira, ou nova com mudança na instalação',
        renewal_same_installation: 'Nova, sem mudança na instalação',
      },
      monthly: 'O que pagas por mês, com IVA',
      monthlyHint: 'Preenchido com a mensalidade contratada ou a média das últimas faturas.',
      newMonthly: 'Mensalidade da oferta nova, com IVA',
      stated: 'Valor para sair agora, se a fatura ou o operador o indicar (opcional)',
      amountError: 'Escreve um valor em euros, por exemplo 25,90.',
      monthsLeft: (count: number, fees: string) =>
        `Faltam ${count === 1 ? '1 mensalidade' : `${count} mensalidades`} até ao fim da fidelização (${fees}).`,
      cap: (year: number, pct: number, max: string) =>
        `No ${year}.º ano da fidelização, o operador pode cobrar no máximo ${pct} % das mensalidades que faltam: ${max}.`,
      oldContract:
        'A fidelização começou antes de 14-11-2022: o valor a pagar é o da vantagem que falta recuperar, como diz o contrato. Escreve-o acima para comparar.',
      usingStated: (amount: string) => `Na comparação usamos o valor indicado: ${amount}.`,
      saving: (amount: string) => `Com a oferta nova poupas ${amount} até ao fim da fidelização.`,
      noSaving: 'A oferta nova não é mais barata do que o que pagas agora.',
      worth: (amount: string) =>
        `Sair já compensa: mesmo pagando para sair, ficas com cerca de ${amount} a mais.`,
      notWorth: (amount: string, date: string) =>
        `Sair já não compensa: perdes cerca de ${amount}. Pondera mudar quando a fidelização acabar, a ${date}.`,
      source: 'Limites da ANACOM para os encargos de saída antecipada',
    },
    telecom: {
      title: 'Comparar com outras ofertas',
      services: 'Serviços incluídos',
      serviceNames: {
        internet: 'Internet',
        tv: 'Televisão',
        landline: 'Telefone fixo',
        mobile: 'Telemóvel',
      },
      fromInvoice: 'Lidos da tua última fatura. Confirma ou corrige.',
      confirm: 'Confirmar serviços',
      save: 'Guardar serviços',
      saved: 'Serviços guardados.',
      average: (amount: string, count: number) =>
        count === 1
          ? `Pagaste ${amount} na última fatura.`
          : `Pagas em média ${amount} por mês (últimas ${count} faturas).`,
      cheaperOnly: (euros: number) => `Só ofertas até ${euros} € por mês`,
      postal: 'Código postal (4 primeiros dígitos, opcional)',
      postalHint: 'Para veres só as ofertas com cobertura na tua zona. Não fica guardado.',
      postalInvalid: 'Escreve os 4 primeiros dígitos (ex.: 4000).',
      chooseServices: 'Escolhe os serviços que tens para comparar.',
      open: 'Ver ofertas no COM.escolha (ANACOM)',
      unavailable: 'A ligação ao COM.escolha não está disponível nesta versão.',
      note: 'Abre o comparador oficial da ANACOM noutra janela: a app não envia nada para lá. Os tarifários são introduzidos pelos operadores. A média inclui extras (chamadas, roaming, aluguer de equipamentos), por isso pode ficar acima do preço do pacote. Se não houver ofertas até esse valor, o COM.escolha diz que não encontrou ofertas compatíveis.',
    },
    switch: {
      title: 'Mudança de fornecedor',
      start: 'Mudei de fornecedor',
      intro:
        'Regista a data em que passaste para outro fornecedor. Este contrato fica terminado (sem avisos nem previsões) e a app compara o que pagas agora com o que pagarias aqui.',
      date: 'Data da mudança',
      newContract: 'Contrato novo',
      notYet: 'Ainda não tenho fatura do novo fornecedor',
      notYetHint:
        'O contrato novo liga-se sozinho quando guardares a primeira fatura de outro fornecedor deste tipo.',
      save: 'Guardar mudança',
      cancel: 'Cancelar',
      ended: (date: string) => `Contrato terminado a ${date}.`,
      replacedBy: 'Substituído por',
      waiting: 'O contrato novo liga-se quando guardares a primeira fatura do novo fornecedor.',
      reactivate: 'Reativar contrato',
      replaces: 'Substitui',
      since: (date: string) => `desde ${date}.`,
      saving: (amount: string, count: number) =>
        `Poupança estimada até agora: ${amount} (${count === 1 ? '1 fatura' : `${count} faturas`}).`,
      costMore: (amount: string, count: number) =>
        `Até agora pagaste mais ${amount} do que pagarias com o contrato antigo (${count === 1 ? '1 fatura' : `${count} faturas`}).`,
      noData: 'Ainda não há faturas deste contrato depois da mudança para comparar.',
      methods: {
        prices:
          'Calculado com os preços da última fatura do contrato antigo aplicados ao teu consumo real em cada fatura nova, com os mesmos impostos e taxas.',
        perDay:
          'Calculado com o custo por dia das últimas faturas do contrato antigo, multiplicado pelos dias de cada fatura nova.',
        mixed:
          'Calculado com os preços do contrato antigo e o teu consumo real nas faturas com detalhe, e pelo custo por dia nas outras.',
      },
      note: 'Estimativa: não conta com aumentos que o contrato antigo teria tido entretanto.',
      listEnded: (date: string) => `Terminado a ${date}`,
    },
    monthlyPrice: {
      title: 'Mensalidade contratada (com IVA)',
      hint: 'O preço mensal que te prometeram no contrato, com descontos. Comparamos cada fatura com este valor.',
      save: 'Guardar mensalidade',
      clear: 'Apagar',
      saved: 'Mensalidade guardada.',
      invalid: 'Escreve um valor como 39,99.',
    },
    audit: {
      title: 'O que mudou na última fatura',
      intro: (date: string, previous?: string) =>
        previous
          ? `Fatura de ${date} comparada com a de ${previous}, linha a linha.`
          : `Fatura de ${date}.`,
      noDetail:
        'Esta fatura só tem o total (lida pelo código QR), por isso não há linhas para comparar. Com a mensalidade contratada guardada, comparamos o total.',
      onlyOne: 'Ainda só há uma fatura: a comparação começa na próxima.',
      nothing: 'Não encontrámos alterações de preços, descontos ou cobranças.',
      priceChanged: (description: string, before: string, after: string) =>
        `${description}: o preço passou de ${before} para ${after}.`,
      feeChanged: (description: string, before: string, after: string) =>
        `${description}: passou de ${before} para ${after}.`,
      discountEnded: (description: string, amount: string) =>
        `${description}: o desconto de ${amount} deixou de aparecer.`,
      discountReduced: (description: string, before: string, after: string) =>
        `${description}: o desconto passou de ${before} para ${after}.`,
      newCharge: (description: string, amount: string) =>
        `${description}: cobrança nova de ${amount}.`,
      aboveContracted: (charged: string, contracted: string) =>
        `Pagas ${charged} de mensalidade, acima dos ${contracted} contratados.`,
      extraUsage: (description: string, amount: string) =>
        `${description}: ${amount} sem IVA, fora do pacote.`,
      duringLoyalty:
        'Esta fatura é do período de fidelização. Confirma no contrato se estas alterações estão previstas.',
      letter: 'Se não concordares, usa a carta "Contestar um aumento" mais abaixo.',
      units: { kWh: 'kWh', m3: 'm³', day: 'dia', month: 'mês', min: 'min', GB: 'GB' } as Record<
        string,
        string
      >,
    },
    letters: {
      title: 'Cartas',
      intro:
        'Modelos de cartas preenchidos com os dados deste contrato. Revê e completa o texto antes de o enviares.',
      kinds: {
        renegotiate: 'Pedir um preço melhor',
        price_increase: 'Contestar um aumento',
        estimated_reading: 'Reclamar de leituras estimadas',
        block_extras: 'Bloquear serviços pagos à parte',
        cancel: 'Denunciar o contrato',
      },
      textLabel: 'Texto da carta (podes editar)',
      copy: 'Copiar',
      copied: 'Copiado',
      email: 'Abrir no email',
      placeholdersNote:
        'Completa o que está entre parênteses retos ([NOME], [MORADA]…). Envia pelo email ou pelo formulário da área de cliente do fornecedor e guarda uma cópia.',
      complaint:
        'Se não te responderem ou não concordares com a resposta, podes reclamar no Livro de Reclamações Eletrónico. A reclamação segue também para a entidade reguladora do setor.',
      complaintLink: 'Livro de Reclamações Eletrónico',
      complaintUrl: 'https://www.livroreclamacoes.pt/',
      placeholders: {
        name: '[NOME]',
        address: '[MORADA]',
        nif: '[NIF]',
        customerNumber: '[N.º DE CLIENTE]',
        endDate: '[DATA DE FIM]',
        reading: '[LEITURA]',
        readingDate: '[DATA DA LEITURA]',
        date: '[DATA]',
        amount: '[VALOR]',
      },
      services: {
        electricity: 'fornecimento de eletricidade',
        gas: 'fornecimento de gás natural',
        water: 'fornecimento de água',
        telecom: 'serviços de telecomunicações',
        insurance: 'seguros',
        other: 'serviço',
      },
      header: (nif: string, provider: string, date: string) =>
        `[NOME]\n[MORADA]\nNIF: ${nif}\n\n${provider}\n${date}`,
      reference: (customerNumber: string, supplyPoint?: string) =>
        `N.º de cliente: ${customerNumber}` + (supplyPoint ? `\nCPE/CUI: ${supplyPoint}` : ''),
      greeting: 'Exmos. Senhores,',
      closing: 'Com os melhores cumprimentos,\n[NOME]',
      subjects: {
        renegotiate: 'Pedido de revisão do preço',
        price_increase: 'Pedido de esclarecimento sobre aumento de preço',
        estimated_reading: 'Reclamação: faturação com leituras estimadas',
        block_extras: 'Pedido de barramento de serviços de valor acrescentado',
        cancel: 'Denúncia do contrato',
      },
      subjectLine: (subject: string) => `Assunto: ${subject}`,
      client: (service: string, tariff?: string) =>
        `Sou vosso cliente de ${service}` + (tariff ? `, com o tarifário ${tariff}.` : '.'),
      average: (amount: string, count: number) =>
        count === 1
          ? `Na última fatura paguei ${amount}.`
          : `Nas últimas ${count} faturas paguei em média ${amount} por mês.`,
      loyaltyEnded: (date: string) => `O meu período de fidelização terminou a ${date}.`,
      loyaltyEnds: (date: string) => `O meu período de fidelização termina a ${date}.`,
      cheaperOffer: (offer: string, saving: string) =>
        `No simulador da ERSE encontrei uma oferta mais económica (${offer}), com uma poupança estimada de ${saving} por ano.`,
      renegotiateAsk:
        'Gostaria de continuar como vosso cliente, mas a um preço mais competitivo. Peço que me enviem por escrito uma proposta com um preço mais baixo para o mesmo serviço, com o preço mensal, a duração e as condições de fidelização, se as houver.',
      renegotiateElse: 'Se não for possível, vou ponderar mudar de fornecedor.',
      increaseBaseFee: (date: string, before: string, after: string) =>
        `Na fatura de ${date}, a mensalidade passou de ${before} para ${after}.`,
      increaseTotal: (date: string, before: string, after: string) =>
        `A fatura de ${date} tem o valor de ${after}, acima da média de ${before} das faturas anteriores, sem que eu tenha alterado o serviço.`,
      increaseUnitPrice: (date: string, pct: string) =>
        `Na fatura de ${date}, o preço da energia subiu ${pct} % em relação à fatura anterior.`,
      increaseUnknown: (date: string, amount: string) =>
        `Na fatura de ${date}, no valor de ${amount}, verifiquei um aumento do preço que pago.`,
      auditDetails: 'Comparando com a fatura anterior:',
      extraUsage: (date: string) => `Na fatura de ${date} foram cobrados consumos fora do pacote:`,
      extraUsageItem: (description: string, amount: string) => `${description}: ${amount} sem IVA`,
      blockAsk:
        'Peço que barrem nas minhas linhas o acesso a serviços de valor acrescentado (chamadas e mensagens para números de valor acrescentado e subscrições de conteúdos) e, se for possível, o roaming de dados, e que me confirmem por escrito quando o barramento estiver ativo.',
      increaseAsk:
        'Peço que me expliquem o motivo deste aumento e a cláusula do contrato em que se baseia. Se o aumento não estiver previsto no contrato, peço que o corrijam e que me devolvam a diferença já cobrada.',
      estimatedCount: (count: number) =>
        `As últimas ${count} faturas foram emitidas com leituras estimadas e não com a leitura real do contador.`,
      estimatedSome:
        'As últimas faturas foram emitidas com leituras estimadas e não com a leitura real do contador.',
      estimatedLatest: (date: string, amount: string) =>
        `A mais recente, de ${date}, tem o valor de ${amount}.`,
      estimatedAsk:
        'Peço que corrijam a faturação com base na leitura real e que emitam uma nova fatura. A leitura atual do contador é [LEITURA], em [DATA DA LEITURA]. Peço também que me informem quando será feita a próxima leitura real.',
      cancelStatement: (service: string) =>
        `Venho por este meio denunciar o contrato de ${service} identificado acima, com efeitos a partir de [DATA DE FIM].`,
      cancelAsk: (telecom: boolean) =>
        'Peço que me confirmem por escrito a data em que o contrato termina, o valor da última fatura e se há algum encargo associado à cessação' +
        (telecom ? ', bem como as instruções para devolver os equipamentos, se for o caso.' : '.'),
    },
    calendar: {
      title: 'Datas no teu calendário',
      intro:
        'Descarrega um ficheiro com o fim das fidelizações, as renovações dos seguros, as datas-limite de pagamento e os dias para comunicar a leitura do contador, com lembretes, e abre-o no calendário do telemóvel ou do PC.',
      export: 'Adicionar ao calendário',
      exported: (count: number) =>
        count === 1
          ? 'Ficheiro com 1 data descarregado.'
          : `Ficheiro com ${count} datas descarregado.`,
      empty:
        'Ainda não há datas para o calendário. Guarda o fim da fidelização na página de cada contrato.',
      note: 'O ficheiro é criado neste dispositivo e tem o nome dos contratos e o valor das faturas. Se o abrires num calendário online (Google, Outlook, iCloud), estes dados passam a estar lá. Quando mudares uma data ou guardares faturas novas, descarrega-o outra vez. Alguns calendários usam os teus lembretes habituais em vez dos do ficheiro.',
      fileName: 'faturometro-datas.ics',
      calendarName: 'Faturómetro',
      name: (label: string, provider: string) => (provider ? `${label}, ${provider}` : label),
      loyaltySummary: (name: string) => `Fim da fidelização: ${name}`,
      loyaltyDescription:
        'A fidelização deste contrato termina hoje. A partir daqui podes mudar de tarifário ou de operador sem penalização. Compara as ofertas no Faturómetro antes de aceitar uma renovação.',
      loyaltyReminder: (name: string) => `A fidelização de ${name} está a acabar`,
      renewalSummary: (name: string) => `Renovação do seguro: ${name}`,
      renewalDescription:
        'O seguro renova hoje por mais um período. Antes disso, podes pedir propostas a outras seguradoras com as mesmas coberturas e comparar no Faturómetro.',
      renewalReminder: (name: string) => `O seguro ${name} está a renovar`,
      readingSummary: (name: string) => `Comunicar a leitura do contador: ${name}`,
      readingDescription:
        'Período para comunicar a leitura do contador, indicado na última fatura. Com a leitura real, a próxima fatura não usa uma estimativa.',
      readingReminder: (name: string) => `Comunica hoje a leitura do contador de ${name}`,
      paymentSummary: (name: string, amount: string) => `Pagar fatura: ${name} (${amount})`,
      paymentDescription: (issueDate: string) =>
        `Data-limite de pagamento da fatura de ${issueDate}. Se pagas por débito direto, não precisas de fazer nada.`,
      paymentReminder: (name: string, amount: string) =>
        `Fatura de ${name} (${amount}) a pagar em breve`,
    },
  },
  ingest: {
    title: 'Adicionar fatura',
    intro:
      'Escolhe o PDF descarregado da área de cliente ou tira uma fotografia à fatura em papel.',
    chooseFile: 'Escolher ficheiro',
    pages: {
      hint: 'A fatura tem mais páginas? Fotografa-as antes de pedir à IA, para que leia tudo.',
      hintNoQr:
        'O código QR não estava nesta fotografia. Se a fatura tiver mais páginas, fotografa a página onde ele está.',
      add: 'Acrescentar outra página desta fatura',
      count: (count: number) => `${count} páginas desta fatura.`,
    },
    nextFile: (count: number) =>
      count === 1 ? 'Ler o ficheiro que falta' : `Ler o próximo ficheiro (faltam ${count})`,
    dropHint:
      'Podes escolher vários ficheiros de uma vez. No computador, também os podes arrastar para aqui ou, com a app instalada, abrir um PDF com o Faturómetro.',
    dropHere: 'Larga os ficheiros para os ler',
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
      convertIntro:
        'Os dados que já tens passam para a conta. A palavra-passe passa a cifrá-los: sem ela, ninguém os consegue ler, nem nós.',
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
      intro: 'As contas do Faturómetro ficam no dispositivo onde as crias.',
      returningTitle: 'Olá de novo',
      introOne: 'Escreve a palavra-passe para abrir os teus dados.',
      introMany: 'Escolhe o email e escreve a palavra-passe.',
      submit: 'Entrar',
      noAccounts: 'Ainda não há contas neste dispositivo.',
      createAccount: 'Criar conta',
      forgot: 'Esqueceste-te da palavra-passe?',
      continueGuest: 'Continuar sem conta',
      startGuest: 'Começar sem conta',
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
    status: 'Versão beta',
    signIn: 'Entrar',
    createAccount: 'Criar conta',
    startGuest: 'Começar sem conta',
    continueGuest: 'Continuar sem conta',
    openApp: 'Abrir a app',
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
      free: 'O Faturómetro é gratuito.',
    },
  },
} as const;

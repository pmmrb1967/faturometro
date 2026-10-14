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
          'Quando a app não conhece o layout de uma fatura, podes enviar a sua estrutura ao responsável do projeto para a app passar a lê-la. Antes de enviar vês exatamente o que sai: as posições do texto, as palavras típicas de faturas e números trocados ao acaso. As outras palavras vão tapadas, e os dados pessoais lidos da fatura nunca se podem destapar.',
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
    iosSteps: [
      'Abre esta página no Safari.',
      'Toca no botão Partilhar (o quadrado com a seta para cima).',
      'Escolhe “Adicionar ao ecrã principal” e confirma.',
    ],
    manualSteps: [
      'No Chrome ou Edge: abre o menu do browser (⋮).',
      'Escolhe “Instalar app” ou “Adicionar ao ecrã principal”.',
      'Se o browser só oferecer “Criar atalho”, atualiza o Chrome e os Serviços do Google Play e tenta de novo; o atalho também funciona.',
    ],
    dataNote:
      'Os dados ficam neste dispositivo: desinstalar a app ou limpar os dados do site apaga-os, a não ser que tenhas a sincronização ligada ou uma exportação recente.',
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
    hint: 'Ao atualizar, vais ter de voltar a entrar.',
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
    noticeTitle: 'Estás a usar a app sem conta',
    notice: [
      'Os teus dados ficam só neste browser e não estão protegidos por palavra-passe: quem usar este browser consegue vê-los.',
      'Se limpares os dados do site, perdes tudo. Faz uma cópia de segurança (mais abaixo) ou cria uma conta.',
    ],
  },
  signOutLabel: 'Sair da conta (a app fica bloqueada até voltares a entrar)',
  alerts: {
    title: 'Avisos',
    empty: 'Sem avisos. Quando algo mudar nos teus contratos, aparece aqui.',
    dismiss: 'Dispensar',
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
      missingInvoice: (label: string, date: string, days: number) =>
        `${label}: a última fatura é de ${date}, há ${days} dias. Confirma se chegou alguma nova.`,
      cheaperOffer: (label: string, saving: string) =>
        `${label}: há uma oferta que pode poupar cerca de ${saving} por ano (estimativa).`,
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
      link: 'Já usas o Faturómetro noutro dispositivo com sincronização? Entrar com essa conta',
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
        'Esta fatura não tem um leitor automático. Com uma chave da Anthropic (Definições), a IA pode lê-la por ti.',
      intro: 'Esta fatura não tem um leitor automático. Podes pedir à IA para a ler.',
      willSend: 'Vai ser enviado para api.anthropic.com:',
      sendText: (chars: number) => `o texto da fatura (${chars.toLocaleString('pt-PT')} carateres)`,
      sendPdf: 'o PDF da fatura (não tem texto, é uma digitalização)',
      sendImage: 'a fotografia da fatura',
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
      power: 'Potência contratada',
      cycle: 'Ciclo horário',
      socialTariff: 'Tarifa social',
      yes: 'Sim',
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
      table: 'Ver como tabela',
      invoice: 'Fatura',
      value: 'Valor',
      invoiceOf: (date: string) => `Fatura de ${date}`,
    },
    invoicesTitle: 'Faturas deste contrato',
  },
  ingest: {
    title: 'Adicionar fatura',
    intro:
      'Escolhe o PDF descarregado da área de cliente ou tira uma fotografia à fatura em papel.',
    chooseFile: 'Escolher ficheiro',
    nextShared: (count: number) =>
      count === 1
        ? 'Ler o outro ficheiro partilhado'
        : `Ler o próximo ficheiro partilhado (faltam ${count})`,
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
      intro: 'Abre a tua conta neste dispositivo.',
      submit: 'Entrar',
      noAccounts: 'Ainda não há contas neste dispositivo.',
      createAccount: 'Criar conta',
      forgot: 'Esqueceste-te da palavra-passe?',
      continueGuest: 'Continuar sem conta',
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

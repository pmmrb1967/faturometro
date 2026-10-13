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
  notFound: {
    title: 'Esta página não existe',
    body: 'Verifica o endereço ou volta ao início.',
    back: 'Voltar ao início',
  },
  landing: {
    status: 'Em desenvolvimento: algumas funções ainda não estão disponíveis.',
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
      free: 'O Faturómetro é gratuito e de código aberto.',
      source: 'Código no GitHub',
    },
  },
} as const;

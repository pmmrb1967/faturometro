# Gastos: registo das despesas do dia a dia

Aprovado no chat a 2026-10-30 (fases 1 a 3). O utilizador regista as compras do dia.

## Porquê

A app já conhece a maioria das despesas certas da casa. Falta o resto do mês: supermercado, restaurantes, farmácia. Isto altera a decisão de 2026-10-18 ("a app não é um gestor de orçamento") só nesta medida: um módulo opcional, desligado por omissão.

## Objetivos

- Ver num só sítio tudo o que se gastou num mês, por categoria.
- Registar uma compra em segundos, à mão ou pelo QR fiscal do talão, sem IA.

## Fora de âmbito

- Ligação ao banco: exigiria um servidor com acesso aos movimentos (regra 1).
- Limites por categoria, metas de poupança, importação de CSV, categorias personalizadas.
- Alertas e entrada no Início: a visão anual e a comparação continuam só com o que já tinham.

## Desenho

- **Ativação:** `Settings.spendingEnabled` (sincronizado), desligado por omissão. Mostra em "Este mês" os separadores **Pagamentos | Gastos**, com o mesmo seletor de mês; desligado, a página fica sem separadores. Desligar mantém os dados. A navegação fica com 6 entradas (a primeira versão tinha uma sétima, que obrigava a letra mais pequena no telemóvel). O separador é lembrado no dispositivo; `?separador=gastos|pagamentos` escolhe-o (os avisos de pagamento abrem Pagamentos) e `/app/gastos` redireciona.
- **Gráficos:** "Ao longo do mês", linha do acumulado por dia contra o mês anterior, que pára hoje no mês corrente (o que ainda vence não foi gasto); "Por categoria", barras ordenadas, de uma só cor, sobre um fundo cinzento que é o total do mês: a barra diz o mesmo que a percentagem, e o fundo liga os valores à sua barra quando esta é curta. Sem circular: com dez categorias e uma renda, as pequenas deixavam de se ler.
- **Gráfico do ano:** "Ao longo do ano", escolhido com Mês | Ano no quadro, lembrado no dispositivo. Total de cada mês contra o ano anterior, com as receitas de cada mês. Mês sem registos é uma falha; a frase só compara meses com dados nos dois anos, e uma nota avisa enquanto só um dos lados tem compras. Um mês sem gastos, ou ainda por vir, mostra o gráfico do seu ano, sem seletor. O ano anterior só entra na legenda e na tabela se tiver dados.
- **Dados:** tabela `transactions` (esquema v7), cifrada, sincronizada e na cópia de segurança. Guarda só as compras avulsas. Faturas e despesas sem fatura são calculadas na hora, como as previsões, por isso nada se duplica.
- **Mês de cada gasto:** o mesmo do "Este mês", sem previsões, mais as compras do mês. O total dos dois só difere nas previsões e nas compras.
- **Categorias:** lista fixa em `src/domain/spending.ts`. Faturas pelo setor do contrato; despesas sem fatura pelo campo opcional `category` (sem categoria, "Outros"), mudado na própria lista.
- **Talão:** a fotografia é lida no dispositivo e não é guardada. Só se usa o QR fiscal, que é a própria fonte (regra 5). Lê NIF, data, total e tipo; nota de crédito fica negativa (`signedTotalCents`). A revisão é sempre feita pelo utilizador antes de guardar.
- **Sem QR legível:** abre o formulário manual vazio, com aviso.
- **Sem duplicados:** o id de uma compra do talão deriva de `docKey` (`qr-<docKey>`), por isso dois dispositivos escrevem o mesmo registo. Um documento já guardado como fatura ou como compra é recusado ao ler; uma compra cuja fatura seja acrescentada depois deixa de contar.
- **Sugestões:** para um NIF, a descrição e a categoria da última compra; sem compra anterior, o nome do fornecedor conhecido.
- **Receitas:** secção de Gastos acima dos gráficos (no fim da página ficava cada vez mais longe com os movimentos), com a estrutura das Despesas sem fatura, mas sem título, porque a lista já diz "Receitas deste mês": lista dobrável e botão à vista. O texto explicativo fica na ajuda da secção, porque se lê uma vez. Sem opção própria. Tabela `incomes` (esquema v8), cifrada, sincronizada e na cópia de segurança. Fixas (com mudança de valor a partir de um mês) ou pontuais, pelas regras das despesas sem fatura. Valor líquido, no mês da data de entrada.
- **Saldo:** com receitas no mês, o topo mostra Gastos, Receitas e Saldo; sem elas, fica como estava. O saldo conta todo o mês e a curva só vai até hoje, e a página diz isso no mês corrente. No gráfico, as receitas são uma linha tracejada a toda a largura, com legenda, frase e linha na tabela. A escala inclui-as, por isso as curvas ficam mais baixas quando as receitas são muito maiores.

- **Ajuda:** duas, fechadas por omissão e junto do que explicam: "Onde registar cada gasto?", a seguir aos botões de registo, e "Onde registar cada receita?", a seguir a "Acrescentar receita". Um formulário único para gastos e receitas foi rejeitado: os campos são quase todos diferentes e acrescentava um passo a cada compra.
- **Pontual ou Gastos:** o que já foi pago regista-se em Gastos; o que ainda se tem de pagar, com data, fica nas Despesas sem fatura, com o visto de paga. "Pontual" mantém-se: Gastos é opcional, e a comparação anual conta as pontuais mas não as compras.

## A confirmar com uso real

Não há talões de exemplo no repositório. A especificação diz que o QR é obrigatório em documentos de programas certificados, mas a leitura de talões térmicos fotografados só se confirma com talões verdadeiros. Se falhar, o formulário manual cobre o caso.

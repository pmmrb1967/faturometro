# Gastos: registo das despesas do dia a dia

Aprovado no chat a 2026-10-30 (fases 1 a 3). O utilizador regista as compras do dia.

## Porquê

A app já conhece a maioria das despesas certas da casa. Falta o resto do mês: supermercado, restaurantes, farmácia. Isto altera a decisão de 2026-10-18 ("a app não é um gestor de orçamento") só nesta medida: um módulo opcional, desligado por omissão.

## Objetivos

- Ver num só sítio tudo o que se gastou num mês, por categoria.
- Registar uma compra em segundos, à mão ou pelo QR fiscal do talão, sem IA.

## Fora de âmbito

- Ligação ao banco: exigiria um servidor com acesso aos movimentos (regra 1).
- Limites por categoria, importação de CSV, categorias personalizadas.
- Alertas e entrada no Início: a visão anual e a comparação continuam só com o que já tinham.

## Desenho

- **Ativação:** `Settings.spendingEnabled` (sincronizado), desligado por omissão. Liga a secção "Gastos" (`/app/gastos`) na navegação. Desligar esconde a secção e mantém os dados.
- **Dados:** tabela `transactions` (esquema v7), cifrada, sincronizada e na cópia de segurança. Guarda só as compras avulsas. Faturas e despesas sem fatura são calculadas na hora, como as previsões, por isso nada se duplica.
- **Mês de cada gasto:** o mesmo do "Este mês", sem previsões, mais as compras do mês. O total dos dois só difere nas previsões e nas compras.
- **Categorias:** lista fixa em `src/domain/spending.ts`. Faturas pelo setor do contrato; despesas sem fatura pelo campo opcional `category` (sem categoria, "Outros"), mudado na própria lista.
- **Talão:** a fotografia é lida no dispositivo e não é guardada. Só se usa o QR fiscal, que é a própria fonte (regra 5). Lê NIF, data, total e tipo; nota de crédito fica negativa (`signedTotalCents`). A revisão é sempre feita pelo utilizador antes de guardar.
- **Sem QR legível:** abre o formulário manual vazio, com aviso.
- **Sem duplicados:** o id de uma compra do talão deriva de `docKey` (`qr-<docKey>`), por isso dois dispositivos escrevem o mesmo registo. Um documento já guardado como fatura ou como compra é recusado ao ler; uma compra cuja fatura seja acrescentada depois deixa de contar.
- **Sugestões:** para um NIF, a descrição e a categoria da última compra; sem compra anterior, o nome do fornecedor conhecido.

## A confirmar com uso real

Não há talões de exemplo no repositório. A especificação diz que o QR é obrigatório em documentos de programas certificados, mas a leitura de talões térmicos fotografados só se confirma com talões verdadeiros. Se falhar, o formulário manual cobre o caso.

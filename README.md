# Cortadores • Armazém

Dashboard para acompanhar a produção de corte da empresa a partir de abas de uma mesma Google Sheets.

## Princípios da importação

- **ID_PEDIDO é preservado como veio da planilha.** Não é convertido para número e não tem zeros/hífens removidos.
- Nomes de cortadores são sanitizados para um nome canônico.
- Tipo de corte é normalizado para `CORRIDO`, `LOCALIZADO` ou `NÃO INFORMADO`.
- Total de peças é extraído de células como `560 PÇS PEÇAS`, mantendo o texto bruto e sinalizando casos ambíguos.
- Data/hora do corte é preservada e usada nos filtros por período.
- A arquitetura lê os campos pelo **cabeçalho**, não pela letra da coluna. Assim as letras podem mudar entre abas.
- A aba sem nome/Página5 fica fora por enquanto.

## Primeira fonte

A primeira versão usa a aba **CORTES EM GERAL**. As abas individuais `EDNILSON`, `VERÔNICA` e `LUANA` ficam preparadas para serem mapeadas depois que seus formatos forem enviados.

## Uso

Abra o dashboard, entre em **Fonte de dados**, cole o link da Google Sheets e informe a aba. A configuração fica somente no navegador (localStorage); o link da planilha não é gravado neste repositório público.

A planilha precisa permitir a leitura do CSV pelo endpoint do Google Sheets usado pelo navegador.

## Campos reconhecidos na aba geral

- `QUEM CORTOU`
- `ID_PEDIDO`
- `CORRIDO (1) OU LOCALIZADO(2)`
- `TOTAL DE PEÇAS CORTADAS`
- `DATA DO CORTE`

O parser aceita variações de pontuação, acentos e espaços nos cabeçalhos.

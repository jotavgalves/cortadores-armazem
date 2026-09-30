# Cortadores • Armazém

Dashboard de produção de corte para Cloudflare Pages.

## Fonte de dados

O site lê diretamente esta Google Sheets:

`https://docs.google.com/spreadsheets/d/1o9JVEfpR03WCQfLYp8n2DLZe0VckLGWxKMsmxOtq6B8/edit?gid=0#gid=0`

Nesta primeira versão, a fonte consolidada é a aba **CORTES EM GERAL** (`gid=0`).

O navegador consulta a planilha pelo endpoint CSV/GViz do Google Sheets com `cache: no-store` e um timestamp na URL.

### Atualização

- carregamento automático ao abrir o site;
- atualização automática a cada **60 segundos**;
- atualização imediata pelo botão **Atualizar**;
- nova consulta ao voltar para a aba/janela caso os dados estejam há mais de 30 segundos sem atualização.

## Normalização

Os dados são lidos pelos cabeçalhos, não pelas letras das colunas.

Campos usados:

- `QUEM CORTOU`
- `ID_PEDIDO`
- `CORRIDO (1) OU LOCALIZADO(2)`
- `TOTAL DE PEÇAS CORTADAS`
- `DATA DO CORTE`

### ID_PEDIDO

O ID é preservado **exatamente como veio da planilha**. Não é convertido para número, não perde zeros e não tem hífens removidos.

### Cortadores

As variações de nome são sanitizadas para três nomes canônicos:

- **Ednilson**
- **Verônica**
- **Luana**

Exemplos como `Ednilson`, `VERÔNICA MARIA DE OLIVEIR` e `LUANA🥰` entram no respectivo cortador. Outros nomes continuam visíveis como registros fora dos três principais.

### Tipo de corte

É normalizado para:

- `CORRIDO`
- `LOCALIZADO`
- `NÃO INFORMADO`

### Peças

O sistema extrai a quantidade de textos como `560 PÇS PEÇAS` ou `250 PEÇAS`. Quando há mais de um número na mesma célula, o primeiro é usado e o registro recebe um alerta de revisão.

### Data

A data/hora do corte é usada para filtros por dia, mês e período personalizado e para o gráfico diário.

## Abas individuais

As abas **EDNILSON**, **VERÔNICA** e **LUANA** ficam fora da soma nesta primeira versão para evitar duplicação enquanto `CORTES EM GERAL` for a fonte consolidada. A aba `Página5` também é ignorada por enquanto.

## Cloudflare Pages

O projeto é estático: basta conectar este repositório ao Cloudflare Pages. Não há etapa de build obrigatória.

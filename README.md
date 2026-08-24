# Folha de Estudo

Plataforma para enviar PDF ou Word, extrair as informações principais, revisar o conteúdo em campos editáveis, salvar online e baixar uma nova folha em PDF ou Word.

## Como usar

Para usar o ChatGPT na geração da introdução, perguntas e conclusão, configure a variável `OPENAI_API_KEY`.

```bash
export OPENAI_API_KEY="sua-chave-da-openai"
```

Opcionalmente, escolha o modelo:

```bash
export OPENAI_MODEL="gpt-4o-mini"
```

Se a chave não estiver configurada, a plataforma continua funcionando com o gerador local.

1. Inicie a plataforma:

```bash
python3 server.py
```

2. Abra no navegador:

```text
http://127.0.0.1:8787
```

3. Selecione um arquivo PDF, DOCX, DOC, RTF ou ODT.
4. Clique em **Gerar Folha de Estudo**, revise os campos e clique em **Baixar** ou **Salvar Arquivo Online**.

## Campos gerados

- Título da série
- Linha do culto
- Momento Generosidade
- Avisos / Agenda
- Momento da Visão
- Resumo
- Perguntas
- Conclusão

## Vercel

No painel da Vercel, adicione `OPENAI_API_KEY` em **Project Settings > Environment Variables**.
Depois faça um novo deploy. O front continua o mesmo; apenas o backend passa a chamar a API da OpenAI.

Para que **Arquivos salvos** apareça para todos, adicione também estas variáveis na Vercel:

- `GITHUB_TOKEN`: token do GitHub com permissão de escrita no repositório.
- `GITHUB_REPO`: `ashlleymichel/estudo-life`
- `GITHUB_BRANCH`: `main`

Os arquivos salvos ficam registrados em `data/saved-files.json` no próprio repositório.

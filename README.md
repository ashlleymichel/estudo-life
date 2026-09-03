# Folha de Estudo

Plataforma para enviar PDF ou Word, extrair as informações principais, revisar o conteúdo em prévia/editável, salvar online e baixar a folha em PDF ou DOCX.

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

Para que os arquivos salvos apareçam para todos no Vercel, configure também:

```bash
GITHUB_TOKEN="seu-token-do-github"
GITHUB_REPO="ashlleymichel/estudo-life"
GITHUB_BRANCH="main"
```

1. Inicie a plataforma:

```bash
python3 server.py
```

2. Abra no navegador:

```text
http://127.0.0.1:8787
```

3. Clique em **Criar PDF** e selecione um arquivo PDF, DOCX, DOC, RTF ou ODT.
4. Revise a prévia ou edite os campos da folha.
5. Clique em **Salvar** para deixar a folha online ou em **Baixar** para escolher PDF/DOCX.

## Campos gerados

- Título da série
- Linha do culto
- Momento Generosidade
- Avisos / Agenda
- Momento da Visão
- Resumo
- Perguntas
- Conclusão

## Arquivos salvos

Quando as variáveis do GitHub estão configuradas no Vercel, a lista de **Arquivos salvos** fica compartilhada para todos. Sem essa configuração, o ambiente local usa um salvamento temporário no próprio computador para testes.

## Vercel

No painel da Vercel, adicione `OPENAI_API_KEY` em **Project Settings > Environment Variables**.
Depois faça um novo deploy. O front continua o mesmo; apenas o backend passa a chamar a API da OpenAI.

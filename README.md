# Folha de Estudo

Plataforma local para enviar PDF ou Word, extrair as informações principais, revisar o conteúdo em campos editáveis e baixar uma nova folha em PDF.

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

3. Escolha **Life Group** ou **TADEL**.
4. Selecione um arquivo PDF, DOCX, DOC, RTF ou ODT.
5. Clique em **Extrair informações**, revise os campos e clique em **Baixar PDF** ou **Baixar Resumo**.

## Campos gerados

- Título da série
- Linha do culto
- Momento Generosidade
- Avisos / Agenda
- Momento da Visão
- Resumo
- Perguntas
- Conclusão

## Modos

- **Life Group**: gera folha de estudo com generosidade, avisos, visão, resumo, 4 perguntas e conclusão.
- **TADEL**: gera resumo com data, título, conteúdo e conclusão, seguindo os modelos da pasta `TADEL`.

## Vercel

No painel da Vercel, adicione `OPENAI_API_KEY` em **Project Settings > Environment Variables**.
Depois faça um novo deploy. O front continua o mesmo; apenas o backend passa a chamar a API da OpenAI.

import json
import os
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlparse

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Flowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

try:
    from PyPDF2 import PdfReader
except Exception:
    PdfReader = None


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "public"
LOGO_PATH = ROOT / "LOGO" / "LOGO.svg"
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

DEFAULT_GENEROSIDADE = (
    'Todas as ofertas dos "Life Groups" são destinadas ao ministério Amor em Ação. '
    "A sua oferta tem impactado e alcançado muitas vidas para Jesus! Glórias a Deus por isso! "
    "Para contribuir com esse projeto: Banco: Bradesco / Agência: 2386 / Conta Corrente: "
    "0023301-3 / ONG PAZ. Através do PIX - CNPJ: 08.399.229/0001-52."
)

DEFAULT_VISAO = (
    "Nossa Missão: Fazer discípulos de Jesus que impactam o mundo inteiro com uma paixão contagiante "
    "por Deus, um desejo insaciável por mais Dele, e uma vida transbordante com o Seu poder. "
    "Nossa Visão: Ser um movimento de plantação de igrejas saudáveis e multiplicadoras, começando "
    "de onde estamos e avançando para todo o mundo."
)

DEFAULT_AVISOS = "Encontro com Deus: 14 a 16 de agosto / inscrições abertas / informações com seu líder"
FIRST_QUESTION = "Compartilhe conosco o que essa Palavra de domingo falou com você."


HEADER_HEIGHT = A4[0] * (168 / 1440)
HEADER_RADIUS = A4[0] * (40 / 1440)


def draw_document_header(canvas, doc, header_text="Estudo Life Group"):
    page_width, page_height = A4
    h = HEADER_HEIGHT
    radius = HEADER_RADIUS
    p = canvas.beginPath()
    p.moveTo(0, page_height)
    p.lineTo(page_width, page_height)
    p.lineTo(page_width, page_height - h + radius)
    p.curveTo(
        page_width,
        page_height - h + radius * 0.45,
        page_width - radius * 0.45,
        page_height - h,
        page_width - radius,
        page_height - h,
    )
    p.lineTo(radius, page_height - h)
    p.curveTo(
        radius * 0.45,
        page_height - h,
        0,
        page_height - h + radius * 0.45,
        0,
        page_height - h + radius,
    )
    p.lineTo(0, page_height)
    p.close()

    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#203A61"))
    canvas.drawPath(p, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    header_font = "DocBold" if "DocBold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"
    canvas.setFont(header_font, 19)
    text_width = canvas.stringWidth(header_text, header_font, 19)
    canvas.drawString((page_width - text_width) / 2, page_height - h + 23, header_text)
    canvas.restoreState()


def draw_life_group_header(canvas, doc):
    draw_document_header(canvas, doc, "Estudo Life Group")


def register_document_fonts():
    fonts = {
        "DocRegular": Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        "DocBold": Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    }
    registered = {}
    for name, path in fonts.items():
        if path.exists() and name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(name, str(path)))
        if name in pdfmetrics.getRegisteredFontNames():
            registered[name] = name
    return registered.get("DocRegular", "Helvetica"), registered.get("DocBold", "Helvetica-Bold")


class SvgLogo(Flowable):
    def __init__(self, svg_path, width=1.35 * cm, height=1.35 * cm):
        super().__init__()
        self.svg_path = Path(svg_path)
        self.width = width
        self.height = height
        self.paths, self.fill_color = self.load_svg()

    def load_svg(self):
        if not self.svg_path.exists():
            return [], colors.HexColor("#183a64")

        root = ET.parse(self.svg_path).getroot()
        view_box = root.attrib.get("viewBox", "0 0 2000 2000").split()
        self.view_width = float(view_box[2]) if len(view_box) == 4 else 2000.0
        self.view_height = float(view_box[3]) if len(view_box) == 4 else 2000.0
        color = colors.HexColor("#183a64")
        paths = []

        for node in root.iter():
            if node.tag.endswith("style") and node.text:
                match = re.search(r"fill\s*:\s*(#[0-9a-fA-F]{6})", node.text)
                if match:
                    color = colors.HexColor(match.group(1))
            if node.tag.endswith("path") and node.attrib.get("d"):
                paths.append(node.attrib["d"])

        return paths, color

    def wrap(self, avail_width, avail_height):
        return self.width, self.height

    def draw(self):
        if not self.paths:
            return

        canvas = self.canv
        scale = min(self.width / self.view_width, self.height / self.view_height)
        x_offset = (self.width - self.view_width * scale) / 2
        y_offset = (self.height - self.view_height * scale) / 2

        canvas.saveState()
        canvas.translate(x_offset, self.height - y_offset)
        canvas.scale(scale, -scale)
        canvas.setFillColor(self.fill_color)
        canvas.setStrokeColor(self.fill_color)
        for path_data in self.paths:
            canvas.drawPath(svg_path_to_reportlab(canvas, path_data), fill=1, stroke=0)
        canvas.restoreState()


def svg_path_to_reportlab(canvas, path_data):
    tokens = re.findall(
        r"[MmLlHhVvCcZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?",
        path_data,
    )
    path = canvas.beginPath()
    index = 0
    command = None
    current_x = current_y = 0.0
    start_x = start_y = 0.0

    def is_command(value):
        return re.fullmatch(r"[MmLlHhVvCcZz]", value or "") is not None

    def number():
        nonlocal index
        value = float(tokens[index])
        index += 1
        return value

    while index < len(tokens):
        if is_command(tokens[index]):
            command = tokens[index]
            index += 1

        if command in ("M", "m"):
            first_point = True
            while index < len(tokens) and not is_command(tokens[index]):
                x = number()
                y = number()
                if command == "m":
                    x += current_x
                    y += current_y
                if first_point:
                    path.moveTo(x, y)
                    start_x, start_y = x, y
                    first_point = False
                else:
                    path.lineTo(x, y)
                current_x, current_y = x, y
            command = "l" if command == "m" else "L"
        elif command in ("L", "l"):
            while index < len(tokens) and not is_command(tokens[index]):
                x = number()
                y = number()
                if command == "l":
                    x += current_x
                    y += current_y
                path.lineTo(x, y)
                current_x, current_y = x, y
        elif command in ("H", "h"):
            while index < len(tokens) and not is_command(tokens[index]):
                x = number()
                if command == "h":
                    x += current_x
                path.lineTo(x, current_y)
                current_x = x
        elif command in ("V", "v"):
            while index < len(tokens) and not is_command(tokens[index]):
                y = number()
                if command == "v":
                    y += current_y
                path.lineTo(current_x, y)
                current_y = y
        elif command in ("C", "c"):
            while index < len(tokens) and not is_command(tokens[index]):
                x1, y1 = number(), number()
                x2, y2 = number(), number()
                x3, y3 = number(), number()
                if command == "c":
                    x1 += current_x
                    y1 += current_y
                    x2 += current_x
                    y2 += current_y
                    x3 += current_x
                    y3 += current_y
                path.curveTo(x1, y1, x2, y2, x3, y3)
                current_x, current_y = x3, y3
        elif command in ("Z", "z"):
            path.close()
            current_x, current_y = start_x, start_y
            command = None
        else:
            break

    return path


def draw_svg_logo(canvas, x, y, size=0.46 * cm):
    logo = SvgLogo(LOGO_PATH, width=size, height=size)
    if not logo.paths:
        return

    scale = min(size / logo.view_width, size / logo.view_height)
    canvas.saveState()
    canvas.translate(x, y + size)
    canvas.scale(scale, -scale)
    canvas.setFillColor(logo.fill_color)
    canvas.setStrokeColor(logo.fill_color)
    for path_data in logo.paths:
        canvas.drawPath(svg_path_to_reportlab(canvas, path_data), fill=1, stroke=0)
    canvas.restoreState()


def draw_first_page(canvas, doc):
    page_width, page_height = A4
    size = 0.46 * cm
    draw_svg_logo(canvas, (page_width - size) / 2, page_height - 0.85 * cm, size)


def normalize_text(text):
    replacements = {
        "\ufb01": "fi",
        "\ufb02": "fl",
        "\u00a0": " ",
        "des nadas": "destinadas",
        "mul plicadoras": "multiplicadoras",
        "a rma": "afirma",
        "es verem": "estiverem",
        "domés co": "doméstico",
        "Compar lhe": "Compartilhe",
        "signi ca": "significa",
        "prá ca": "prática",
        "a va": "ativa",
        " lhos": " filhos",
        "edi cou": "edificou",
        "con ança": "confiança",
        "Con ança": "Confiança",
        "con anças": "confianças",
        " ança": "fiança",
        " nanceir": "financeir",
        " lho": "filho",
        " lha": "filha",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    text = re.sub(r"\bcarei\b", "ficarei", text)
    text = re.sub(
        r"\b([1-3])\s*(Samuel|Reis|Crônicas|Cronicas|Coríntios|Corintios|Tessalonicenses|Timóteo|Timoteo|Pedro|João|Joao)\b",
        r"\1 \2",
        text,
    )
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if not re.fullmatch(r"(fi|ti|\s)+", line.strip()))


def extract_text_from_pdf(pdf_path):
    if shutil.which("pdftotext"):
        result = subprocess.run(
            ["pdftotext", "-layout", str(pdf_path), "-"],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.stdout.strip():
            return normalize_text(result.stdout)

    if PdfReader is None:
        raise RuntimeError("Não foi possível ler o PDF neste computador.")

    reader = PdfReader(str(pdf_path))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    return normalize_text(text)


def extract_text_from_docx(docx_path):
    try:
        with zipfile.ZipFile(docx_path) as docx:
            xml = docx.read("word/document.xml")
    except Exception as exc:
        raise RuntimeError("Não foi possível ler o arquivo Word enviado.") from exc

    root = ET.fromstring(xml)
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs = []
    for paragraph_node in root.findall(".//w:p", namespace):
        parts = []
        for text_node in paragraph_node.findall(".//w:t", namespace):
            parts.append(text_node.text or "")
        text = "".join(parts).strip()
        if text:
            paragraphs.append(text)
    return normalize_text("\n".join(paragraphs))


def extract_text_from_document(file_path, filename):
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        return extract_text_from_pdf(file_path)
    if suffix == ".docx":
        return extract_text_from_docx(file_path)
    if suffix in {".doc", ".rtf", ".odt"} and shutil.which("textutil"):
        result = subprocess.run(
            ["textutil", "-convert", "txt", "-stdout", str(file_path)],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.stdout.strip():
            return normalize_text(result.stdout)
    raise RuntimeError("Envie um arquivo PDF, DOCX, DOC, RTF ou ODT.")


def section_between(text, start_labels, end_labels):
    start_pattern = "|".join(re.escape(label) for label in start_labels)
    end_pattern = "|".join(re.escape(label) for label in end_labels)
    stop = rf"(?=(?:\n\s*-?\s*(?:{end_pattern})\s*:)|\Z)" if end_labels else r"(?=\Z)"
    match = re.search(
        rf"(?:^|\n)\s*-?\s*(?:{start_pattern})\s*:?\s*(.*?){stop}",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return clean_block(match.group(1)) if match else ""


def clean_block(value):
    value = re.sub(r"\n+", "\n", value or "").strip()
    value = re.sub(r"^[\s:.-]+", "", value)
    return value.strip()


def truncate_for_model(text, max_chars=26000):
    text = normalize_text(text or "")
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rsplit("\n", 1)[0]


def response_text_from_openai(payload):
    if payload.get("output_text"):
        return payload["output_text"]
    pieces = []
    for item in payload.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                pieces.append(content["text"])
    return "\n".join(pieces).strip()


def call_chatgpt_json(system_prompt, user_prompt, schema, timeout=45):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None

    body = {
        "model": OPENAI_MODEL,
        "input": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "folha_estudo",
                "schema": schema,
                "strict": True,
            }
        },
        "max_output_tokens": 3500,
    }
    request = Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        details = exc.read().decode("utf-8", "ignore")
        raise RuntimeError(f"Erro da OpenAI: {details or exc}") from exc
    except URLError as exc:
        raise RuntimeError("Não foi possível conectar à OpenAI.") from exc

    output = response_text_from_openai(payload)
    if not output:
        raise RuntimeError("A OpenAI não retornou conteúdo para a folha.")
    return json.loads(output)


def life_group_schema():
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "titulo": {"type": "string"},
            "subtitulo": {"type": "string"},
            "resumo": {"type": "string"},
            "perguntas": {
                "type": "array",
                "minItems": 4,
                "maxItems": 4,
                "items": {"type": "string"},
            },
            "conclusao": {"type": "string"},
        },
        "required": ["titulo", "subtitulo", "resumo", "perguntas", "conclusao"],
    }


def life_group_full_schema():
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "titulo": {"type": "string"},
            "subtitulo": {"type": "string"},
            "momentoGenerosidade": {"type": "string"},
            "avisos": {"type": "string"},
            "momentoVisao": {"type": "string"},
            "resumo": {"type": "string"},
            "perguntas": {
                "type": "array",
                "items": {"type": "string"},
            },
            "conclusao": {"type": "string"},
            "tipo": {"type": "string"},
            "textoExtraido": {"type": "string"},
        },
        "required": [
            "titulo",
            "subtitulo",
            "momentoGenerosidade",
            "avisos",
            "momentoVisao",
            "resumo",
            "perguntas",
            "conclusao",
            "tipo",
            "textoExtraido",
        ],
    }


def life_group_chat_schema():
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "reply": {"type": "string"},
            "action": {"type": "string", "enum": ["answered", "updated"]},
            "data": life_group_full_schema(),
        },
        "required": ["reply", "action", "data"],
    }


def generate_life_group_with_chatgpt(text, title="", subtitle=""):
    system_prompt = (
        "Você é um editor pastoral da PAZ Church. Gere uma Folha de Estudo Life Group em português do Brasil, "
        "com escrita clara, bíblica, pastoral e simples para uma reunião da igreja PAZ Church nas casas. "
        "O conteúdo será usado em um pequeno PDF de estudo, então seja objetivo, profundo e fácil de discutir. "
        "Dê ênfase maior aos versículos bíblicos citados no sermão. "
        "Escreva todos os versículos citados na introdução e nas perguntas em itálico entre aspas, usando a versão NAA. "
        "O sistema renderiza o itálico no PDF; no JSON, escreva o versículo entre aspas e com a referência bíblica. "
        "Escreva o versículo completo, sem cortes e sem reticências. "
        "Use as referências bíblicas presentes no texto enviado. Quando o texto trouxer apenas a referência, use o texto completo da NAA se você o souber com segurança; "
        "caso contrário, não invente palavras do versículo. "
        "As perguntas devem ajudar pequenos grupos a discutir o assunto com mais profundidade, sempre apoiadas nos textos bíblicos citados. "
        "Não repita nas perguntas os mesmos versículos que já foram escritos na introdução, exceto se o usuário pedir depois pelo chat. "
        "Quando houver versículos no esboço, inclua a passagem bíblica completa logo abaixo das perguntas 2, 3 e/ou 4, usando versículos diferentes dos usados na introdução sempre que possível. "
        "Quando uma pergunta tiver referência bíblica, escreva a pergunta em uma linha e o versículo logo abaixo. "
        "Prefira o formato: Leia Mateus 7:24-25 e responda: [pergunta]. Na linha seguinte, escreva o versículo entre aspas com a referência entre parênteses. "
        "Evite perguntas rasas, genéricas ou que possam ser respondidas com sim/não. "
        "Não inclua markdown, títulos de seção, numeração externa ou explicações fora dos campos JSON."
    )
    user_prompt = f"""
Título detectado: {title or "não informado"}
Subtítulo detectado: {subtitle or "não informado"}

Contexto e regras por trás:
- Faça um resumo introdutório claro e de fácil entendimento desse texto, que foi o sermão de domingo do pastor, em no máximo 9 linhas, dando ênfase aos versículos.
- Esse texto será apenas a introdução de um pequeno PDF de estudos para uma reunião da igreja PAZ Church nas casas.
- A introdução deve ser coesa, pastoral e conectada ao tema do sermão, não apenas uma lista de versículos.
- Dê ênfase maior aos versículos; use preferencialmente os primeiros versículos principais que aparecem no documento.
- Logo após essa introdução, formule exatamente quatro perguntas para que pequenos grupos discutam esse assunto e aprendam mais profundamente.
- As perguntas devem dar ênfase aos textos bíblicos citados no texto, escrevendo os versículos da mesma forma que na introdução, exceto os versículos que já foram escritos na introdução.
- A primeira pergunta deverá ser exatamente: Compartilhe conosco o que essa Palavra de domingo falou com você.
- As perguntas 2 a 4 devem ser simples de discutir em grupo, mas profundas; devem usar os versículos como apoio e fazer a pessoa ler o texto bíblico antes de responder.
- Quando houver passagens bíblicas no esboço, as perguntas 2, 3 e/ou 4 devem trazer o versículo completo logo abaixo da pergunta, usando versículos diferentes dos que já apareceram na introdução sempre que possível.
- Se houver três ou mais passagens bíblicas relevantes que não foram usadas na introdução, coloque versículo de apoio nas perguntas 2, 3 e 4.
- Nas perguntas que tiverem versículo de apoio, escreva primeiro a pergunta e logo abaixo a passagem bíblica, da mesma forma que na introdução.
- Use este estilo para perguntas com referência bíblica: Leia Mateus 7:24-25 e responda: o que significa construir sua vida sobre a rocha? Quais ações práticas podem solidificar essa construção?
- Na linha logo abaixo da pergunta, escreva a passagem: "Texto completo do versículo" (Mateus 7:24-25 NAA).
- Escreva todos os versículos citados nos textos da introdução e nas perguntas em itálico entre aspas na versão NAA (Nova Almeida Atualizada). O PDF aplicará o itálico; no texto, coloque a passagem entre aspas com a referência.
- Para obter o texto do versículo, use a versão NAA conforme a referência bíblica enviada. Quando necessário, tome como referência o formato do site Bible.com, por exemplo https://www.bible.com/pt/bible/1840/JHN.1.NAA, mas sem copiar referências que não estejam relacionadas ao sermão.
- Escreva o versículo completo, sem cortes, sempre.
- No final, faça uma conclusão curta, com no máximo cinco linhas, sobre os principais destaques e revelações do texto, focando naquilo que é o título.
- Não comece a conclusão com "Concluímos que", "Em resumo" ou "Então".

Texto extraído do arquivo:
{truncate_for_model(text)}
""".strip()
    return call_chatgpt_json(system_prompt, user_prompt, life_group_schema())


def normalize_editable_payload(data):
    data = data or {}
    perguntas = data.get("perguntas") if isinstance(data.get("perguntas"), list) else []
    return {
        "titulo": str(data.get("titulo") or ""),
        "subtitulo": str(data.get("subtitulo") or ""),
        "momentoGenerosidade": str(data.get("momentoGenerosidade") or ""),
        "avisos": str(data.get("avisos") or ""),
        "momentoVisao": str(data.get("momentoVisao") or ""),
        "resumo": str(data.get("resumo") or ""),
        "perguntas": [str(item) for item in perguntas],
        "conclusao": str(data.get("conclusao") or ""),
        "tipo": "life_group",
        "textoExtraido": str(data.get("textoExtraido") or ""),
    }


def revise_life_group_with_chatgpt(data, instruction):
    current = normalize_editable_payload(data)
    instruction = clean_block(instruction)
    if not instruction:
        raise ValueError("Escreva o que deseja alterar na folhinha.")

    system_prompt = (
        "Você é um editor pastoral da PAZ Church. Receberá uma Folha de Estudo Life Group em JSON "
        "e uma instrução de ajuste escrita pelo usuário. Altere somente o que foi solicitado. "
        "Preserve todos os campos que não foram mencionados na instrução. "
        "Mantenha o conteúdo em português do Brasil, com tom bíblico, claro, simples e pastoral. "
        "Se ajustar perguntas com referência bíblica, mantenha sempre a estrutura: pergunta primeiro e passagem bíblica logo abaixo. "
        "Quando houver versículos, escreva-os entre aspas e preserve a referência bíblica. "
        "Não inclua markdown, comentários ou explicações fora do JSON."
    )
    user_prompt = f"""
Pedido do usuário:
{instruction}

Folha atual em JSON:
{json.dumps(current, ensure_ascii=False, indent=2)}
""".strip()

    revised = call_chatgpt_json(system_prompt, user_prompt, life_group_full_schema(), timeout=45)
    if revised is None:
        raise RuntimeError("Configure OPENAI_API_KEY para usar o chat de ajustes.")
    merged = current.copy()
    merged.update(normalize_editable_payload(revised))
    merged["tipo"] = "life_group"
    return merged


def assist_life_group_with_chatgpt(data, message, history=None):
    current = normalize_editable_payload(data)
    message = clean_block(message)
    if not message:
        raise ValueError("Escreva uma mensagem para o assistente.")

    history = history if isinstance(history, list) else []
    safe_history = []
    for item in history[-8:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = clean_block(item.get("content"))
        if role in {"user", "assistant"} and content:
            safe_history.append({"role": role, "content": content[:1500]})

    system_prompt = (
        "Você é o assistente pastoral e editorial da plataforma Folha de Estudo da PAZ Church. "
        "Converse em português do Brasil, seja acolhedor, objetivo e útil. Responda dúvidas sobre o conteúdo, "
        "sugira melhorias, explique como usar a plataforma e auxilie na preparação do Life Group. "
        "Trate todo pedido de escrita, melhoria, correção, troca, remoção, acréscimo ou reestruturação como alteração concreta na folha, aplique a mudança e use action='updated'. "
        "Quando ele fizer uma pergunta, pedir opinião, explicação ou orientação sem solicitar mudança, "
        "responda sem alterar a folha e use action='answered'. Preserve rigorosamente os campos não mencionados. "
        "Quando action='updated', a mudança precisa aparecer nos campos de data, porque a interface renderiza a prévia diretamente a partir desses campos. "
        "Se alterar introdução, mantenha no máximo 9 linhas e dê ênfase aos versículos. "
        "Se alterar perguntas, mantenha exatamente quatro perguntas, com a primeira sendo exatamente: "
        "'Compartilhe conosco o que essa Palavra de domingo falou com você.'. "
        "Quando uma pergunta tiver versículo, escreva primeiro a pergunta e logo abaixo a passagem bíblica. "
        "Evite repetir nas perguntas os versículos já usados na introdução, a menos que o usuário peça isso explicitamente. "
        "Escreva os versículos entre aspas na versão NAA, completos e sem cortes quando souber o texto com segurança. "
        "Se alterar conclusão, mantenha no máximo cinco linhas e foque no título. "
        "Nunca invente que uma alteração foi feita. A resposta ao usuário deve dizer claramente se a folha foi alterada. "
        "Mantenha tom bíblico, pastoral, claro e simples. O campo data deve sempre conter a folha completa, "
        "mesmo quando nenhuma alteração for feita. Não use markdown complexo na resposta."
    )
    user_prompt = f"""
Conversa recente:
{json.dumps(safe_history, ensure_ascii=False, indent=2)}

Mensagem atual:
{message}

Folha atual:
{json.dumps(current, ensure_ascii=False, indent=2)}
""".strip()

    result = call_chatgpt_json(system_prompt, user_prompt, life_group_chat_schema(), timeout=45)
    if result is None:
        raise RuntimeError("Configure OPENAI_API_KEY para usar o assistente do chat.")
    result["data"] = normalize_editable_payload(result.get("data"))
    result["action"] = "updated" if result.get("action") == "updated" else "answered"
    result["reply"] = clean_block(result.get("reply")) or "Como posso ajudar com esta folha de estudo?"
    return result


def split_questions(value):
    value = clean_block(value)
    if not value:
        return []
    parts = re.split(r"(?:^|\n)\s*(?=\d+\)\s*)", value)
    questions = []
    for part in parts:
        item = clean_block(part)
        if item:
            questions.append(re.sub(r"^\d+\)\s*", "", item).strip())
    return questions


def biblical_references(text):
    books = (
        "Gênesis|Genesis|Êxodo|Exodo|Levítico|Levitico|Números|Numeros|Deuteronômio|Deuteronomio|"
        "Josué|Josue|Juízes|Juizes|Rute|Samuel|Reis|Crônicas|Cronicas|Esdras|Neemias|Ester|Jó|Jo|"
        "Salmos|Provérbios|Proverbios|Eclesiastes|Cantares|Isaías|Isaias|Jeremias|Lamentações|"
        "Lamentacoes|Ezequiel|Daniel|Oseias|Joel|Amós|Amos|Obadias|Jonas|Miqueias|Naum|Habacuque|"
        "Sofonias|Ageu|Zacarias|Malaquias|Mateus|Marcos|Lucas|João|Joao|Atos|Romanos|Coríntios|"
        "Corintios|Gálatas|Galatas|Efésios|Efesios|Filipenses|Colossenses|Tessalonicenses|Timóteo|"
        "Timoteo|Tito|Filemom|Hebreus|Tiago|Pedro|Judas|Apocalipse"
    )
    pattern = rf"(?:[1-3]\s*)?(?:{books})\s+\d{{1,3}}:\d{{1,3}}(?:-\d{{1,3}})?"
    refs = []
    for match in re.finditer(pattern, text, flags=re.IGNORECASE):
        ref = compact_text(match.group(0))
        if ref not in refs:
            refs.append(ref)
    return refs


def scripture_quote_for_ref(text, ref):
    escaped_ref = re.escape(ref)
    quote_chars = r"[“\"]"
    patterns = [
        rf"{escaped_ref}(?:\s+[A-Z]{{2,5}})?\)?\s*[—:-]?\s*{quote_chars}([^”\"]{{20,420}}?)[”\"]",
        rf"{quote_chars}([^”\"]{{20,420}}?)[”\"][ \t]*\(?{escaped_ref}(?:\s+[A-Z]{{2,5}})?\)?",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            quote = compact_text(match.group(1))
            if "…" in quote or "..." in quote:
                continue
            if any(marker.lower() in quote.lower() for marker in ["Nossa Missão", "Nossa Visão", "Momento ", "Perguntas:", "Conclusão:"]):
                continue
            quote_refs = [item.lower() for item in biblical_references(quote)]
            if quote_refs and ref.lower() not in quote_refs:
                continue
            if quote:
                return quote
    return ""


def scripture_fragment(text, ref):
    quote = scripture_quote_for_ref(text, ref)
    if quote:
        return f'"{normalize_scripture_quotes(quote)}" ({ref} NAA)'
    return f"({ref} NAA)"


def scripture_line(text, ref):
    quote = scripture_quote_for_ref(text, ref)
    if quote:
        return f'"{normalize_scripture_quotes(quote)}" {ref} NAA'
    return f"{ref} NAA"


def is_scripture_line(text):
    value = compact_text(text)
    if not biblical_references(value):
        return False
    return bool(
        re.match(r'^["“][^"”]{12,}["”]\s*\(?', value)
        or re.fullmatch(r"\(?[1-3]?\s*[A-Za-zÀ-ÿ]+\s+\d{1,3}:\d{1,3}(?:-\d{1,3})?\s+NAA\)?", value)
    )


def reorder_question_and_scripture(text):
    lines = [line.strip() for line in str(text or "").splitlines() if compact_text(line)]
    if len(lines) < 2:
        return normalize_scripture_version_labels(str(text or "").strip())
    scripture_lines = [line for line in lines if is_scripture_line(line)]
    question_lines = [line for line in lines if line not in scripture_lines]
    if not scripture_lines or not question_lines:
        return normalize_scripture_version_labels(str(text or "").strip())
    return normalize_scripture_version_labels("\n".join(question_lines + scripture_lines))


def normalize_scripture_version_labels(text):
    return re.sub(r"\b(?:ARC|ARA|NVI|NVT|NTLH|ACF|KJA)\b", "NAA", text or "")


def normalize_scripture_quotes(text):
    return normalize_scripture_version_labels(text).replace("“", '"').replace("”", '"')


def remove_partial_scripture_quotes(text):
    text = normalize_scripture_quotes(text)
    text = re.sub(r'\("([^"]*(?:…|\.{3})[^"]*)"\s*([^)]*?\b\d{1,3}:\d{1,3}[^)]*)\)', r"(\2)", text)
    text = re.sub(r'"([^"]*(?:…|\.{3})[^"]*)"\s*\(([^)]*?\b\d{1,3}:\d{1,3}[^)]*)\)', r"(\2)", text)
    text = re.sub(r"\b(?:declara|afirma|diz)\s*:\s*\(([^)]*?\b\d{1,3}:\d{1,3}[^)]*)\),?\s*", r"aponta para \1, ", text, flags=re.IGNORECASE)
    return normalize_text(compact_text(text))


def clean_generated_content(text):
    text = remove_partial_scripture_quotes(text)
    text = re.sub(r"Os textos bíblicos conduzem essa reflexão, especialmente .*?(?:NAA\.)", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bNAA\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕ])", "NAA. ", text)
    text = re.sub(r"\bConclu[ií]mos que\b[^.?!]{0,260}[.?!]?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bEm resumo,?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bEntão,?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bEx\.\s*", "", text)
    return normalize_text(compact_text(text))


def broken_generated_question(question):
    value = compact_text(question)
    lower = value.lower()
    if len(value) > 380:
        return True
    blocked = ["nossa missão", "nossa visão", "momento generosidade", "momento visão", "conclusão:", "esta palavra chama"]
    if any(item in lower for item in blocked):
        return True
    weak_starts = [
        "qual ponto principal mais confrontou",
        "que atitude prática deus está chamando",
        "como essa palavra muda sua forma",
        "como o grupo pode orar",
    ]
    if any(lower.startswith(item) for item in weak_starts):
        return True
    if value.count('"') % 2 != 0:
        return True
    if is_scripture_line(value):
        return True
    return False


def shallow_question(question):
    value = compact_text(question)
    lower = value.lower()
    shallow_patterns = [
        "o que essa mensagem ensina",
        "o que esse texto ensina para a vida hoje",
        "como essa palavra pode ser praticada",
        "ajuda a praticar essa palavra",
        "quais passos práticos podem ser aplicados",
        "onde essa palavra precisa aparecer",
    ]
    if any(pattern in lower for pattern in shallow_patterns):
        return True
    if len(value) < 95 and not biblical_references(value):
        return True
    return False


def question_already_has_quote_for_ref(question, ref):
    escaped_ref = re.escape(ref)
    return bool(re.search(rf"[“\"][^”\"]+[”\"]\s*\({escaped_ref}(?:\s+NAA)?\)", question, re.IGNORECASE))


def question_has_support_for_ref(question, ref):
    ref_lower = ref.lower()
    return any(is_scripture_line(line) and ref_lower in line.lower() for line in str(question or "").splitlines())


def question_with_scripture(question, source_text, refs, index):
    question = reorder_question_and_scripture(question)
    if "\n" in str(question):
        question = normalize_scripture_version_labels(str(question).strip())
    else:
        question = remove_partial_scripture_quotes(question)
    question_refs = biblical_references(question)
    if question_refs:
        additions = []
        for ref in question_refs:
            quote = scripture_quote_for_ref(source_text, ref)
            if question_has_support_for_ref(question, ref) or question_already_has_quote_for_ref(question, ref):
                continue
            if quote and quote not in question:
                additions.append(scripture_fragment(source_text, ref))
            elif not quote:
                additions.append(scripture_fragment(source_text, ref))
        if additions:
            return reorder_question_and_scripture(f"{compact_text(question)}\n" + "\n".join(additions))
        return question

    if refs:
        ref = refs[min(index, len(refs) - 1)]
        return f"Leia {ref} e responda: {compact_text(question)}\n{scripture_fragment(source_text, ref)}"

    return question


def pluralize_question(question):
    replacements = [
        (r"\bComo isso se conecta com\b", "Como nós conectamos isso com"),
        (r"\bComo isso influencia\b", "Como nós percebemos isso influenciando"),
        (r"\bO que significa, na prática,", "Como nós entendemos e vivemos, na prática,"),
        (r"\bsua vida\b", "nossa vida"),
        (r"\bseu coração\b", "nosso coração"),
        (r"\bsua família\b", "nossa família"),
        (r"\bsua rotina\b", "nossa rotina"),
        (r"\bvocê\b", "nós"),
        (r"\bVocê\b", "Nós"),
        (r"\bde você\b", "de nós"),
        (r"\bpara você\b", "para nós"),
        (r"\bcom você\b", "conosco"),
        (r"\bDeus está chamando nós\b", "Deus está nos chamando"),
        (r"\bDeus espera de nós\b", "Deus espera de nós"),
    ]
    result = question
    for pattern, replacement in replacements:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    if not re.search(r"\b(n[oó]s|nosso|nossa|conosco|aplicamos|podemos)\b", result, flags=re.IGNORECASE):
        result = f"{result} Como nós podemos aplicar essa verdade de forma prática?"
    return compact_text(result)


def simplify_group_question(question, source_text, refs, index):
    refs_in_question = biblical_references(question)
    if refs_in_question:
        ref = refs_in_question[0]
    elif refs:
        ref = refs[min(index, len(refs) - 1)]
    else:
        ref = ""

    if ref:
        verse = scripture_fragment(source_text, ref)
        simple_prompts = [
            f"Leia {ref} e responda: que verdade central esse texto revela e como essa verdade muda a forma de enxergar o tema da mensagem?\n{verse}",
            f"Leia {ref} e responda: que atitude Deus está ensinando e como isso confronta a maneira de viver, decidir e reagir às circunstâncias?\n{verse}",
            f"Leia {ref} e responda: quais passos práticos podem ser aplicados para que essa Palavra saia da teoria e se torne obediência?\n{verse}",
        ]
        return simple_prompts[index % len(simple_prompts)]

    simple_prompts = [
        "O que essa mensagem ensina para a vida hoje?",
        "Como essa Palavra pode ser praticada no dia a dia?",
        "Quais passos práticos podem ser aplicados nesta semana?",
    ]
    return simple_prompts[index % len(simple_prompts)]


def discussion_question_for_ref(text, ref, title="", index=0):
    verse = scripture_fragment(text, ref)
    prompts = [
        f"Leia {ref} e responda: que verdade central esse texto revela e como essa verdade muda a forma de enxergar o tema da mensagem?\n{verse}",
        f"Leia {ref} e responda: que atitude Deus está ensinando e como isso confronta a maneira de viver, decidir e reagir às circunstâncias?\n{verse}",
        f"Leia {ref} e responda: quais passos práticos podem ser aplicados para que essa Palavra saia da teoria e se torne obediência?\n{verse}",
    ]
    return prompts[index % len(prompts)]


def sermon_source_text(text):
    intro = section_between(
        text,
        ["Introdução", "Introducao", "Resumo"],
        ["Perguntas", "Conclusão", "Conclusao", "Momento Generosidade", "Agenda"],
    )
    return intro or text


def normalize_questions(text, questions=None):
    questions = [str(question).strip() for question in (questions or []) if compact_text(question)]
    filtered = []
    for question in questions:
        normalized = re.sub(r"^\d+\)\s*", "", question).strip()
        if is_scripture_line(normalized) and filtered:
            filtered[-1] = reorder_question_and_scripture(f"{filtered[-1]}\n{normalized}")
            continue
        if broken_generated_question(normalized):
            continue
        if normalized.lower() == FIRST_QUESTION.lower():
            continue
        if normalized.lower() == "compartilhemos o que essa palavra de domingo falou conosco.":
            continue
        if "compartilhe conosco" in normalized.lower() and "palavra" in normalized.lower():
            continue
        filtered.append(normalized)

    refs = biblical_references(text)
    title_match = re.search(r"S[ée]rie\s*:\s*[“\"]?(.+?)[”\"]?(?:\n|$)", text, re.IGNORECASE)
    title = title_match.group(1).strip() if title_match else ""
    fallback = [
        "O que essa mensagem ensina para a vida hoje?",
        "Onde essa Palavra precisa aparecer de forma prática na nossa rotina?",
        "Quais passos práticos podem ser aplicados nesta semana para viver o que foi ouvido?",
    ]
    if refs:
        fallback = [discussion_question_for_ref(text, refs[min(i, len(refs) - 1)], title, i) for i in range(3)]

    result = [FIRST_QUESTION]
    for question in filtered:
        if len(result) == 4:
            break
        if shallow_question(question):
            result.append(simplify_group_question(question, text, refs, len(result) - 1))
        else:
            result.append(question_with_scripture(question, text, refs, len(result) - 1))
    for question in fallback:
        if len(result) == 4:
            break
        if question not in result:
            result.append(question_with_scripture(question, text, refs, len(result) - 1))
    return result[:4]


def sentence_list(text):
    compact = clean_generated_content(text)
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", compact) if len(s.strip()) > 35]
    clean_sentences = []
    for sentence in sentences:
        if re.match(r"^(?:conclu[ií]mos que|em resumo|ent[aã]o)\b", sentence, re.IGNORECASE):
            continue
        if "…" in sentence or "..." in sentence:
            continue
        if sentence.count('"') % 2 != 0:
            continue
        if "os textos bíblicos conduzem" in sentence.lower():
            continue
        if "a mensagem apresenta um chamado claro" in sentence.lower():
            continue
        if "esta palavra chama cada pessoa" in sentence.lower():
            continue
        clean_sentences.append(sentence)
    return clean_sentences


def strip_generated_openers(text):
    return re.sub(
        r"^\s*(?:em resumo,?|conclu[ií]mos que,?|ent[aã]o,?)\s*",
        "",
        compact_text(text),
        flags=re.IGNORECASE,
    )


def title_keywords(title):
    words = re.findall(r"[A-Za-zÀ-ÿ]{4,}", title or "")
    ignored = {
        "série",
        "serie",
        "folha",
        "estudo",
        "life",
        "group",
        "para",
        "como",
        "sobre",
        "deus",
    }
    return [word.lower() for word in words if word.lower() not in ignored]


def sentence_score(sentence, refs, title_terms):
    lower = sentence.lower()
    score = 0
    if any(ref.lower() in lower for ref in refs):
        score += 5
    score += sum(2 for term in title_terms if term in lower)
    if any(word in lower for word in ["palavra", "jesus", "deus", "obedi", "fé", "fe", "vida", "coração", "coracao"]):
        score += 2
    if len(sentence) > 260:
        score -= 2
    return score


def select_context_sentences(text, title="", limit=4):
    source = sermon_source_text(text)
    sentences = sentence_list(source)
    refs = biblical_references(source) or biblical_references(text)
    terms = title_keywords(title)
    ranked = sorted(
        enumerate(sentences),
        key=lambda item: (-sentence_score(item[1], refs, terms), item[0]),
    )
    selected_indexes = sorted(index for index, _ in ranked[:limit])
    return [sentences[index] for index in selected_indexes], refs


def build_scripture_emphasis(text, refs, limit=2):
    parts = []
    for ref in refs[:limit]:
        quote = scripture_quote_for_ref(text, ref)
        if quote:
            parts.append(f'"{normalize_scripture_quotes(quote)}" ({ref} NAA)')
        else:
            parts.append(f"{ref} NAA")
    return parts


def clamp_intro(text, max_chars=900):
    text = compact_text(text)
    if len(text) <= max_chars:
        return text
    sentences = re.split(r"(?<=[.!?])\s+", text)
    selected = []
    for sentence in sentences:
        if len(" ".join(selected + [sentence])) > max_chars:
            break
        selected.append(sentence)
    return compact_text(" ".join(selected) or text[:max_chars].rsplit(" ", 1)[0] + ".")


def clamp_sentences(text, min_count=3, max_count=5):
    sentences = sentence_list(text)
    seen = set()
    selected = []
    for sentence in sentences:
        key = sentence.lower()
        if key in seen:
            continue
        seen.add(key)
        selected.append(sentence)
        if len(selected) == max_count:
            break
    if len(selected) < min_count:
        fillers = [
            "A Palavra nos chama a ouvir Deus com atenção e responder com obediência.",
            "A fé se torna madura quando nós transformamos entendimento em prática.",
            "Durante a semana, podemos caminhar juntos em oração, decisão e perseverança.",
        ]
        for sentence in fillers:
            if len(selected) == min_count:
                break
            selected.append(sentence)
    return " ".join(selected[:max_count])


def summarize(text, max_sentences=5):
    return summarize_with_title(text, "", max_sentences)


def summarize_with_title(text, title="", max_sentences=5):
    selected, refs = select_context_sentences(text, title, min(max_sentences, 3))
    if not selected:
        return ""

    title_part = f' em "{title}"' if title and title != "Folha de Estudo Life Group" else ""
    clean_selected = [clean_generated_content(sentence) for sentence in selected]
    intro_lines = [
        f"A mensagem{title_part} apresenta um chamado claro para transformar a Palavra em resposta prática."
    ]

    usable_refs = refs[:4] if refs else []
    if usable_refs:
        topic = title if title and title != "Folha de Estudo Life Group" else "essa Palavra"
        connectors = [
            f"{topic} começa quando o coração reconhece a voz de Deus e responde com fé.",
            "Mesmo em meio aos desafios, a Palavra mantém a fé firme e orienta as decisões.",
            "A obediência nasce quando a verdade bíblica deixa de ser apenas informação e se torna prática.",
            "Por isso, meditar nas Escrituras fortalece a confiança e conduz a uma vida alinhada com Deus.",
        ]
        for index, ref in enumerate(usable_refs):
            context = connectors[min(index, len(connectors) - 1)]
            intro_lines.append(context)
            intro_lines.append(scripture_line(text, ref))
    else:
        intro_lines.extend(clean_selected[:3])

    return normalize_scripture_version_labels("\n".join(line for line in intro_lines if compact_text(line)))


def short_conclusion(text, title=""):
    conclusion = section_between(text, ["Conclusão", "Conclusao"], [])
    source = conclusion or sermon_source_text(text)
    sentences, _ = select_context_sentences(source, title, 3)
    if not sentences:
        sentences = sentence_list(source)
    if not sentences:
        return ""
    selected = strip_generated_openers(clamp_sentences(" ".join(clean_generated_content(sentence) for sentence in sentences), 2, 4))
    title_part = f' "{title}"' if title and title != "Folha de Estudo Life Group" else "Esta Palavra"
    return normalize_scripture_quotes(compact_text(f"{title_part} chama cada pessoa a responder com fé, obediência e prática diária. {selected}"))


def infer_questions(text):
    questions = split_questions(
        section_between(text, ["Perguntas"], ["Conclusão", "Conclusao"])
    )
    if questions:
        return normalize_questions(text, questions)

    summary = summarize(text, 4)
    if biblical_references(text):
        return normalize_questions(text, [])

    base = [
        FIRST_QUESTION,
        "Qual ponto principal mais confrontou ou encorajou sua vida?",
        "Que atitude prática Deus está chamando você a tomar nesta semana?",
        "Como o grupo pode orar e caminhar com você nessa decisão?",
    ]
    if "família" in text.lower() or "familia" in text.lower():
        base.insert(3, "Como essa Palavra pode fortalecer sua família e seus relacionamentos?")
    if "prosper" in text.lower() or "financ" in text.lower():
        base.insert(3, "Como essa Palavra muda sua forma de lidar com recursos e preocupações?")
    if summary:
        return normalize_questions(text, base)
    return normalize_questions(text, base[:3])


def parse_pdf_text(text):
    title_match = re.search(r"S[ée]rie\s*:\s*[“\"]?(.+?)[”\"]?(?:\n|$)", text, re.IGNORECASE)
    meta_match = re.search(r"(Culto Presencial[^\n]+)", text, re.IGNORECASE)
    date_match = re.search(r"Data\s*:\s*([0-9./-]+)", text, re.IGNORECASE)
    pastor_match = re.search(r"Pastor(?:a)?\s+([^/\n]+)", text, re.IGNORECASE)

    generosidade = section_between(
        text,
        ["Momento Generosidade"],
        [
            "Agenda",
            "Momento Visão e Missão Paz Church",
            "Momento Visao e Missao Paz Church",
            "Introdução",
            "Introducao",
        ],
    )
    avisos = section_between(
        text,
        ["Agenda", "Avisos"],
        [
            "Momento Visão e Missão Paz Church",
            "Momento Visao e Missao Paz Church",
            "Introdução",
            "Introducao",
        ],
    )
    visao = section_between(
        text,
        ["Momento Visão e Missão Paz Church", "Momento Visao e Missao Paz Church"],
        ["Introdução", "Introducao", "Perguntas"],
    )
    title = title_match.group(1).strip() if title_match else "Folha de Estudo Life Group"
    subtitle = meta_match.group(1).strip() if meta_match else "Culto Presencial e On-Line / Life Group"
    chatgpt_payload = generate_life_group_with_chatgpt(text, title, subtitle)
    resumo = (chatgpt_payload or {}).get("resumo") or summarize_with_title(text, title)
    conclusao = (chatgpt_payload or {}).get("conclusao") or short_conclusion(text, title)
    perguntas = (chatgpt_payload or {}).get("perguntas") or infer_questions(text)

    return {
        "titulo": (chatgpt_payload or {}).get("titulo") or title,
        "subtitulo": (chatgpt_payload or {}).get("subtitulo") or subtitle,
        "data": date_match.group(1).strip() if date_match else "",
        "pastor": pastor_match.group(1).strip() if pastor_match else "",
        "momentoGenerosidade": generosidade or DEFAULT_GENEROSIDADE,
        "avisos": avisos or DEFAULT_AVISOS,
        "momentoVisao": visao or DEFAULT_VISAO,
        "resumo": resumo or "Resumo da mensagem extraído a partir do PDF enviado.",
        "perguntas": perguntas,
        "conclusao": conclusao or "Que esta Palavra gere fé, prática e compromisso com Deus durante a semana.",
        "textoExtraido": text,
    }


def parse_multipart_file(body, content_type):
    boundary_match = re.search(r"boundary=(.+)", content_type)
    if not boundary_match:
        raise ValueError("Envie um arquivo PDF pelo formulário.")
    boundary = boundary_match.group(1).strip().strip('"').encode()
    fields = {}
    file_result = None
    for part in body.split(b"--" + boundary):
        if b"Content-Disposition" not in part or b"filename=" not in part:
            if b"Content-Disposition" in part and b'name="' in part:
                header, _, payload = part.partition(b"\r\n\r\n")
                name_match = re.search(rb'name="([^"]+)"', header)
                if name_match:
                    name = name_match.group(1).decode("utf-8", "ignore")
                    value = payload.rsplit(b"\r\n", 1)[0].decode("utf-8", "ignore")
                    fields[name] = value
            continue
        header, _, payload = part.partition(b"\r\n\r\n")
        if not payload:
            continue
        payload = payload.rsplit(b"\r\n", 1)[0]
        name_match = re.search(rb'filename="([^"]+)"', header)
        filename = name_match.group(1).decode("utf-8", "ignore") if name_match else "arquivo.pdf"
        file_result = (filename, payload)
    if file_result:
        return file_result[0], file_result[1], fields
    raise ValueError("Não encontrei um arquivo no envio.")


def normalize_pdf_chars(text):
    return (
        str(text or "")
        .replace("\u00a0", " ")
        .replace("\u2010", "-")
        .replace("\u2011", "-")
        .replace("\u2012", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u2212", "-")
        .replace("\u2022", "-")
        .replace("\u25cf", "-")
        .replace("\u25a0", "-")
    )


def paragraph(text, style):
    escaped = (
        normalize_pdf_chars(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )
    return Paragraph(escaped, style)


def labeled_paragraph(label, text, style):
    escaped_label = str(label or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    escaped_text = (
        normalize_pdf_chars(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )
    return Paragraph(f"<b>{escaped_label}:</b> {escaped_text}", style)


def compact_text(text):
    return re.sub(r"\s+", " ", normalize_pdf_chars(text)).strip()


def escape_pdf_text(text):
    lines = normalize_pdf_chars(text).splitlines() or [""]
    escaped_lines = []
    for line in lines:
        escaped_lines.append(
            compact_text(line)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
    return "<br/>".join(line for line in escaped_lines if line)


def bold_underline(text, bold_font):
    return f'<font name="{bold_font}"><u>{text}</u></font>'


def highlight_required_terms(markup, bold_font):
    markup = re.sub(
        r"\bNossa Missão:?",
        lambda match: bold_underline(match.group(0), bold_font),
        markup,
    )
    markup = re.sub(
        r"\bNossa Visão:?",
        lambda match: bold_underline(match.group(0), bold_font),
        markup,
    )
    return markup


def italicize_quoted_scripture(markup):
    return re.sub(
        r"([“\"])([^”\"]{12,900})([”\"])(\s*\([^)]*\b(?:NAA|NVI|ARA|ARC)\))?",
        lambda match: f'<i>"{match.group(2)}"</i>{match.group(4) or ""}',
        markup,
    )


def italicize_scripture_lines(markup):
    lines = str(markup or "").split("<br/>")
    formatted = []
    for line in lines:
        plain = re.sub(r"<[^>]+>", "", line).strip()
        is_scripture_line = biblical_references(plain) and (
            plain.startswith('"') or re.fullmatch(r"(?:[1-3]\s*)?[A-Za-zÀ-ÿ]+\s+\d{1,3}:\d{1,3}(?:-\d{1,3})?\s+NAA", plain)
        )
        formatted.append(f"<i>{line}</i>" if is_scripture_line else line)
    return "<br/>".join(formatted)


def agenda_lines(value):
    lines = [compact_text(line) for line in str(value or "").splitlines()]
    lines = [line for line in lines if line]
    return [line for line in lines if line.lower() != "paz church"]


def bullet_paragraph(label, text, style, bold_font):
    escaped_label = str(label or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    quoted_text = italicize_scripture_lines(italicize_quoted_scripture(escape_pdf_text(text)))
    highlighted_text = highlight_required_terms(quoted_text, bold_font)
    return Paragraph(f'{bold_underline(f"- {escaped_label}:", bold_font)} {highlighted_text}', style)


def plain_bullet(text, style):
    escaped_text = escape_pdf_text(text)
    if escaped_text.startswith("-"):
        return Paragraph(escaped_text, style)
    return Paragraph(f"- {escaped_text}", style)


def formatted_paragraph_text(text):
    return italicize_scripture_lines(italicize_quoted_scripture(escape_pdf_text(text)))


def agenda_box(lines, doc_width, styles):
    content = [Paragraph("<b>Agenda: Paz Church</b>", styles["center"])]
    content.extend(plain_bullet(line, styles["agenda"]) for line in lines)
    table = Table([[content]], colWidths=[doc_width])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f1f3f5")),
                ("BOX", (0, 0), (-1, -1), 0, colors.HexColor("#f1f3f5")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def document_styles():
    base = getSampleStyleSheet()
    regular_font, bold_font = register_document_fonts()
    body_size = 10.5
    body_leading = 12.8
    styles = {
        "title": ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName=bold_font,
            fontSize=10.5,
            leading=12.8,
            alignment=TA_CENTER,
            spaceAfter=14.2,
        ),
        "meta": ParagraphStyle(
            "Meta",
            parent=base["Normal"],
            fontName=regular_font,
            fontSize=body_size,
            leading=body_leading,
            alignment=TA_LEFT,
            spaceAfter=13.2,
        ),
        "section": ParagraphStyle(
            "Section",
            parent=base["Normal"],
            fontName=bold_font,
            fontSize=body_size,
            leading=body_leading,
            alignment=TA_LEFT,
            textColor=colors.black,
            spaceAfter=8,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["Normal"],
            fontName=regular_font,
            fontSize=body_size,
            leading=body_leading,
            alignment=TA_JUSTIFY,
            spaceAfter=9,
        ),
        "agenda": ParagraphStyle(
            "Agenda",
            parent=base["Normal"],
            fontName=regular_font,
            fontSize=body_size,
            leading=body_leading,
            alignment=TA_LEFT,
            spaceAfter=2,
        ),
        "center": ParagraphStyle(
            "Center",
            parent=base["Normal"],
            fontName=bold_font,
            fontSize=body_size,
            leading=body_leading,
            alignment=TA_CENTER,
            spaceAfter=2,
        ),
        "question": ParagraphStyle(
            "Question",
            parent=base["Normal"],
            fontName=regular_font,
            fontSize=body_size,
            leading=body_leading,
            alignment=TA_LEFT,
            leftIndent=0,
            firstLineIndent=0,
            spaceAfter=10,
        ),
    }
    return styles, regular_font, bold_font


def make_doc(output_path, title):
    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        rightMargin=2.0 * cm,
        leftMargin=2.0 * cm,
        topMargin=HEADER_HEIGHT + 0.42 * cm,
        bottomMargin=1.3 * cm,
        title=title,
    )
    return doc


def build_life_group_pdf(data, output_path):
    doc = make_doc(output_path, data.get("titulo", "Folha de Estudo Life Group"))
    styles, regular_font, bold_font = document_styles()

    source_for_questions = "\n".join(
        normalize_pdf_chars(data.get(key, "")).strip()
        for key in ("textoExtraido", "resumo")
    )
    final_questions = normalize_questions(source_for_questions, data.get("perguntas") or [])

    story = [
        paragraph(f'Série: “{data.get("titulo", "Folha de Estudo Life Group")}”', styles["title"]),
        paragraph(data.get("subtitulo") or "Culto Presencial e On-Line / Life Group", styles["meta"]),
    ]

    story.append(bullet_paragraph("Momento Generosidade", data.get("momentoGenerosidade"), styles["body"], bold_font))
    story.append(agenda_box(agenda_lines(data.get("avisos")), doc.width, styles))

    story.append(Spacer(1, 6))
    story.append(bullet_paragraph("Momento Visão e Missão Paz Church", data.get("momentoVisao"), styles["body"], bold_font))
    story.append(bullet_paragraph("Introdução", data.get("resumo"), styles["body"], bold_font))

    story.append(Paragraph("<b>- Perguntas:</b>", styles["section"]))
    for index, question in enumerate(final_questions, start=1):
        story.append(Paragraph(f"{index}) {formatted_paragraph_text(question)}", styles["question"]))

    story.append(bullet_paragraph("Conclusão", data.get("conclusao"), styles["body"], bold_font))
    doc.build(story, onFirstPage=draw_life_group_header, onLaterPages=draw_life_group_header)


def build_pdf(data, output_path):
    data["tipo"] = "life_group"
    build_life_group_pdf(data, output_path)


def word_escape(text):
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def word_text_runs(text):
    lines = str(text or "").splitlines() or [""]
    parts = []
    for index, line in enumerate(lines):
        if index:
            parts.append("<w:br/>")
        parts.append(f'<w:t xml:space="preserve">{word_escape(line)}</w:t>')
    return "".join(parts)


def word_paragraph(text="", style=None, bold=False):
    p_style = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    bold_xml = "<w:b/>" if bold else ""
    return f"<w:p>{p_style}<w:r><w:rPr>{bold_xml}</w:rPr>{word_text_runs(text)}</w:r></w:p>"


def split_word_paragraphs(text):
    blocks = [clean_block(block) for block in re.split(r"\n{2,}", str(text or ""))]
    if len(blocks) == 1:
        blocks = [line.strip() for line in str(text or "").splitlines()]
    return [block for block in blocks if compact_text(block)]


def word_section(label, text):
    blocks = [word_paragraph(f"- {label}:", "Heading2")]
    for paragraph_text in split_word_paragraphs(text):
        blocks.append(word_paragraph(paragraph_text))
    return blocks


def docx_document_xml(data):
    data["tipo"] = "life_group"
    title = data.get("titulo") or "Folha de Estudo Life Group"
    subtitle = data.get("subtitulo") or ""
    body = [
        word_paragraph("Estudo Life Group", "Title"),
        word_paragraph(title, "Heading1"),
    ]
    if subtitle:
        body.append(word_paragraph(subtitle, "Subtitle"))

    source_for_questions = "\n".join(normalize_pdf_chars(data.get(key, "")).strip() for key in ("textoExtraido", "resumo"))
    final_questions = normalize_questions(source_for_questions, data.get("perguntas") or [])
    body.extend(word_section("Momento Generosidade", data.get("momentoGenerosidade")))
    body.extend(word_section("Avisos / Agenda", data.get("avisos")))
    body.extend(word_section("Momento Visão e Missão Paz Church", data.get("momentoVisao")))
    body.extend(word_section("Introdução", data.get("resumo")))
    body.append(word_paragraph("- Perguntas:", "Heading2"))
    for index, question in enumerate(final_questions, start=1):
        body.append(word_paragraph(f"{index}) {question}"))
    body.extend(word_section("Conclusão", data.get("conclusao")))

    section = (
        "<w:sectPr>"
        '<w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
        "</w:sectPr>"
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{''.join(body)}{section}</w:body>"
        "</w:document>"
    )


def docx_styles_xml():
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr>
    <w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="183A64"/><w:sz w:val="34"/></w:rPr>
    <w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="183A64"/><w:sz w:val="28"/></w:rPr>
    <w:pPr><w:spacing w:before="120" w:after="180"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:u w:val="single"/><w:sz w:val="22"/></w:rPr>
    <w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="5F6F82"/><w:sz w:val="22"/></w:rPr>
    <w:pPr><w:spacing w:after="220"/></w:pPr>
  </w:style>
</w:styles>"""


def build_word(data, output_path):
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
    document_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"""
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", content_types)
        docx.writestr("_rels/.rels", rels)
        docx.writestr("word/_rels/document.xml.rels", document_rels)
        docx.writestr("word/styles.xml", docx_styles_xml())
        docx.writestr("word/document.xml", docx_document_xml(data))


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parsed = urlparse(path)
        if parsed.path == "/":
            return str(STATIC_DIR / "index.html")
        return str(STATIC_DIR / parsed.path.lstrip("/"))

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            if self.path == "/api/extract":
                length = int(self.headers.get("Content-Length", "0"))
                filename, payload, fields = parse_multipart_file(
                    self.rfile.read(length),
                    self.headers.get("Content-Type", ""),
                )
                suffix = Path(filename).suffix.lower()
                if suffix not in {".pdf", ".docx", ".doc", ".rtf", ".odt"}:
                    raise ValueError("Envie um arquivo PDF, DOCX, DOC, RTF ou ODT.")
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp:
                    temp.write(payload)
                    temp_path = Path(temp.name)
                try:
                    text = extract_text_from_document(temp_path, filename)
                    payload = parse_pdf_text(text)
                    payload["tipo"] = "life_group"
                    self.send_json(payload)
                finally:
                    temp_path.unlink(missing_ok=True)
                return

            if self.path == "/api/revise":
                length = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                payload = assist_life_group_with_chatgpt(
                    data.get("data") or {},
                    data.get("message") or data.get("instruction") or "",
                    data.get("history") or [],
                )
                self.send_json(payload)
                return

            if self.path == "/api/pdf":
                length = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temp:
                    output_path = Path(temp.name)
                try:
                    build_pdf(data, output_path)
                    pdf = output_path.read_bytes()
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Disposition", 'attachment; filename="folha-de-estudo-life-group.pdf"')
                    self.send_header("Content-Length", str(len(pdf)))
                    self.end_headers()
                    self.wfile.write(pdf)
                finally:
                    output_path.unlink(missing_ok=True)
                return

            if self.path == "/api/word":
                length = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as temp:
                    output_path = Path(temp.name)
                try:
                    build_word(data, output_path)
                    docx = output_path.read_bytes()
                    filename = "folha-de-estudo-life-group.docx"
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
                    self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                    self.send_header("Content-Length", str(len(docx)))
                    self.end_headers()
                    self.wfile.write(docx)
                finally:
                    output_path.unlink(missing_ok=True)
                return

            self.send_error(HTTPStatus.NOT_FOUND)
        except Exception as exc:
            self.send_json({"erro": str(exc)}, HTTPStatus.BAD_REQUEST)


def main():
    port = int(os.environ.get("PORT", "8787"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Plataforma disponível em http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()

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


def draw_tadel_header(canvas, doc):
    draw_document_header(canvas, doc, "Resumo TADEL")


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


def generate_life_group_with_chatgpt(text, title="", subtitle=""):
    system_prompt = (
        "Você é um editor pastoral da PAZ Church. Gere uma Folha de Estudo Life Group em português do Brasil, "
        "com escrita clara, bíblica, pastoral e simples para pequenos grupos nas casas. "
        "Escreva no estilo devocional do exemplo: uma frase pastoral que explica a ideia, depois o versículo em uma linha separada. "
        "Não use frases genéricas como 'o texto bíblico principal mostra' ou 'essa perspectiva fortalece'; escreva o conteúdo da mensagem. "
        "As perguntas devem ser específicas ao tema e ao versículo, com o versículo logo abaixo. "
        "Use apenas referências bíblicas presentes no texto enviado. Quando escrever versículos, use NAA, em texto completo quando possível, "
        "sem reticências e sem cortes. Se o texto não trouxer o versículo completo, use só a referência, sem inventar conteúdo. "
        "Não inclua markdown, títulos de seção, numeração externa ou explicações fora dos campos JSON."
    )
    user_prompt = f"""
Título detectado: {title or "não informado"}
Subtítulo detectado: {subtitle or "não informado"}

Regras da folha:
- A introdução deve ser clara, coesa e pastoral, no estilo do exemplo do usuário.
- Na introdução, escreva entre 3 e 5 pequenos blocos. Cada bloco deve ter uma ideia pastoral e, quando houver versículo, o versículo em uma linha separada logo abaixo.
- A introdução deve falar do assunto do PDF, não apenas listar versículos.
- Use os versículos principais do documento, em especial os primeiros que aparecem.
- As perguntas devem ser simples, boas para discussão em grupo, específicas ao assunto do PDF e usando os versículos como apoio.
- Gere exatamente 4 perguntas.
- A primeira pergunta deve ser: Compartilhe conosco o que essa Palavra de domingo falou com você.
- Nas perguntas 2 a 4, escreva a pergunta e na linha seguinte o versículo de apoio.
- A conclusão deve ter no mínimo 3 linhas e no máximo 5 linhas, sem começar com "Concluímos que", "Em resumo" ou "Então".

Texto extraído do arquivo:
{truncate_for_model(text)}
""".strip()
    return call_chatgpt_json(system_prompt, user_prompt, life_group_schema())


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
        rf"{quote_chars}([^”\"]{{20,420}}?)[”\"]\s*\(?{escaped_ref}(?:\s+[A-Z]{{2,5}})?\)?",
        rf"{escaped_ref}(?:\s+[A-Z]{{2,5}})?\)?\s*[—:-]?\s*{quote_chars}([^”\"]{{20,420}}?)[”\"]",
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
        return f' "{quote}" ({ref} NAA)'
    return f" ({ref})"


def scripture_line(text, ref):
    quote = scripture_quote_for_ref(text, ref)
    if quote:
        return f'"{normalize_scripture_quotes(quote)}" {ref} NAA'
    return f"{ref} NAA"


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
    return False


def question_already_has_quote_for_ref(question, ref):
    escaped_ref = re.escape(ref)
    return bool(re.search(rf"[“\"][^”\"]+[”\"]\s*\({escaped_ref}(?:\s+NAA)?\)", question, re.IGNORECASE))


def question_with_scripture(question, source_text, refs, index):
    if "\n" in str(question):
        question = normalize_scripture_version_labels(str(question).strip())
    else:
        question = remove_partial_scripture_quotes(question)
    question_refs = biblical_references(question)
    if question_refs:
        additions = []
        for ref in question_refs:
            quote = scripture_quote_for_ref(source_text, ref)
            if quote and quote not in question and not question_already_has_quote_for_ref(question, ref):
                additions.append(scripture_fragment(source_text, ref))
        if additions:
            return compact_text(f"{question} {' '.join(additions)}")
        return question

    if refs:
        ref = refs[min(index, len(refs) - 1)]
        return compact_text(f"{question}{scripture_fragment(source_text, ref)}")

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
        verse = scripture_line(source_text, ref)
        simple_prompts = [
            f"Segundo {ref}, qual verdade Deus está destacando nessa mensagem?\n{verse}",
            f"Como essa verdade de {ref} pode ser vivida de forma prática no dia a dia?\n{verse}",
            f"Quais passos práticos podem ser aplicados a partir do que Deus ensina em {ref}?\n{verse}",
        ]
        return simple_prompts[index % len(simple_prompts)]

    simple_prompts = [
        "O que essa mensagem ensina para a vida hoje?",
        "Como essa Palavra pode ser praticada no dia a dia?",
        "Quais passos práticos podem ser aplicados nesta semana?",
    ]
    return simple_prompts[index % len(simple_prompts)]


def discussion_question_for_ref(text, ref, title="", index=0):
    verse = scripture_line(text, ref)
    prompts = [
        f"Segundo {ref}, qual verdade Deus está destacando nessa mensagem?\n{verse}",
        f"Como essa verdade de {ref} pode ser vivida de forma prática no dia a dia?\n{verse}",
        f"Quais passos práticos podem ser aplicados a partir do que Deus ensina em {ref}?\n{verse}",
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
        result.append(simplify_group_question(question, text, refs, len(result) - 1))
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


def parse_tadel_text(text):
    date_match = re.search(r"Data\s*:\s*([0-9./_-]+)", text, re.IGNORECASE)
    clean = text.strip()
    raw_lines = clean.splitlines()
    nonempty = [(index, line.strip()) for index, line in enumerate(raw_lines) if line.strip()]
    title = "Resumo TADEL"

    title_index = None
    for index, line in nonempty:
        if re.match(r"Data\s*:", line, flags=re.IGNORECASE):
            continue
        title = line
        title_index = index
        break

    body_text = "\n".join(raw_lines[(title_index or 0) + 1 :]).strip()
    conclusion = section_between(body_text, ["Conclusão", "Conclusao"], [])
    if conclusion:
        body_text = re.sub(
            r"(?:^|\n)\s*Conclus[ãa]o\s*:?\s*.*\Z",
            "",
            body_text,
            flags=re.IGNORECASE | re.DOTALL,
        ).strip()

    return {
        "tipo": "tadel",
        "titulo": title,
        "subtitulo": f"Data: {date_match.group(1).strip()}" if date_match else "",
        "data": date_match.group(1).strip() if date_match else "",
        "momentoGenerosidade": "",
        "avisos": "",
        "momentoVisao": "",
        "resumo": body_text or summarize(text, 8),
        "perguntas": [],
        "conclusao": conclusion or "",
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


def paragraph(text, style):
    escaped = (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )
    return Paragraph(escaped, style)


def labeled_paragraph(label, text, style):
    escaped_label = str(label or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    escaped_text = (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )
    return Paragraph(f"<b>{escaped_label}:</b> {escaped_text}", style)


def compact_text(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()


def escape_pdf_text(text):
    lines = str(text or "").splitlines() or [""]
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


def tadel_paragraphs(text):
    lines = [line.rstrip() for line in str(text or "").splitlines()]
    blocks = []
    current = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if current:
                blocks.append(" ".join(current).strip())
                current = []
            continue
        if re.match(r"^\d+\s*[-.]\s+", stripped) or stripped.startswith("●"):
            if current:
                blocks.append(" ".join(current).strip())
            blocks.append(stripped)
            current = []
        else:
            current.append(stripped)
    if current:
        blocks.append(" ".join(current).strip())
    return [block for block in blocks if block]


def tadel_block(block, styles, bold_font):
    escaped = escape_pdf_text(block)
    escaped = re.sub(
        r"^(Texto base:)",
        lambda match: bold_underline(match.group(1), bold_font),
        escaped,
        flags=re.IGNORECASE,
    )
    if re.match(r"^\d+\s*[-.]\s+", block):
        return Paragraph(bold_underline(escaped, bold_font), styles["body"])
    if block.startswith("●"):
        return Paragraph(escaped, styles["body"])
    return Paragraph(escaped, styles["body"])


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

    source_for_questions = " ".join(
        compact_text(data.get(key, ""))
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


def build_tadel_pdf(data, output_path):
    doc = make_doc(output_path, data.get("titulo", "Resumo TADEL"))
    styles, regular_font, bold_font = document_styles()
    story = [
        paragraph(data.get("subtitulo") or "", styles["meta"]),
        paragraph(data.get("titulo") or "Resumo TADEL", styles["title"]),
    ]

    for block in tadel_paragraphs(data.get("resumo")):
        story.append(tadel_block(block, styles, bold_font))

    if compact_text(data.get("conclusao")):
        story.append(Paragraph(bold_underline("Conclusão", bold_font), styles["section"]))
        story.append(Paragraph(escape_pdf_text(data.get("conclusao")), styles["body"]))

    doc.build(story, onFirstPage=draw_tadel_header, onLaterPages=draw_tadel_header)


def build_pdf(data, output_path):
    if data.get("tipo") == "tadel":
        build_tadel_pdf(data, output_path)
    else:
        build_life_group_pdf(data, output_path)


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
                    if fields.get("tipo") == "tadel":
                        self.send_json(parse_tadel_text(text))
                    else:
                        payload = parse_pdf_text(text)
                        payload["tipo"] = "life_group"
                        self.send_json(payload)
                finally:
                    temp_path.unlink(missing_ok=True)
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

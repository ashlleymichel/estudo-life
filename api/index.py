import json
import sys
import tempfile
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server import (  # noqa: E402
    build_pdf,
    build_word,
    delete_shared_file,
    extract_text_from_document,
    list_saved_files,
    parse_multipart_file,
    parse_pdf_text,
    save_shared_file,
)
from urllib.parse import parse_qs, urlparse


class handler(BaseHTTPRequestHandler):
    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        try:
            if self.path.startswith("/api/saved"):
                self.send_json({"arquivos": list_saved_files()})
                return
            self.send_error(HTTPStatus.NOT_FOUND)
        except Exception as exc:
            self.send_json({"erro": str(exc)}, HTTPStatus.BAD_REQUEST)

    def do_POST(self):
        try:
            if self.path.startswith("/api/saved"):
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                self.send_json(save_shared_file(payload))
                return

            if self.path.startswith("/api/extract"):
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
                    data = parse_pdf_text(text)
                    data["tipo"] = "life_group"
                    self.send_json(data)
                finally:
                    temp_path.unlink(missing_ok=True)
                return

            if self.path.startswith("/api/pdf"):
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

            if self.path.startswith("/api/word"):
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

    def do_DELETE(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path != "/api/saved":
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            file_id = parse_qs(parsed.query).get("id", [""])[0]
            if not file_id:
                raise ValueError("Arquivo não informado.")
            delete_shared_file(file_id)
            self.send_json({"ok": True})
        except Exception as exc:
            self.send_json({"erro": str(exc)}, HTTPStatus.BAD_REQUEST)

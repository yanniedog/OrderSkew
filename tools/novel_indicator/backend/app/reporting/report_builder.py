from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from xhtml2pdf import pisa

from app.core.schemas import ReportArtifact, ResultSummary
from app.data.storage import ArtifactStore


class ReportBuilder:
    def __init__(self, store: ArtifactStore) -> None:
        self.store = store
        template_dir = Path(__file__).resolve().parent / "templates"
        self.env = Environment(
            loader=FileSystemLoader(str(template_dir)),
            autoescape=select_autoescape(["html", "xml"]),
        )

    def build(self, run_id: str, summary: ResultSummary) -> ReportArtifact:
        template = self.env.get_template("report.html.j2")
        html = template.render(
            run_id=run_id,
            generated_at=datetime.now(timezone.utc).isoformat(),
            universal=summary.universal_recommendation.model_dump(),
            per_asset=[r.model_dump() for r in summary.per_asset_recommendations],
        )

        report_dir = self.store.report_dir(run_id)
        html_path = report_dir / "report.html"
        pdf_path = report_dir / "report.pdf"

        html_path.write_text(html, encoding="utf-8")

        with pdf_path.open("wb") as f:
            pisa.CreatePDF(src=html, dest=f)

        return ReportArtifact(run_id=run_id, html_path=str(html_path), pdf_path=str(pdf_path))

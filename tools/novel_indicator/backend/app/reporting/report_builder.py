from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from statistics import mean

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
        per_asset = [r.model_dump() for r in summary.per_asset_recommendations]
        avg_error = mean([row["score"]["composite_error"] for row in per_asset]) if per_asset else 0.0
        avg_calibration = mean([row["score"].get("calibration_error", 0.0) for row in per_asset]) if per_asset else 0.0
        avg_hit = mean([row["score"]["directional_hit_rate"] for row in per_asset]) if per_asset else 0.0
        avg_pnl = mean([row["score"]["pnl_total"] for row in per_asset]) if per_asset else 0.0
        positive_ratio = (
            sum(1 for row in per_asset if row["score"]["pnl_total"] > 0) / len(per_asset) if per_asset else 0.0
        )
        warnings: list[str] = []
        if avg_hit < 0.52:
            warnings.append("Directional hit rate is below robust threshold (52%).")
        if avg_pnl <= 0:
            warnings.append("Average post-cost PnL is non-positive.")
        if avg_error > 1.2:
            warnings.append("Composite error remains elevated.")
        html = template.render(
            run_id=run_id,
            generated_at=datetime.now(timezone.utc).isoformat(),
            universal=summary.universal_recommendation.model_dump(),
            per_asset=per_asset,
            insights={
                "avg_error": avg_error,
                "avg_calibration_error": avg_calibration,
                "avg_hit": avg_hit,
                "avg_pnl": avg_pnl,
                "positive_ratio": positive_ratio,
                "warnings": warnings,
            },
            validation=summary.validation_report.model_dump() if summary.validation_report else None,
        )

        report_dir = self.store.report_dir(run_id)
        html_path = report_dir / "report.html"
        pdf_path = report_dir / "report.pdf"

        html_path.write_text(html, encoding="utf-8")

        with pdf_path.open("wb") as f:
            pisa.CreatePDF(src=html, dest=f)

        return ReportArtifact(run_id=run_id, html_path=str(html_path), pdf_path=str(pdf_path))

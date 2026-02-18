from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.core.schemas import PineBundle, PineFile, ResultSummary
from app.data.storage import ArtifactStore
from app.research.search.optimizer import SearchOutcome


@dataclass
class PineExporter:
    store: ArtifactStore

    def export(
        self,
        run_id: str,
        summary: ResultSummary,
        outcomes: list[SearchOutcome],
        top_n: int = 3,
        expression_to_pine_override: dict[str, str] | None = None,
    ) -> PineBundle:
        export_dir = self.store.export_dir(run_id)
        expression_to_pine: dict[str, str] = dict(expression_to_pine_override or {})

        for outcome in outcomes:
            for cand in outcome.best_combo:
                expression_to_pine[cand.expression()] = cand.root.to_pine()
            for cand, _ in outcome.best_candidates:
                expression_to_pine[cand.expression()] = cand.root.to_pine()

        files: list[PineFile] = []

        universal_path = export_dir / "universal_indicator.pine"
        universal_code = self._build_script(
            title="Novel Indicator Universal",
            combo=summary.universal_recommendation.indicator_combo,
            expression_to_pine=expression_to_pine,
        )
        universal_path.write_text(universal_code, encoding="utf-8")
        files.append(PineFile(name=universal_path.name, path=str(universal_path)))

        for rec in summary.per_asset_recommendations[:top_n]:
            name = f"{rec.symbol}_{rec.timeframe}_indicator.pine".replace("|", "_")
            path = export_dir / name
            code = self._build_script(
                title=f"Novel Indicator {rec.symbol} {rec.timeframe}",
                combo=rec.indicator_combo,
                expression_to_pine=expression_to_pine,
            )
            path.write_text(code, encoding="utf-8")
            files.append(PineFile(name=path.name, path=str(path)))

        return PineBundle(run_id=run_id, files=files)

    def _build_script(self, title: str, combo, expression_to_pine: dict[str, str]) -> str:
        lines: list[str] = []
        lines.append("//@version=6")
        lines.append(f'indicator("{title}", overlay=false, max_lines_count=500, max_labels_count=500)')
        lines.append("threshold = input.float(0.001, \"Signal Threshold\", step=0.0001)")

        series_names: list[str] = []
        for i, spec in enumerate(combo):
            expr = expression_to_pine.get(spec.expression, "close")
            name = f"f{i+1}"
            series_names.append(name)
            lines.append(f"{name} = {expr}")
            lines.append(f"{name}_z = ({name} - ta.sma({name}, 34)) / (ta.stdev({name}, 34) + 1e-9)")
            lines.append(f"plot({name}_z, title=\"{spec.indicator_id}\", linewidth=1)")

        if series_names:
            avg = " + ".join([f"{n}_z" for n in series_names])
            lines.append(f"composite = ({avg}) / {len(series_names)}")
        else:
            lines.append("composite = 0.0")

        lines.append("signal = composite > threshold ? 1 : composite < -threshold ? -1 : 0")
        lines.append('plot(composite, title="Composite", color=color.new(color.blue, 0), linewidth=2)')
        lines.append('plot(signal, title="Signal", color=color.new(color.orange, 0), style=plot.style_stepline)')

        return "\n".join(lines) + "\n"

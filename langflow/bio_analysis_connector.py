"""GenePilot — Bio Analysis Connector (Langflow custom component).

Why this exists
---------------
The hand-built Sequence Analysis Flow reaches the Bio service through a chain of
Parser -> Data Operations -> API Request nodes. That chain is the fragile part:
the request body is assembled by wiring several Data Operations nodes together,
the API Request runs in ``mode = URL`` with an empty static body, and the tools
to run are reverse-engineered from a planner LLM's JSON. Every one of those steps
is a place where the call can silently produce the wrong body and the result
comes back empty.

This component collapses all of it into one node:

    Chat Input  ─┐
                 ├─> Bio Analysis Connector ─> Chat Output
    Webhook    ──┘

It reads the incoming request, decides which Bio tools to run, calls the Bio
service's ``POST /analyze`` exactly the way the backend's Bio fallback does, and
returns both the raw results (``Analysis Results``, a ``Data``) and the
Insight-Analyst-shaped JSON (``Insight Input``, a ``Message``).

Two ways to reach it
--------------------
Langflow exposes two run paths and they behave very differently:

* ``POST /api/v1/run/{flow_id}`` — **synchronous**. Executes the graph and
  returns ``{"outputs": [...]}`` in the same response. This is what a backend
  job should call. The incoming ``input_value`` is injected into the ``Chat
  Input`` component; per-request fields (here, ``analysis_type``) are passed in
  ``tweaks``, keyed by this component's id or display name.
* ``POST /api/v1/webhook/{flow_id}`` — **asynchronous by design**. It only
  acknowledges that the run started (``202`` ``{"message": "Task started in the
  background"}``) and never returns the flow's output. The Webhook input is
  still wired here so the same flow can be triggered fire-and-forget, but a
  caller that needs the result MUST use ``/run``.

Contract with the backend
-------------------------
``back/src/lib/langflow-executor.ts`` calls ``/api/v1/run/{flow_id}`` with::

    {
      "input_value": "<sequence text>",
      "input_type": "chat",
      "output_type": "chat",
      "session_id": "<sequence id>",
      "tweaks": { "<this component>": { "analysis_type": "gc_content" } }
    }

and collects every string found under a ``text``/``message``/``result`` key in
the response's ``outputs``. The ``Insight Input`` output is a ``Message`` whose
text is a JSON document, so it is collected as-is. If you want the Insight
Analyst LLM in front of it, feed ``Insight Input`` into the LLM's ``input_value``;
the LLM's system prompt already expects ``{user_question, analysis_results}``.

The tool mapping mirrors ``back/src/lib/analysis-tool-map.ts`` (the Bio service's
tool names differ from GenePilot's analysis-type names), and a type with no
matching tool is rejected rather than swapped for a look-alike one.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from langflow.custom import Component
from langflow.io import DataInput, IntInput, MessageTextInput, Output
from langflow.schema import Data
from langflow.schema.message import Message


# GenePilot analysis type -> Bio service tool name(s).
# Keep in sync with back/src/lib/analysis-tool-map.ts.
ANALYSIS_TOOL_MAP: dict[str, list[str]] = {
    "gc_content": ["calculate_gc_content"],
    "composition": ["calculate_nucleotide_composition"],
    "orfs": ["find_orfs"],
    "translate": ["translate_sequence"],
    "sequence_statistics": ["sequence_statistics"],
    "detect_sequence_type": ["detect_sequence_type"],
    "extract_sequence_features": ["extract_sequence_features"],
    "validate_sequence": ["validate_sequence"],
    "parse_fasta": ["parse_fasta"],
    # AT% = A% + T%, derived from the composition tool.
    "at_content": ["calculate_nucleotide_composition"],
}


class BioAnalysisConnector(Component):
    display_name = "Bio Analysis Connector"
    description = (
        "Calls the GenePilot Sequence Analysis Service (/analyze) directly. "
        "One reliable node instead of Parser + Operations + API Request."
    )
    icon = "activity"
    name = "BioAnalysisConnector"

    inputs = [
        DataInput(
            name="payload",
            display_name="Webhook Payload",
            info="The JSON body received by the Webhook node (fire-and-forget path).",
            required=False,
        ),
        MessageTextInput(
            name="sequence",
            display_name="Sequence",
            info=(
                "Raw sequence text. Receives Chat Input on the synchronous /run "
                "path; may also be a JSON request."
            ),
            required=False,
            tool_mode=True,
        ),
        MessageTextInput(
            name="analysis_type",
            display_name="Analysis Type",
            info="Overrides payload.analysis_type when set (e.g. via /run tweaks).",
            required=False,
        ),
        MessageTextInput(
            name="tools",
            display_name="Tools Override",
            info="Comma-separated Bio tool names. Overrides analysis_type when set.",
            required=False,
            advanced=True,
        ),
        MessageTextInput(
            name="bio_service_url",
            display_name="Bio Service URL",
            value="http://100.78.253.70:8001",
            info="Origin of the Sequence Analysis Service. The /analyze path is added.",
            required=True,
            advanced=True,
        ),
        IntInput(
            name="timeout",
            display_name="Timeout (seconds)",
            value=60,
            info="How long to wait for the Bio service before failing.",
            advanced=True,
        ),
    ]

    outputs = [
        Output(
            name="result",
            display_name="Analysis Results",
            method="analyze",
            types=["Data"],
        ),
        Output(
            name="report",
            display_name="Insight Input",
            method="build_report",
            types=["Message"],
        ),
    ]

    # -- helpers ---------------------------------------------------------------

    @staticmethod
    def _as_text(value: Any) -> str:
        """Coerce a Message/Data/str input to its plain text."""
        if value is None:
            return ""
        inner = getattr(value, "text", None)
        if isinstance(inner, str):
            return inner
        if isinstance(value, str):
            return value
        return str(value)

    @staticmethod
    def _try_json(text: str) -> Any:
        """Parse ``text`` as JSON, or return ``None`` when it is not JSON."""
        stripped = text.strip()
        if not stripped or stripped[0] not in "{[":
            return None
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            return None

    def _payload_dict(self) -> dict[str, Any]:
        """Return the webhook body as a plain dict, tolerating str/Data/None."""
        raw: Any = self.payload
        if raw is None:
            return {}
        data = getattr(raw, "data", raw)
        # A Message carries its JSON in `text`, a Data in `data`.
        if not isinstance(data, (dict, str)):
            data = self._as_text(raw)
        if isinstance(data, str):
            parsed = self._try_json(data)
            if isinstance(parsed, dict):
                return parsed
            return {"input_value": data} if data.strip() else {}
        if isinstance(data, dict):
            return data
        return {}

    def _request(self) -> dict[str, Any]:
        """Merge every input source into one request dict.

        Precedence, lowest to highest: a JSON document carried on ``sequence``,
        the Webhook ``payload``, then the explicit ``analysis_type``/``tools``
        fields (which is how ``/run`` tweaks arrive). Only one source is normally
        populated, so this stays predictable whichever entry point is used.
        """
        request: dict[str, Any] = {}

        sequence_text = self._as_text(self.sequence).strip()
        if sequence_text:
            parsed = self._try_json(sequence_text)
            if isinstance(parsed, dict):
                request.update(parsed)
            else:
                request["sequence"] = sequence_text

        request.update(self._payload_dict())

        analysis_type = self._as_text(self.analysis_type).strip()
        if analysis_type:
            request["analysis_type"] = analysis_type

        tools_override = self._as_text(self.tools).strip()
        if tools_override:
            request["tools"] = [tool.strip() for tool in tools_override.split(",") if tool.strip()]

        return request

    def _resolve_tools(self, request: dict[str, Any]) -> list[str]:
        planned = request.get("tools")
        if isinstance(planned, list) and planned:
            return [str(tool) for tool in planned]

        analysis_type = str(request.get("analysis_type") or "").strip()

        tools = ANALYSIS_TOOL_MAP.get(analysis_type)
        if not tools:
            raise ValueError(
                f"Analysis type {analysis_type!r} maps to no Bio tool. "
                f"Known: {', '.join(sorted(ANALYSIS_TOOL_MAP))}."
            )
        return tools

    def _resolve_sequence(self, request: dict[str, Any]) -> str:
        sequence = str(
            request.get("input_value") or request.get("sequence") or ""
        ).strip()
        if not sequence:
            raise ValueError(
                "No sequence found in the request. Expected input_value or the "
                "Sequence input."
            )
        # The service accepts a bare sequence; strip whitespace/newlines that a
        # composer or FASTA paste may leave behind.
        return "".join(sequence.split())

    def _question(self, request: dict[str, Any]) -> str:
        for key in ("user_question", "question"):
            value = request.get(key)
            if value:
                return str(value)
        return str(request.get("analysis_type") or "").strip()

    def _run(self) -> tuple[dict[str, Any], list[str], str]:
        # Builds are cached by Langflow, but both outputs can be requested in one
        # run, so memoise the network call rather than hitting Bio twice.
        cached = getattr(self, "_memo", None)
        if cached is not None:
            return cached

        request = self._request()
        sequence = self._resolve_sequence(request)
        tools = self._resolve_tools(request)

        url = f"{self._as_text(self.bio_service_url).strip().rstrip('/')}/analyze"
        response = httpx.post(
            url,
            json={"sequence": sequence, "tools": tools},
            timeout=float(self.timeout or 60),
        )
        response.raise_for_status()

        body = response.json()
        results = body.get("results", body)
        if not isinstance(results, dict):
            results = {"raw": results}

        self._memo = (results, tools, self._question(request))
        return self._memo

    # -- outputs ---------------------------------------------------------------

    def analyze(self) -> Data:
        results, tools, _ = self._run()
        self.status = f"{len(results)} result group(s)"
        return Data(
            data={
                "source": "bio_service",
                "tools": tools,
                "results": results,
            }
        )

    def build_report(self) -> Message:
        results, tools, question = self._run()
        report = {
            "user_question": question,
            "analysis_results": results,
        }
        self.status = f"{len(results)} result group(s)"
        return Message(text=json.dumps(report, ensure_ascii=False))

"""GenePilot — Insight Analyst connector (Langflow custom component).

Why this exists
---------------
The deployed "GenePilot Insight Analyst" flow used Langflow's stock
``LanguageModelComponent`` (IBM watsonx.ai / ``ibm/granite-4-h-small``). On the
current Langflow 1.12.3 host that component cannot build at all — even a minimal
``Chat Input -> Language Model -> Chat Output`` flow fails with::

    Error building Component Language Model:
    Attempted to call a sync close on an async stream.

That is a host-side watsonx/httpx async-stream bug, not a flow-wiring problem:
the WatSanX globals are present and valid, and every model id fails identically.

This component sidesteps the broken wrapper. It speaks the watsonx.ai REST API
directly over ``httpx`` — exactly like ``bio_analysis_connector.py`` speaks the
Bio Service directly — so the AI interpretation works regardless of which
Langflow model component is installed or broken.

Contract
--------
Input  (``input_value``): the Bio Analysis Connector's report, a JSON document
``{"user_question": ..., "analysis_results": {...}}``.

Output (``insight``):    the model's prose, an ``Message``. The system prompt is
the friend's Insight Analyst prompt, which already expects that exact input.

Credentials are resolved in this order, so the component works both from the
Langflow UI (global variables) and from a bare server:
  1. the ``api_key`` / ``project_id`` inputs (set them to the *name* of a global
     variable and Langflow resolves it, or paste the literal value),
  2. ``WATSONX_APIKEY`` / ``WATSONX_API_KEY`` and ``WATSONX_PROJECT_ID`` in the
     process environment (the fallback the stock component documents).
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

from langflow.custom import Component
from langflow.io import IntInput, MessageTextInput, MultilineInput, Output, SecretStrInput, StrInput
from langflow.schema.message import Message


IAM_TOKEN_URL = "https://iam.cloud.ibm.com/identity/token"
TOKEN_GRANT = "urn:ibm:params:oauth:grant-type:apikey"

# The friend's Insight Analyst prompt, verbatim. Kept here so the flow does not
# depend on a separate prompt node.
INSIGHT_SYSTEM_PROMPT = """You are GenePilot Insight Analyst, the interpretation layer of a bioinformatics research assistant.
Your sole responsibility is to interpret structured bioinformatics analysis results and provide a clear, scientifically grounded explanation for the user.

You are NOT a task planner or tool executor. You must NOT invent or extrapolate analysis results.

==================================================
CORE RULES & EVIDENCE
==================================================
1. Rely ONLY on the provided analysis results and established, basic biological facts.
2. Direct vs. Interpretation: Distinguish clearly between raw observations and what they imply. Never claim a result proves a conclusion if it only supports an observation.
3. No Unjustified Inferences: Do NOT infer biological function, organism identity, disease association, or evolutionary origins from single metrics (e.g., GC content, sequence length, or nucleotide count alone).
4. Validation Boundaries: Passing validation only means compliance with sequence formatting rules, NOT functional or biological validity.
5. Missing Evidence: If data is insufficient, explicitly state: "The available analysis does not establish that conclusion."
6. Accuracy: Report numbers exactly as provided. Select only fields relevant to the user's question.

==================================================
RESPONSE STYLE & FORMAT (RESEARCH-FRIENDLY)
==================================================
- Avoid single-paragraph responses. Structure the output clearly to support research workflows.
- Mandatory Layout:
  1. Direct Summary: A concise 1-2 sentence answer addressing the core question.
  2. Key Findings & Metrics: A bulleted breakdown of specific metrics, exact numerical values, and their immediate biological interpretations.
  3. Limitations / Context (if applicable): A short note on what the data does NOT establish.
- Respond in the same language as the user's question.
- Avoid intro/outro fluff, generic DNA tutorials, or repeating the raw JSON structure.

Reason internally (Identify Question -> Select Fields -> State Observation -> Interpret -> Note Limitations), but DO NOT expose this reasoning.

==================================================
INPUT / OUTPUT SPECIFICATION
==================================================
Input Structure:
{
  "user_question": "string",
  "analysis_results": {}
}

Output Rules:
- Return ONLY the final response intended for the user.
- Do NOT output JSON, code blocks/fences (```), or meta-talk about prompts/tools.
- If analysis_results is empty or contains an error, state that interpretation cannot be performed."""


class InsightAnalystConnector(Component):
    display_name = "Insight Analyst (watsonx.ai)"
    description = (
        "Writes the AI interpretation for a Bio Analysis Connector report by "
        "calling the watsonx.ai chat API directly. Bypasses the stock Language "
        "Model component, which fails on hosts with the async-stream bug."
    )
    icon = "brain-circuit"
    name = "InsightAnalystConnector"

    inputs = [
        MessageTextInput(
            name="input_value",
            display_name="Analysis Report",
            info="The Bio Analysis Connector's {user_question, analysis_results} JSON.",
            required=False,
            tool_mode=True,
        ),
        SecretStrInput(
            name="api_key",
            display_name="watsonx API Key",
            info=(
                "Global Variable name to resolve (default WATSONX_APIKEY), or a literal key. "
                "Falls back to WATSONX_APIKEY / WATSONX_API_KEY in the environment."
            ),
            value="WATSONX_APIKEY",
            required=False,
            load_from_db=True,
        ),
        StrInput(
            name="project_id",
            display_name="watsonx Project ID",
            info=(
                "Global Variable name to resolve (default WATSONX_PROJECT_ID), or a literal id. "
                "Falls back to WATSONX_PROJECT_ID in the environment."
            ),
            value="WATSONX_PROJECT_ID",
            required=False,
            load_from_db=True,
        ),
        StrInput(
            name="base_url",
            display_name="watsonx API Endpoint",
            value="https://us-south.ml.cloud.ibm.com",
            advanced=True,
        ),
        StrInput(
            name="model_id",
            display_name="Model",
            value="ibm/granite-4-h-small",
            advanced=True,
        ),
        MultilineInput(
            name="system_message",
            display_name="System Message",
            value=INSIGHT_SYSTEM_PROMPT,
            advanced=True,
        ),
        IntInput(
            name="max_tokens",
            display_name="Max Tokens",
            value=1024,
            advanced=True,
        ),
        IntInput(
            name="temperature_num",
            display_name="Temperature",
            value=1,
            info="0-10, scaled to 0-1 for the API. Kept as IntInput to avoid float inputs.",
            advanced=True,
        ),
    ]

    outputs = [
        Output(
            name="insight",
            display_name="Insight",
            method="build_insight",
            types=["Message"],
        ),
    ]

    # -- helpers ---------------------------------------------------------------

    @staticmethod
    def _text(value: Any) -> str:
        if value is None:
            return ""
        # SecretStrInput resolves to a SecretStr; ``str()`` would mask it.
        getter = getattr(value, "get_secret_value", None)
        if callable(getter):
            return str(getter()).strip()
        inner = getattr(value, "text", None)
        if isinstance(inner, str):
            return inner.strip()
        if isinstance(value, str):
            return value.strip()
        return str(value).strip()

    @staticmethod
    def _resolve(setting: str, *env_names: str) -> str:
        """Resolve a setting that may be a literal value or a variable name."""
        if setting:
            # Treat it as a global-variable name only when it looks like one and
            # an environment value with that name exists.
            for env_name in env_names:
                if setting == env_name and os.getenv(env_name):
                    return os.environ[env_name].strip()
            # A bare name (no key material) that matches a known env var name is
            # far more likely to be a variable reference than a real secret.
            if setting in env_names and not os.getenv(setting):
                for env_name in env_names:
                    value = os.getenv(env_name)
                    if value:
                        return value.strip()
            return setting
        for env_name in env_names:
            value = os.getenv(env_name)
            if value:
                return value.strip()
        return ""

    def _credentials(self) -> tuple[str, str]:
        api_key = self._resolve(self._text(self.api_key), "WATSONX_APIKEY", "WATSONX_API_KEY")
        project_id = self._resolve(self._text(self.project_id), "WATSONX_PROJECT_ID")
        return api_key, project_id

    def _token(self, api_key: str) -> str:
        response = httpx.post(
            IAM_TOKEN_URL,
            data={"grant_type": TOKEN_GRANT, "apikey": api_key},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )
        response.raise_for_status()
        return str(response.json()["access_token"])

    # -- output ----------------------------------------------------------------

    def build_insight(self) -> Message:
        api_key, project_id = self._credentials()

        if not api_key:
            self.status = "watsonx API key not configured"
            return Message(
                text=(
                    "AI interpretation is unavailable: no watsonx API key was found. "
                    "Set WATSONX_APIKEY in the Langflow environment, or fill the "
                    "component's API Key input."
                )
            )

        if not project_id:
            self.status = "watsonx project id not configured"
            return Message(
                text=(
                    "AI interpretation is unavailable: no watsonx project id was found. "
                    "Set WATSONX_PROJECT_ID in the Langflow environment, or fill the "
                    "component's Project ID input."
                )
            )

        report = self._text(self.input_value)
        if not report:
            self.status = "no report input"
            return Message(text="AI interpretation was not run: the analysis report was empty.")

        token = self._token(api_key)
        temperature = min(1.0, max(0.0, float(self.temperature_num or 0) / 10.0))

        response = httpx.post(
            f"{self._text(self.base_url).rstrip('/')}/ml/v1/text/chat",
            params={"version": "2023-05-29"},
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={
                "model_id": self._text(self.model_id) or "ibm/granite-4-h-small",
                "project_id": project_id,
                "messages": [
                    {"role": "system", "content": self._text(self.system_message)},
                    {"role": "user", "content": report},
                ],
                "max_tokens": int(self.max_tokens or 1024),
                "temperature": temperature,
            },
            timeout=90,
        )
        response.raise_for_status()

        payload = response.json()
        choices = payload.get("choices") or []
        text = ""
        if choices:
            text = str(choices[0].get("message", {}).get("content", "")).strip()

        if not text:
            # Never fail the analysis for a missing interpretation; return the raw
            # response so the reason is visible in the flow's output.
            text = f"[insight unavailable] watsonx returned no message content: {json.dumps(payload)[:800]}"

        self.status = f"{len(text)} chars"
        return Message(text=text)

"""
Gemini reasoner

- Phase 1 (PP1): single-image evidence-locked extraction:
    * label selection (must be one of ALLOWED_LABELS)
    * precise color (prefer Florence VQA)
    * category-specific features / defects / attachments (evidence-backed only)
    * key_count only if evidence provides it

- Phase 2 (PP2): multi-image validation + fusion:
    * validate all images are the same category AND same physical object (best-effort)
    * merge descriptions + details into one final JSON

This module stores the "ready-to-paste" prompt templates requested.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
import json
import logging
import re
import time

from app.domain.category_specs import ALLOWED_LABELS, CATEGORY_SPECS, canonicalize_label

logger = logging.getLogger(__name__)

TRANSIENT_STATUS_CODES = {429, 500, 502, 503, 504}
TRANSIENT_PROVIDER_STATUSES = {
    "UNAVAILABLE",
    "RESOURCE_EXHAUSTED",
    "DEADLINE_EXCEEDED",
    "INTERNAL",
    "ABORTED",
    "UNKNOWN",
}
FATAL_PROVIDER_STATUSES = {"UNAUTHENTICATED", "PERMISSION_DENIED", "INVALID_ARGUMENT"}

RETRYABLE_UNAVAILABLE_MESSAGE = "Reasoning service temporarily unavailable. Please retry."
REASONING_FAILED_MESSAGE = "Reasoning failed."


class GeminiServiceError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        provider_status: Optional[str] = None,
        retryable: bool = False,
        error_type: str = "gemini_error",
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.provider_status = provider_status
        self.retryable = retryable
        self.error_type = error_type

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.error_type,
            "status_code": self.status_code,
            "retryable": self.retryable,
            "provider_status": self.provider_status,
            "message": str(self),
        }


class GeminiTransientError(GeminiServiceError):
    def __init__(self, message: str, *, status_code: Optional[int] = None, provider_status: Optional[str] = None) -> None:
        super().__init__(
            message,
            status_code=status_code,
            provider_status=provider_status,
            retryable=True,
            error_type="gemini_transient_error",
        )


class GeminiFatalError(GeminiServiceError):
    def __init__(self, message: str, *, status_code: Optional[int] = None, provider_status: Optional[str] = None) -> None:
        super().__init__(
            message,
            status_code=status_code,
            provider_status=provider_status,
            retryable=False,
            error_type="gemini_fatal_error",
        )


# ----------------------------
# PROMPTS
# ----------------------------

STRICT_EXTRACTOR_PROMPT = r"""
You are an evidence-locked inspection assistant.
IMPORTANT: You have access to the crop image. Use it to VERIFY the evidence fields provided below.
Do NOT guess. Do NOT invent. If evidence is missing or contradicted by the image, output empty arrays.

TASK
1) From the candidate lists, select ONLY items that are clearly supported by the EVIDENCE and VISIBLE in the image.
2) Produce a short, detailed product-style description (1–2 sentences) using ONLY confirmed details.
3) Use ONLY the exact phrases from the candidate lists when listing features/defects/attachments.

HOW TO DECIDE (STRICT)
- Start with GROUNDED_FEATURES / GROUNDED_DEFECTS / GROUNDED_ATTACHMENTS:
  If an item appears there and also exists in the corresponding candidate list, include it.
- Then check CAPTION and DEFECTS_VQA_TEXT:
  If a candidate phrase appears verbatim (case-insensitive) in CAPTION or DEFECTS_VQA_TEXT, include it.
- VISUAL VERIFICATION:
  If the image clearly contradicts any evidence (e.g., evidence says "red" but image is "blue"), REJECT that piece of evidence.
- OCR RULE:
  If OCR_TEXT is not "None" and FEATURE_LIST contains "text", include "text".
  Only include "brand name" if OCR_TEXT looks like a brand AND FEATURE_LIST contains "brand name"
  AND at least one of CAPTION or grounding indicates branding/text presence (do not assume).

STRICT OUTPUT FORMAT (JSON ONLY)
Return exactly one JSON object with these keys:
{{
  "description": string,
  "features": [string],
  "defects": [string],
  "attachments": [string],
  "key_count": integer | null
}}

RULES
- Do NOT mention the person, hands, skin tone, background.
- If none found in a list, return an empty array for that list.
- Keep description object-only. If OCR_TEXT is provided, include it exactly in the description.

EVIDENCE (authoritative)
LABEL: {LABEL}
PRIMARY_COLOR: {COLOR_OR_UNKNOWN}
OCR_TEXT: {OCR_TEXT_OR_NONE}
CAPTION: {CAPTION_OR_NONE}
DEFECTS_VQA_TEXT: {DEFECTS_VQA_TEXT_OR_NONE}

GROUNDED_FEATURES: {GROUNDED_FEATURES_JSON}
GROUNDED_DEFECTS: {GROUNDED_DEFECTS_JSON}
GROUNDED_ATTACHMENTS: {GROUNDED_ATTACHMENTS_JSON}
GROUNDING_LABELS_RAW: {GROUNDING_LABELS_RAW_JSON}

CANDIDATES
FEATURE_LIST:
{FEATURE_LIST}

DEFECT_LIST:
{DEFECT_LIST}

ATTACHMENT_LIST:
{ATTACHMENT_LIST}

(If LABEL == "Key")
KEY COUNT INSTRUCTION:
If key_count is provided in evidence, use it. Otherwise:
Count how many separate keys are visible. Return a single integer. If only one key is visible, return 1.
Else set key_count to null.
"""

PHASE2_PP2_PROMPT = r"""
SYSTEM:
You are an evidence-locked information extractor for a lost-and-found system.

STRICT RULES:
1) Use ONLY the EVIDENCE BUNDLE JSON provided below. Do NOT invent, assume, or hallucinate.
2) Every feature/defect/attachment MUST be explicitly supported by at least one image’s evidence.
3) You must reject if images do not represent the SAME category (different labels).
4) You must reject if the bundle strongly suggests different physical objects (different brand OCR, very different colors, totally different form factor).
5) Color must be PRECISE. Prefer per-image evidence.color_vqa.
6) Key rule: key_count may be output only if at least one image evidence includes key_count.

ALLOWED LABELS (Preferred):
{{ALLOWED_LABELS_LIST}}

STEP-BY-STEP:
1) Inspect EVIDENCE_BUNDLE.per_image[].phase1_output.label and ensure all labels match.
   - If any mismatch -> status="rejected" with message and stop.
2) Decide if images show the same physical object:
   - Compare OCR (brand text), distinctive marks, color phrases, and described features.
   - If evidence indicates different objects -> rejected.
3) Merge details:
   - combined_color: choose the most specific non-conflicting color phrase from evidence.color_vqa.
     If conflicts (e.g., "black" vs "white") -> rejected.
   - combined_features/defects/attachments: union of evidence-backed items (de-dup).
4) Write final_description: 1–2 sentences, only confirmed details.
5) Produce final JSON in the exact schema below.

OUTPUT FORMAT:
Return VALID JSON ONLY. No markdown.

OUTPUT JSON SCHEMA:
{
  "status": "accepted" | "rejected",
  "message": string,

  "label": string | null,
  "color": string | null,

  "final_description": string | null,

  "category_details": {
    "features": [string],
    "defects": [string],
    "attachments": [string]
  },

  "key_count": integer | null,

  "tags": [string],

  "evidence_used": {
    "color_source": "florence_vqa_color" | "caption" | "unknown",
    "feature_sources": [string],
    "defect_sources": [string],
    "attachment_sources": [string],
    "ocr_source": "ocr_text" | "none"
  }
}

EVIDENCE BUNDLE (authoritative):
{{EVIDENCE_BUNDLE_JSON}}
"""


# ----------------------------
# Client wrapper
# ----------------------------

def _extract_json_content(text: str) -> str:
    """
    Robustly extract JSON content from a string.
    1. Strips code fences.
    2. Finds the first '{' and the last '}'.
    """
    # Strip markdown code fences
    text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.I)
    text = re.sub(r"\s*```$", "", text)
    
    # Find first '{' and last '}'
    start = text.find('{')
    end = text.rfind('}')
    
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1]
    
    return text.strip()


class GeminiReasoner:
    """
    Thin wrapper around Gemini.

    Expected dependencies (install in your env):
      pip install google-genai

    And set an API key in env:
      export GOOGLE_API_KEY=...
    """

    def __init__(self, model_name: str = "gemini-3-flash-preview") -> None:
        self.model_name = model_name
        self._client = None
        self._retry_delay_seconds = 0.5

    def _load_client(self) -> None:
        if self._client is not None:
            return
        try:
            from google import genai  # type: ignore
            from dotenv import load_dotenv
            import os
            
            load_dotenv()
            api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
            if not api_key:
                raise ValueError("GOOGLE_API_KEY or GEMINI_API_KEY not found in environment variables")
                
        except ImportError as e:
            raise RuntimeError(
                "Required packages not installed. Install with: pip install google-genai python-dotenv"
            ) from e
            
        self._client = genai.Client(api_key=api_key)

    @staticmethod
    def _extract_provider_status(exc: Exception) -> Optional[str]:
        response_json = getattr(exc, "response_json", None)
        if isinstance(response_json, dict):
            error = response_json.get("error")
            if isinstance(error, dict):
                status = error.get("status")
                if isinstance(status, str):
                    return status
        return None

    def _classify_gemini_exception(self, exc: Exception) -> GeminiServiceError:
        status_code_raw = getattr(exc, "status_code", None)
        status_code = int(status_code_raw) if isinstance(status_code_raw, int) else None
        provider_status = self._extract_provider_status(exc)
        message = str(exc)

        if status_code in TRANSIENT_STATUS_CODES:
            return GeminiTransientError(message, status_code=status_code, provider_status=provider_status)

        if provider_status in TRANSIENT_PROVIDER_STATUSES:
            return GeminiTransientError(message, status_code=status_code, provider_status=provider_status)

        if provider_status in FATAL_PROVIDER_STATUSES or status_code in {400, 401, 403}:
            return GeminiFatalError(message, status_code=status_code, provider_status=provider_status)

        return GeminiFatalError(message, status_code=status_code, provider_status=provider_status)

    def _generate_text_once(self, prompt: str, images: Optional[List[Any]] = None) -> str:
        self._load_client()
        assert self._client is not None
        
        contents = [prompt]
        if images:
            contents.extend(images)

        try:
            # google-genai API shape can differ by version; adapt if needed.
            resp = self._client.models.generate_content(
                model=self.model_name,
                contents=contents,
            )
        except GeminiServiceError:
            raise
        except Exception as exc:
            raise self._classify_gemini_exception(exc) from exc

        # resp.text is common; otherwise try candidates.
        text = getattr(resp, "text", None)
        if text:
            return str(text)
        # fallback
        try:
            return str(resp.candidates[0].content.parts[0].text)
        except Exception:
            return str(resp)

    def _generate_text(self, prompt: str, images: Optional[List[Any]] = None) -> str:
        attempts = 2
        for attempt in range(1, attempts + 1):
            try:
                output = self._generate_text_once(prompt, images=images)
                if attempt > 1:
                    logger.info("Gemini request succeeded after retry.")
                return output
            except GeminiTransientError as exc:
                if attempt < attempts:
                    logger.warning(
                        "Gemini transient failure (attempt %s/%s): status_code=%s provider_status=%s",
                        attempt,
                        attempts,
                        exc.status_code,
                        exc.provider_status,
                    )
                    time.sleep(self._retry_delay_seconds)
                    continue
                raise

        raise GeminiFatalError("Gemini generation failed unexpectedly.")

    def extract_category_details(self, evidence_json: Dict[str, Any], crop_image: Optional[Any] = None) -> Dict[str, Any]:
        """
        Strict extractor function for Phase 1.
        """
        # Extract context
        detection = evidence_json.get("detection", {})
        crop_analysis = evidence_json.get("crop_analysis", {})
        canonical_label_in = evidence_json.get("canonical_label")
        label_lock = bool(evidence_json.get("label_lock", False))
        label_candidates_raw = evidence_json.get("label_candidates", [])
        label_candidates = [
            str(label).strip()
            for label in (label_candidates_raw if isinstance(label_candidates_raw, list) else [])
            if str(label).strip()
        ]
        
        raw_label = canonical_label_in if canonical_label_in else detection.get("label", "Unknown")
        label = canonicalize_label(raw_label) or raw_label
        
        color = crop_analysis.get("color_vqa")
        if not color or color.lower() == "unknown":
            color = "Unknown"
            
        ocr = crop_analysis.get("ocr_text")
        if not ocr:
            ocr = "None"
        
        # Get specs
        specs = CATEGORY_SPECS.get(label, {})
        feature_list = specs.get("features", [])
        defect_list = specs.get("defects", [])
        attachment_list = specs.get("attachments", [])
        
        # Extract new evidence fields
        caption = crop_analysis.get("caption", "None")
        defects_vqa = crop_analysis.get("raw", {}).get("defects_vqa", "None")
        
        grounded_features = crop_analysis.get("grounded_features", [])
        grounded_defects = crop_analysis.get("grounded_defects", [])
        grounded_attachments = crop_analysis.get("grounded_attachments", [])
        
        grounding_raw = crop_analysis.get("raw", {}).get("grounding_raw", {})
        grounding_labels_raw = grounding_raw.get("labels", []) if isinstance(grounding_raw, dict) else []

        prompt = STRICT_EXTRACTOR_PROMPT.format(
            LABEL=label,
            COLOR_OR_UNKNOWN=color,
            OCR_TEXT_OR_NONE=ocr,
            CAPTION_OR_NONE=caption,
            DEFECTS_VQA_TEXT_OR_NONE=defects_vqa,
            GROUNDED_FEATURES_JSON=json.dumps(grounded_features),
            GROUNDED_DEFECTS_JSON=json.dumps(grounded_defects),
            GROUNDED_ATTACHMENTS_JSON=json.dumps(grounded_attachments),
            GROUNDING_LABELS_RAW_JSON=json.dumps(grounding_labels_raw),
            FEATURE_LIST=json.dumps(feature_list, indent=2),
            DEFECT_LIST=json.dumps(defect_list, indent=2),
            ATTACHMENT_LIST=json.dumps(attachment_list, indent=2)
        )
        if label_lock:
            prompt += (
                "\n\nCATEGORY LOCK (MANDATORY):\n"
                f"- CANONICAL_LABEL: {label}\n"
                f"- LABEL_CANDIDATES: {json.dumps(label_candidates)}\n"
                "- DO NOT change category.\n"
                "- You MUST keep the category as CANONICAL_LABEL and only extract details.\n"
            )

        images = [crop_image] if crop_image else None
        text = self._generate_text(prompt, images=images)
        cleaned_json_str = _extract_json_content(text)
        
        try:
            data = json.loads(cleaned_json_str)
            
            # Adapt to UnifiedPipeline expected schema
            return {
                "status": "accepted",
                "message": "Extracted successfully",
                "label": label,
                "color": color if color != "Unknown" else None,
                "category_details": {
                    "features": data.get("features", []),
                    "defects": data.get("defects", []),
                    "attachments": data.get("attachments", [])
                },
                "key_count": data.get("key_count"),
                "final_description": data.get("description")
            }
            
        except json.JSONDecodeError:
            # Fallback: return rejected if JSON parsing fails
            return {
                "status": "rejected",
                "message": "Gemini returned invalid JSON",
                "label": label
            }

    def run_phase1(self, florence_evidence_json: Dict[str, Any], crop_image: Optional[Any] = None) -> Dict[str, Any]:
        """
        Alias for extract_category_details to maintain backward compatibility if needed,
        or simply delegate to the new strict extractor.
        """
        return self.extract_category_details(florence_evidence_json, crop_image=crop_image)

    def confirm_pp2_view(self, evidence_json: Dict[str, Any], crop_image: Optional[Any] = None) -> Dict[str, Any]:
        """
        PP2 helper that returns a compact, normalized payload for single-view advisory evidence.
        Timeout behavior is intentionally owned by the PP2 caller.
        """
        phase1 = self.run_phase1(evidence_json, crop_image=crop_image)
        status_in = str(phase1.get("status", "")).strip().lower()

        if status_in == "accepted":
            status = "success"
        elif status_in == "rejected":
            status = "rejected"
        else:
            status = "error"

        payload: Dict[str, Any] = {
            "status": status,
            "label": phase1.get("label"),
            "description": phase1.get("final_description"),
            "message": str(phase1.get("message", "") or ""),
        }
        if "error" in phase1:
            payload["error"] = phase1.get("error")
        return payload

    def run_phase2(self, evidence_bundle_json: Dict[str, Any]) -> Dict[str, Any]:
        prompt = PHASE2_PP2_PROMPT.replace(
            "{{EVIDENCE_BUNDLE_JSON}}",
            json.dumps(evidence_bundle_json, ensure_ascii=False),
        ).replace(
            "{{ALLOWED_LABELS_LIST}}",
            "\n".join(f"- {label}" for label in ALLOWED_LABELS)
        )
        text = self._generate_text(prompt)
        cleaned = _extract_json_content(text)
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
             return {
                "status": "rejected",
                "message": "Gemini returned invalid JSON in Phase 2",
                "label": None
            }

        return data

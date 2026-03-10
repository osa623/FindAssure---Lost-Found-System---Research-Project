import numpy as np
import re
import string
from collections import Counter, defaultdict
from typing import List, Dict, Any, Optional, Set
from app.schemas.pp2_schemas import PP2PerViewResult, PP2FusedProfile
from app.domain.color_utils import normalize_color, extract_color_from_text

class MultiViewFusionService:
    _CARD_LABELS = {"Student ID", "NIC / National ID Card"}
    _URL_OR_DOMAIN_RE = re.compile(r"(?:\bHTTP\b|\bHTTPS\b|\bWWW\b|(?:^|[^\s])\.(?:COM|NET|LK|ORG|CO)\b)")
    _SPLIT_RE = re.compile(r"[\/\._-]+")
    _TECH_STOPWORDS = {"HTTP", "HTTPS", "WWW", "COM", "NET", "LK", "ORG", "CO"}
    _ALPHA_ONLY_RE = re.compile(r"^[A-Z]+$")

    @classmethod
    def _looks_like_url_or_domain(cls, raw_token: str) -> bool:
        token = str(raw_token or "").upper()
        return bool(cls._URL_OR_DOMAIN_RE.search(token))

    @staticmethod
    def _strip_token_edges(token: str) -> str:
        return str(token or "").upper().strip(string.punctuation + " ")

    @classmethod
    def _split_raw_chunk(cls, raw_chunk: str) -> List[str]:
        return [part for part in cls._SPLIT_RE.split(str(raw_chunk or "")) if part]

    @staticmethod
    def _non_letter_ratio(token: str) -> float:
        if not token:
            return 1.0
        non_letters = sum(1 for ch in token if not ("A" <= ch <= "Z"))
        return non_letters / float(len(token))

    @classmethod
    def _is_brand_like(cls, token: str) -> bool:
        if not token:
            return False
        if token in cls._TECH_STOPWORDS:
            return False
        if not cls._ALPHA_ONLY_RE.fullmatch(token):
            return False
        return 4 <= len(token) <= 20

    def _collect_view_ocr_tokens(self, text: str) -> tuple[Set[str], Set[str]]:
        kept: Set[str] = set()
        rejected: Set[str] = set()
        raw_chunks = str(text or "").split()

        for raw_chunk in raw_chunks:
            raw_upper = str(raw_chunk).upper()
            if self._looks_like_url_or_domain(raw_upper):
                rejected.add(raw_upper)
                continue

            parts = self._split_raw_chunk(raw_upper)
            if not parts:
                continue

            for part in parts:
                cleaned = self._strip_token_edges(part)
                if not cleaned:
                    continue

                if len(cleaned) < 3:
                    rejected.add(cleaned)
                    continue

                if cleaned in self._TECH_STOPWORDS:
                    rejected.add(cleaned)
                    continue

                if self._non_letter_ratio(cleaned) > 0.40:
                    rejected.add(cleaned)
                    continue

                kept.add(cleaned)

        return kept, rejected

    @staticmethod
    def _levenshtein_distance(a: str, b: str) -> int:
        left = str(a or "")
        right = str(b or "")
        if left == right:
            return 0
        if not left:
            return len(right)
        if not right:
            return len(left)

        prev = list(range(len(right) + 1))
        for i, ch_left in enumerate(left, start=1):
            curr = [i]
            for j, ch_right in enumerate(right, start=1):
                cost = 0 if ch_left == ch_right else 1
                curr.append(
                    min(
                        prev[j] + 1,      # deletion
                        curr[j - 1] + 1,  # insertion
                        prev[j - 1] + cost,  # substitution
                    )
                )
            prev = curr
        return prev[-1]

    @classmethod
    def _normalized_edit_similarity(cls, a: str, b: str) -> float:
        left = str(a or "").upper()
        right = str(b or "").upper()
        max_len = max(len(left), len(right), 1)
        distance = cls._levenshtein_distance(left, right)
        return 1.0 - (float(distance) / float(max_len))

    @staticmethod
    def _longest_common_suffix_len(a: str, b: str) -> int:
        left = str(a or "")
        right = str(b or "")
        max_n = min(len(left), len(right))
        count = 0
        while count < max_n and left[-1 - count] == right[-1 - count]:
            count += 1
        return count

    @classmethod
    def _tokens_similar(cls, a: str, b: str, threshold: float) -> bool:
        left = str(a or "").upper()
        right = str(b or "").upper()
        if not left or not right:
            return False
        if left == right:
            return True

        similarity = cls._normalized_edit_similarity(left, right)
        if similarity >= threshold:
            return True

        # Conservative fallback for brand-like OCR drift where edit similarity is
        # too low but suffix agreement is still meaningful (e.g., *...ERRY).
        if not (cls._is_brand_like(left) and cls._is_brand_like(right)):
            return False
        if min(len(left), len(right)) < 8:
            return False
        if abs(len(left) - len(right)) > 2:
            return False

        suffix_len = cls._longest_common_suffix_len(left, right)
        return suffix_len >= 4 and 0.50 <= similarity < 0.70

    def _cluster_tokens_fuzzy(
        self,
        tokens_per_view: List[List[str]],
        threshold: float = 0.82,
    ) -> List[List[str]]:
        token_order: List[str] = []
        seen: Set[str] = set()
        for view_tokens in tokens_per_view or []:
            for raw_token in view_tokens or []:
                token = str(raw_token or "").strip().upper()
                if not token:
                    continue
                if token in seen:
                    continue
                seen.add(token)
                token_order.append(token)

        if not token_order:
            return []

        adjacency: Dict[str, Set[str]] = {tok: set() for tok in token_order}
        for i, left in enumerate(token_order):
            for right in token_order[i + 1:]:
                if self._tokens_similar(left, right, threshold):
                    adjacency[left].add(right)
                    adjacency[right].add(left)

        token_pos = {tok: idx for idx, tok in enumerate(token_order)}
        visited: Set[str] = set()
        clusters: List[tuple[int, List[str]]] = []

        for root in token_order:
            if root in visited:
                continue

            stack = [root]
            visited.add(root)
            component: List[str] = []
            while stack:
                current = stack.pop()
                component.append(current)
                for neighbor in sorted(adjacency[current]):
                    if neighbor in visited:
                        continue
                    visited.add(neighbor)
                    stack.append(neighbor)

            component_sorted = sorted(component)
            first_seen_pos = min(token_pos[tok] for tok in component_sorted)
            clusters.append((first_seen_pos, component_sorted))

        clusters.sort(key=lambda item: item[0])
        return [cluster for _, cluster in clusters]

    def _select_cluster_representative(self, cluster_tokens: List[str]) -> str:
        tokens = [str(tok or "").upper() for tok in cluster_tokens if str(tok or "").strip()]
        if not tokens:
            return ""
        if len(tokens) == 1:
            return tokens[0]

        def _avg_similarity(token: str) -> float:
            others = [t for t in tokens if t != token]
            if not others:
                return 1.0
            sims = [self._normalized_edit_similarity(token, other) for other in others]
            return float(sum(sims) / len(sims))

        ranked = sorted(tokens, key=lambda tok: (-_avg_similarity(tok), -len(tok), tok))
        return ranked[0]

    def compute_fused_vector(self, vectors: List[np.ndarray]) -> np.ndarray:
        """
        Compute canonical fused embedding:
        1) L2-normalize each input vector
        2) Average normalized vectors
        3) L2-normalize the average
        Returns float32 vector.
        """
        if not vectors:
            raise ValueError("Cannot fuse empty vector list")

        prepared: List[np.ndarray] = []
        expected_dim: Optional[int] = None
        eps = 1e-9

        for vec in vectors:
            arr = np.asarray(vec, dtype=np.float32).reshape(-1)
            if arr.size == 0:
                raise ValueError("Vectors must be non-empty")
            if expected_dim is None:
                expected_dim = int(arr.size)
            elif int(arr.size) != expected_dim:
                raise ValueError("All vectors must share the same dimensionality")

            norm = float(np.linalg.norm(arr))
            if norm > eps:
                arr = arr / norm
            prepared.append(arr.astype(np.float32, copy=False))

        avg_vec = np.mean(np.stack(prepared, axis=0), axis=0).astype(np.float32, copy=False)
        final_norm = float(np.linalg.norm(avg_vec))
        if final_norm > eps:
            avg_vec = (avg_vec / final_norm).astype(np.float32, copy=False)
        return avg_vec

    @staticmethod
    def _humanize_category(category: str) -> str:
        raw = str(category or "").strip()
        if not raw:
            return "item"
        aliases = {
            "Earbuds - Earbuds case": "earbuds case",
            "Smart Phone": "smart phone",
            "Student ID": "student ID card",
            "Laptop/Mobile chargers & cables": "laptop or mobile charger/cable",
        }
        return aliases.get(raw, raw.lower())

    @staticmethod
    def _to_clean_str_list(value: Any) -> List[str]:
        if isinstance(value, str):
            text = value.strip()
            return [text] if text else []
        if isinstance(value, list):
            out: List[str] = []
            for item in value:
                if not isinstance(item, str):
                    continue
                text = item.strip()
                if text:
                    out.append(text)
            return out
        return []

    @staticmethod
    def _dedupe_keep_order(values: List[str]) -> List[str]:
        seen: Set[str] = set()
        deduped: List[str] = []
        for raw in values:
            text = str(raw or "").strip()
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(text)
        return deduped

    @staticmethod
    def _join_natural(values: List[str]) -> str:
        items = [str(v).strip() for v in values if str(v).strip()]
        if not items:
            return ""
        if len(items) == 1:
            return items[0]
        if len(items) == 2:
            return f"{items[0]} and {items[1]}"
        return f"{', '.join(items[:-1])}, and {items[-1]}"

    @staticmethod
    def _pick_most_common(values: List[str]) -> Optional[str]:
        cleaned = [str(v).strip() for v in values if str(v).strip()]
        if not cleaned:
            return None
        counts = Counter(cleaned)
        ranked = sorted(counts.items(), key=lambda item: (-int(item[1]), -len(item[0]), item[0]))
        return ranked[0][0]

    @staticmethod
    def _collect_card_tokens(text: str) -> List[str]:
        tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9-]*", str(text or ""))
        out: List[str] = []
        for token in tokens:
            clean = str(token).strip().upper()
            if len(clean) < 3:
                continue
            out.append(clean)
        return out

    def _merge_card_ocr_tokens(self, per_view: List[PP2PerViewResult], best_view_index: int) -> List[str]:
        token_to_views: Dict[str, Set[int]] = defaultdict(set)
        best_view_tokens: List[str] = []
        for res in per_view:
            tokens = self._collect_card_tokens(getattr(res.extraction, "ocr_text", "") or "")
            deduped = self._dedupe_keep_order(tokens)
            if int(res.view_index) == int(best_view_index):
                best_view_tokens = deduped
            for token in deduped:
                token_to_views[token].add(int(res.view_index))

        ranked = sorted(
            token_to_views.items(),
            key=lambda item: (-len(item[1]), -int(item[0] in best_view_tokens), item[0]),
        )
        supported = [token for token, views in ranked if len(views) >= 2]
        if not supported:
            supported = best_view_tokens[:]
        return supported[:2]

    @staticmethod
    def _extract_caption_snippet(caption: str) -> str:
        text = MultiViewFusionService._sanitize_object_text(caption)
        if not text:
            return ""
        lowered = text.lower().strip().rstrip(".")
        match = re.search(r"\bwith\s+(.+)", lowered)
        if not match:
            return ""
        snippet = match.group(1)
        snippet = re.sub(
            r"(?i)\s+(?:on|against|near|beside)\s+(?:a\s+|the\s+)?(?:wooden\s+)?(?:table|desk|surface|floor)\b.*$",
            "",
            snippet,
        ).strip(" ,.")
        if len(snippet.split()) < 2:
            return ""
        if any(term in snippet for term in (
            "hand", "person", "background", "table", "desk", "floor",
            "wall", "shelf", "carpet", "mat", "counter", "foreground",
        )):
            return ""
        return snippet

    @staticmethod
    def _sanitize_object_text(text: str) -> str:
        raw = str(text or "").strip()
        if not raw:
            return ""

        prefix_patterns = [
            r"(?i)^a\s+person\s+is\s+holding\s+",
            r"(?i)^the\s+person\s+is\s+holding\s+",
            r"(?i)^someone\s+is\s+holding\s+",
            r"(?i)^a\s+hand\s+is\s+holding\s+",
            r"(?i)^the\s+hand\s+is\s+holding\s+",
            r"(?i)^held\s+in\s+(?:a\s+)?hand\s*,?\s*",
            r"(?i)^being\s+held\s+in\s+(?:a\s+)?hand\s*,?\s*",
            r"(?i)^close[\s-]?up\s+of\s+",
            r"(?i)^this\s+(?:image|photo|picture)\s+shows\s+",
            r"(?i)^in\s+(?:this|the)\s+(?:image|photo|picture)\s*,?\s*",
            r"(?i)^there\s+is\s+",
            r"(?i)^(?:the\s+)?(?:inside|front|back|side|rear|top|bottom)\s+view\s+shows\s+",
        ]
        tail_patterns = [
            r"(?i)\s+(?:on|against|near|beside|above|over|below|beneath|next\s+to)\s+(?:a\s+|the\s+)?(?:\w+\s+){0,2}(?:table|desk|surface|floor|wall|carpet|mat|counter|shelf)\b.*$",
            r"(?i)\s+sitting\s+on\s+(?:a\s+|the\s+)?(?:\w+\s+)?(?:table|desk|surface|floor)\b.*$",
            r"(?i)\s+lying\s+on\s+(?:a\s+|the\s+)?(?:\w+\s+)?(?:table|desk|surface|floor)\b.*$",
            r"(?i)\s+is\s+sitting\b.*$",
            r"(?i)\s+is\s+lying\b.*$",
        ]
        banned_terms = {
            "person", "hand", "finger", "selfie", "background", "holding",
            "table", "desk", "floor", "wall", "carpet", "mat",
            "counter", "shelf", "foreground", "backdrop",
        }
        generic_phrases = {"wallet front", "wallet back", "helmet front", "helmet back", "wallet side", "helmet side"}

        cleaned_sentences: List[str] = []
        for sentence in re.split(r"(?<=[.!?])\s+", raw):
            candidate = sentence.strip()
            if not candidate:
                continue
            for pattern in prefix_patterns:
                candidate = re.sub(pattern, "", candidate).strip()
            for pattern in tail_patterns:
                candidate = re.sub(pattern, "", candidate).strip(" ,.")
            if not candidate:
                continue

            lower = candidate.lower()
            if any(term in re.findall(r"\b\w+\b", lower) for term in banned_terms):
                continue
            if lower in generic_phrases:
                continue
            if len(candidate.split()) < 3:
                continue

            cleaned_sentences.append(candidate.rstrip(". "))

        cleaned_sentences = MultiViewFusionService._dedupe_keep_order(cleaned_sentences)
        return ". ".join(cleaned_sentences).strip()

    @staticmethod
    def _pick_majority_value(values: List[str]) -> Optional[str]:
        cleaned = [str(v).strip() for v in values if str(v).strip()]
        if not cleaned:
            return None
        counts = Counter(cleaned)
        winner, count = sorted(
            counts.items(),
            key=lambda item: (-int(item[1]), -len(item[0]), item[0]),
        )[0]
        if int(count) >= 2:
            return winner
        return None

    def _select_detail_scope_best_view(self, scope_views: List[PP2PerViewResult]) -> Optional[PP2PerViewResult]:
        if not scope_views:
            return None
        ranked = sorted(
            scope_views,
            key=lambda view: (float(view.quality_score), float(view.detection.confidence)),
            reverse=True,
        )
        return ranked[0]

    def _collect_supported_field_values(
        self,
        scope_views: List[PP2PerViewResult],
        *,
        field_name: str,
        best_view: Optional[PP2PerViewResult],
        support_needed: int,
    ) -> tuple[List[str], List[str]]:
        support_counts: Dict[str, int] = defaultdict(int)
        display_map: Dict[str, str] = {}
        best_view_values: List[str] = []

        for view in scope_views:
            grounded = view.extraction.grounded_features or {}
            current_values = self._to_clean_str_list(grounded.get(field_name))
            current_values = self._dedupe_keep_order(current_values)
            seen_norms: Set[str] = set()
            for value in current_values:
                norm = str(value).strip().lower()
                if not norm or norm in seen_norms:
                    continue
                seen_norms.add(norm)
                support_counts[norm] += 1
                display_map.setdefault(norm, value)
            if best_view is not None and int(view.view_index) == int(best_view.view_index):
                best_view_values = current_values

        consensus_values = [
            display_map[norm]
            for norm, count in support_counts.items()
            if int(count) >= max(1, int(support_needed))
        ]
        consensus_values = self._dedupe_keep_order(consensus_values)
        fallback_values = self._dedupe_keep_order(best_view_values) if not consensus_values else []
        return consensus_values, fallback_values

    def _collect_angle_specific_field_values(
        self,
        scope_views: List[PP2PerViewResult],
        *,
        field_name: str,
        excluded_values: List[str],
        exclude_view_index: Optional[int] = None,
    ) -> List[str]:
        ranked_views = sorted(
            scope_views,
            key=lambda view: (float(view.quality_score), float(view.detection.confidence)),
            reverse=True,
        )
        excluded_norms = {str(value).strip().lower() for value in excluded_values if str(value).strip()}
        collected: List[str] = []
        seen_norms: Set[str] = set(excluded_norms)

        for view in ranked_views:
            if exclude_view_index is not None and int(view.view_index) == int(exclude_view_index):
                continue
            grounded = view.extraction.grounded_features or {}
            for value in self._dedupe_keep_order(self._to_clean_str_list(grounded.get(field_name))):
                norm = str(value).strip().lower()
                if not norm or norm in seen_norms:
                    continue
                seen_norms.add(norm)
                collected.append(value)

        return collected

    def _collect_caption_ocr_tokens(
        self,
        scope_views: List[PP2PerViewResult],
        fallback_tokens: List[str],
    ) -> List[str]:
        token_counts: Counter = Counter()
        for view in scope_views:
            kept_tokens, _ = self._collect_view_ocr_tokens(getattr(view.extraction, "ocr_text", "") or "")
            for token in kept_tokens:
                token_counts[token] += 1

        if not token_counts:
            return [str(tok).strip() for tok in (fallback_tokens or []) if str(tok).strip()][:2]

        support_needed = 2 if len(scope_views) >= 2 else 1
        ranked_tokens = sorted(token_counts.items(), key=lambda item: (-int(item[1]), -len(item[0]), item[0]))
        selected = [tok for tok, count in ranked_tokens if int(count) >= support_needed]
        if not selected and ranked_tokens:
            selected = [ranked_tokens[0][0]]
        return selected[:2]

    def build_conservative_caption(
        self,
        category: str,
        color: str,
        brand: Optional[str],
        ocr_tokens: List[str],
        features: List[str],
        defects: Optional[List[str]] = None,
        attachments: Optional[List[str]] = None,
    ) -> str:
        """
        Build a concise evidence-locked caption (PP1-style quality) from structured fields only.
        """
        category_text = self._humanize_category(category)
        color_text = str(color or "").strip()
        brand_text = str(brand or "").strip()

        descriptor_parts: List[str] = []
        if color_text:
            descriptor_parts.append(color_text.lower())
        if brand_text:
            descriptor_parts.append(brand_text)
        descriptor_parts.append(category_text)
        descriptor = " ".join([part for part in descriptor_parts if part]).strip()
        if not descriptor:
            descriptor = "item"

        plural_like = category_text.endswith("s") or ("earbuds" in category_text)
        first_sentence = f"{'These' if plural_like else 'This'} {descriptor}."

        feature_values = self._dedupe_keep_order(features or [])
        defect_values = self._dedupe_keep_order(defects or [])
        attachment_values = self._dedupe_keep_order(attachments or [])
        ocr_values = self._dedupe_keep_order([str(tok).strip() for tok in (ocr_tokens or []) if str(tok).strip()])

        evidence_clauses: List[str] = []
        if feature_values:
            evidence_clauses.append(f"features {self._join_natural(feature_values[:3])}")
        if attachment_values:
            evidence_clauses.append(f"includes {self._join_natural(attachment_values[:2])}")
        if defect_values:
            evidence_clauses.append(f"shows {self._join_natural(defect_values[:2])}")
        if ocr_values:
            evidence_clauses.append(f'has the text "{ocr_values[0]}"')

        if not evidence_clauses:
            return first_sentence
        return f"{first_sentence} It {self._join_natural(evidence_clauses)}."

    def fuse(
        self,
        per_view: List[PP2PerViewResult],
        vectors: List[np.ndarray],
        item_id: str,
        view_meta_by_index: Optional[Dict[int, Dict[str, Any]]] = None,
        used_view_indices: Optional[List[int]] = None,
    ) -> PP2FusedProfile:
        """
        Fuses results from multiple views into a single consistent profile.
        
        Args:
            per_view: List of results from each view (detection, extraction, quality, etc.)
            vectors: List of embedding vectors (numpy arrays) corresponding to the views.
            
        Returns:
            PP2FusedProfile: The consolidated item profile.
        """
        if not per_view:
            raise ValueError("Cannot fuse empty view list")

        # 1. Determine Best View
        # Rule: Highest quality_score; tie-breaker = highest detection confidence
        # We sort descending, so first element is best.
        sorted_views = sorted(
            per_view,
            key=lambda x: (x.quality_score, x.detection.confidence),
            reverse=True
        )
        best_view = sorted_views[0]

        # 2. Merge OCR Tokens
        per_view_kept_tokens: Dict[int, Set[str]] = {}
        rejected_tokens: Set[str] = set()
        token_to_views: Dict[str, Set[int]] = defaultdict(set)

        for res in per_view:
            kept_tokens, rejected = self._collect_view_ocr_tokens(res.extraction.ocr_text or "")
            per_view_kept_tokens[res.view_index] = kept_tokens
            rejected_tokens.update(rejected)
            for tok in kept_tokens:
                token_to_views[tok].add(res.view_index)

        ordered_view_indices = [r.view_index for r in sorted(per_view, key=lambda x: x.view_index)]
        tokens_per_view = [sorted(per_view_kept_tokens.get(idx, set())) for idx in ordered_view_indices]
        token_clusters = self._cluster_tokens_fuzzy(tokens_per_view=tokens_per_view, threshold=0.82)
        best_view_tokens = per_view_kept_tokens.get(best_view.view_index, set())

        supported_clusters: List[Dict[str, Any]] = []
        for cluster in token_clusters:
            cluster_views: Set[int] = set()
            for tok in cluster:
                cluster_views.update(token_to_views.get(tok, set()))

            support_count = len(cluster_views)
            has_best_view_brand_token = any(
                (tok in best_view_tokens) and self._is_brand_like(tok)
                for tok in cluster
            )
            if support_count >= 2 or has_best_view_brand_token:
                supported_clusters.append(
                    {
                        "rep": self._select_cluster_representative(cluster),
                        "support_count": support_count,
                        "best_view_present": best_view.view_index in cluster_views,
                    }
                )

        supported_clusters.sort(
            key=lambda item: (
                -int(item["support_count"]),
                -int(item["best_view_present"]),
                str(item["rep"]),
            )
        )
        merged_ocr_tokens = [str(item["rep"]) for item in supported_clusters[:2]]

        # 3. Caption storage
        all_captions = {
            f"view_{r.view_index}": r.extraction.caption 
            for r in per_view 
            if r.extraction.caption
        }

        # 4. Attributes Merging
        # Merge grounded_features dict keys
        merged_attributes = {}
        conflicts = {}

        # 5. Top-Level Fields (Brand, Color, Category)
        # Rule: Majority vote across non-null values; if no majority, pick best_view value and mark conflict
        categories = [r.detection.cls_name for r in per_view if r.detection.cls_name]
        # Resolve category first because it gates category-specific field merging.
        merged_attributes["conflicts"] = conflicts
        final_category = self._resolve_majority_vote(categories, best_view.detection.cls_name, "category", merged_attributes)
        
        # Determine which views are eligible for category-specific merges.
        category_specific_keys = {"defects", "features", "attachments"}
        eligible_category_views: Set[int] = set()
        excluded_reasons_by_view: Dict[int, List[str]] = {}
        meta_lookup = view_meta_by_index if isinstance(view_meta_by_index, dict) else {}
        for r in per_view:
            meta = meta_lookup.get(r.view_index, {})
            final_label = str(meta.get("final_label", r.detection.cls_name))
            is_outlier = bool(meta.get("label_outlier", False))

            reasons: List[str] = []
            if is_outlier:
                reasons.append("outlier")
            if final_label != final_category:
                reasons.append("label_mismatch")

            if reasons:
                excluded_reasons_by_view[r.view_index] = reasons
            else:
                eligible_category_views.add(r.view_index)
        
        # Collect all keys from all views' grounded_features
        all_keys = set()
        for r in per_view:
            if r.extraction.grounded_features:
                all_keys.update(r.extraction.grounded_features.keys())

        for key in all_keys:
            # Collect values for this key from all views (ignore None)
            values = []
            for r in per_view:
                if key in category_specific_keys and r.view_index not in eligible_category_views:
                    continue
                val = r.extraction.grounded_features.get(key)
                if val is not None:
                    values.append(val)
            
            # Deduplicate values
            # (Using string representation for unhashable types if necessary, though simplistic set works for primitives)
            try:
                unique_values = sorted(list(set(values)))
            except TypeError:
                 # Fallback for unhashable types (like lists/dicts), store strict list
                 unique_values = values

            if not unique_values:
                continue
            
            if len(unique_values) == 1:
                merged_attributes[key] = unique_values[0]
            else:
                # Conflict found
                merged_attributes[key] = unique_values
                conflicts[key] = "Conflicting values found across views"

        if excluded_reasons_by_view:
            excluded_view_indices = sorted(excluded_reasons_by_view.keys())
            reason_parts = [f"{idx}:{'/'.join(excluded_reasons_by_view[idx])}" for idx in excluded_view_indices]
            conflicts["category_specific_exclusions"] = (
                f"Excluded category-specific fields from views {excluded_view_indices} "
                f"due to outlier/label mismatch ({', '.join(reason_parts)})."
            )

        merged_attributes["conflicts"] = conflicts
        merged_attributes["captions"] = all_captions
        merged_attributes["ocr_rejected"] = sorted(list(rejected_tokens))

        # Top-Level Fields (Brand, Color)
        # Rule: Majority vote across non-null values; if no majority, pick best_view value and mark conflict
        # Try to find brand/color in grounded_features if not explicit elsewhere:
        brands = [r.extraction.grounded_features.get("brand") for r in per_view if r.extraction.grounded_features.get("brand")]
        colors = [r.extraction.grounded_features.get("color") for r in per_view if r.extraction.grounded_features.get("color")]
        
        best_brand = best_view.extraction.grounded_features.get("brand")
        final_brand = self._resolve_majority_vote(brands, best_brand, "brand", merged_attributes)
        
        best_color = best_view.extraction.grounded_features.get("color")
        final_color = self._resolve_majority_vote(colors, best_color, "color", merged_attributes)

        # Fallback: extract color from captions when grounded_features had no color
        if not final_color:
            for r in per_view:
                cap_text = str(getattr(r.extraction, "caption", "") or "").strip()
                if cap_text:
                    extracted = extract_color_from_text(cap_text)
                    if extracted:
                        final_color = extracted
                        break

        # Caption evidence scope: prefer verifier-selected decision pair when available.
        valid_used_indices = sorted(
            {int(idx) for idx in (used_view_indices or []) if isinstance(idx, int) and 0 <= int(idx) < len(per_view)}
        )
        used_scope_set = set(valid_used_indices)
        caption_scope_views = [r for r in per_view if r.view_index in used_scope_set] if used_scope_set else list(per_view)

        scope_brands = [
            str((r.extraction.grounded_features or {}).get("brand") or "").strip()
            for r in caption_scope_views
            if str((r.extraction.grounded_features or {}).get("brand") or "").strip()
        ]
        scope_colors = [
            normalize_color(str((r.extraction.grounded_features or {}).get("color") or "").strip())
            for r in caption_scope_views
            if str((r.extraction.grounded_features or {}).get("color") or "").strip()
        ]
        scope_colors = [c for c in scope_colors if c]
        caption_brand = self._pick_most_common(scope_brands) or final_brand
        caption_color = self._pick_most_common(scope_colors) or final_color

        # Fallback: extract color from scope captions if still missing
        if not caption_color:
            for r in caption_scope_views:
                cap_text = str(getattr(r.extraction, "caption", "") or "").strip()
                if cap_text:
                    extracted = extract_color_from_text(cap_text)
                    if extracted:
                        caption_color = extracted
                        break

        caption_features: List[str] = []
        caption_attachments: List[str] = []
        for res in caption_scope_views:
            grounded = res.extraction.grounded_features or {}
            caption_features.extend(self._to_clean_str_list(grounded.get("features")))
            caption_attachments.extend(self._to_clean_str_list(grounded.get("attachments")))
        if not caption_features:
            caption_features = self._to_clean_str_list(merged_attributes.get("features"))
        if not caption_attachments:
            caption_attachments = self._to_clean_str_list(merged_attributes.get("attachments"))
        caption_features = self._dedupe_keep_order(caption_features)
        caption_attachments = self._dedupe_keep_order(caption_attachments)
        caption_ocr_tokens = self._collect_caption_ocr_tokens(caption_scope_views, merged_ocr_tokens)
        if final_category in self._CARD_LABELS:
            merged_ocr_tokens = self._merge_card_ocr_tokens(per_view, best_view.view_index)
            caption_ocr_tokens = merged_ocr_tokens[:2]

        # 6. Defects (consensus-based across eligible views)
        eligible_view_count = len(eligible_category_views)
        defect_view_counts: Dict[str, int] = defaultdict(int)
        defect_display_map: Dict[str, str] = {}

        for r in per_view:
            if r.view_index not in eligible_category_views:
                continue
            defects_list = r.extraction.grounded_features.get("defects", [])
            if not isinstance(defects_list, list):
                continue

            per_view_seen: Set[str] = set()
            for d in defects_list:
                if not isinstance(d, str):
                    continue
                display = d.strip()
                if not display:
                    continue
                norm = display.lower()
                if norm in per_view_seen:
                    continue
                per_view_seen.add(norm)
                defect_view_counts[norm] += 1
                if norm not in defect_display_map:
                    defect_display_map[norm] = display

        if eligible_view_count <= 1:
            sorted_defects: List[str] = []
            if defect_view_counts:
                conflicts["defects"] = "Consensus-based; single-view defects suppressed"
        else:
            consensus_defects = [
                defect_display_map[norm]
                for norm, count in defect_view_counts.items()
                if count >= 2
            ]
            sorted_defects = sorted(consensus_defects)

        main_caption = self.build_conservative_caption(
            category=final_category,
            color=str(caption_color or ""),
            brand=caption_brand,
            ocr_tokens=caption_ocr_tokens,
            features=caption_features,
            defects=sorted_defects,
            attachments=caption_attachments,
        )
        caption_snippets = self._dedupe_keep_order(
            [
                self._extract_caption_snippet(getattr(res.extraction, "caption", "") or "")
                for res in caption_scope_views
            ]
        )
        if not caption_features and not caption_attachments and not sorted_defects and len(caption_snippets) == 1:
            main_caption = f"{main_caption} It has {caption_snippets[0]}."
            merged_attributes["caption_enrichment_mode"] = "conservative_plus_caption_snippet"
            merged_attributes["caption_snippets_used"] = caption_snippets
        else:
            merged_attributes["caption_enrichment_mode"] = "conservative_only"
            merged_attributes["caption_snippets_used"] = []

        detailed_scope_views = [
            r for r in caption_scope_views
            if r.view_index in eligible_category_views
        ] or caption_scope_views
        detail_best_view = self._select_detail_scope_best_view(detailed_scope_views)
        support_needed = 2 if len(detailed_scope_views) >= 2 else 1

        detailed_brand = self._pick_majority_value(scope_brands)
        if not detailed_brand and detail_best_view is not None:
            detailed_brand = str((detail_best_view.extraction.grounded_features or {}).get("brand") or "").strip() or None

        detailed_color = self._pick_majority_value(scope_colors)
        if not detailed_color and detail_best_view is not None:
            best_view_color = normalize_color(str((detail_best_view.extraction.grounded_features or {}).get("color") or "").strip())
            if best_view_color:
                detailed_color = best_view_color
            else:
                best_view_caption = str(getattr(detail_best_view.extraction, "caption", "") or "").strip()
                if best_view_caption:
                    detailed_color = extract_color_from_text(best_view_caption)

        consensus_features, best_view_feature_fallback = self._collect_supported_field_values(
            detailed_scope_views,
            field_name="features",
            best_view=detail_best_view,
            support_needed=support_needed,
        )
        consensus_attachments, best_view_attachment_fallback = self._collect_supported_field_values(
            detailed_scope_views,
            field_name="attachments",
            best_view=detail_best_view,
            support_needed=support_needed,
        )
        consensus_defects, best_view_defect_fallback = self._collect_supported_field_values(
            detailed_scope_views,
            field_name="defects",
            best_view=detail_best_view,
            support_needed=support_needed,
        )

        detailed_description_filters: List[str] = ["consensus_only"]
        detailed_features_for_description = consensus_features[:]
        detailed_attachments_for_description = consensus_attachments[:]
        detailed_defects_for_description = consensus_defects[:]
        if not detailed_features_for_description and best_view_feature_fallback:
            detailed_features_for_description = best_view_feature_fallback[:3]
            detailed_description_filters.append("best_view_feature_fallback")
        if not detailed_attachments_for_description and best_view_attachment_fallback:
            detailed_attachments_for_description = best_view_attachment_fallback[:2]
            detailed_description_filters.append("best_view_attachment_fallback")
        if not detailed_defects_for_description and best_view_defect_fallback:
            detailed_defects_for_description = best_view_defect_fallback[:2]
            detailed_description_filters.append("best_view_defect_fallback")

        angle_specific_features = self._collect_angle_specific_field_values(
            detailed_scope_views,
            field_name="features",
            excluded_values=detailed_features_for_description,
            exclude_view_index=detail_best_view.view_index if detail_best_view is not None else None,
        )
        if angle_specific_features:
            detailed_features_for_description = self._dedupe_keep_order(
                detailed_features_for_description + angle_specific_features[:3]
            )
            detailed_description_filters.append("other_angle_feature_fusion")

        angle_specific_attachments = self._collect_angle_specific_field_values(
            detailed_scope_views,
            field_name="attachments",
            excluded_values=detailed_attachments_for_description,
            exclude_view_index=detail_best_view.view_index if detail_best_view is not None else None,
        )
        if angle_specific_attachments:
            detailed_attachments_for_description = self._dedupe_keep_order(
                detailed_attachments_for_description + angle_specific_attachments[:2]
            )
            detailed_description_filters.append("other_angle_attachment_fusion")

        angle_specific_defects = self._collect_angle_specific_field_values(
            detailed_scope_views,
            field_name="defects",
            excluded_values=detailed_defects_for_description,
            exclude_view_index=detail_best_view.view_index if detail_best_view is not None else None,
        )
        if angle_specific_defects:
            detailed_defects_for_description = self._dedupe_keep_order(
                detailed_defects_for_description + angle_specific_defects[:2]
            )
            detailed_description_filters.append("other_angle_defect_fusion")

        detailed_ocr_text = " ".join(merged_ocr_tokens[:2]).strip()
        detailed_caption = ""
        if detail_best_view is not None:
            detailed_caption = self._sanitize_object_text(
                str(getattr(detail_best_view.extraction, "caption", "") or "")
            )

        # Use the best view's Florence description directly if available,
        # otherwise fall back to the caption
        best_view_description = ""
        if detail_best_view is not None:
            best_view_description = self._sanitize_object_text(str(
                getattr(detail_best_view.extraction, "detailed_description", "")
                or getattr(detail_best_view.extraction, "final_description", "")
                or ""
            ).strip())
        if not best_view_description:
            best_view_description = detailed_caption

        if not best_view_description:
            best_view_description = self.build_conservative_caption(
                final_category,
                detailed_color or final_color,
                detailed_brand or final_brand,
                merged_ocr_tokens,
                detailed_features_for_description,
                detailed_defects_for_description,
                detailed_attachments_for_description,
            )

        # ── Ensure colour + category open the description ────────────
        # If the best-view text doesn't mention the item's colour in its
        # opening sentence, prepend a structured "A {colour} {category}."
        _obj_color = (detailed_color or final_color or "").strip()
        if _obj_color and best_view_description:
            _opening = best_view_description.split(".")[0].lower()
            if _obj_color.lower() not in _opening:
                _obj_brand = (detailed_brand or final_brand or "").strip()
                _cat_text = self._humanize_category(final_category)
                _adj = [_obj_color.lower()]
                if _obj_brand:
                    _adj.append(_obj_brand)
                _adj.append(_cat_text)
                best_view_description = f"A {' '.join(_adj)}. {best_view_description}"

        detail_text_lower = best_view_description.lower()

        # ── Multi-angle caption merging ──────────────────────────────
        # Collect unique descriptive facts from OTHER scope views'
        # captions / detailed_descriptions that aren't in the best-view text.
        other_angle_phrases: List[str] = []
        best_view_idx = detail_best_view.view_index if detail_best_view is not None else -1
        for res in detailed_scope_views:
            if res.view_index == best_view_idx:
                continue
            # Prefer the view's detailed_description; fall back to caption
            other_desc = self._sanitize_object_text(str(
                getattr(res.extraction, "detailed_description", "")
                or getattr(res.extraction, "caption", "")
                or ""
            ).strip())
            if not other_desc or len(other_desc.split()) < 3:
                continue
            # Extract the descriptive portion after "with …" if present
            snippet = self._extract_caption_snippet(other_desc)
            if snippet and snippet.lower() not in detail_text_lower:
                other_angle_phrases.append(snippet)
                continue
            # Fallback: use the whole description if it's substantial and
            # contains information not already in the base text.
            # Split into sentences and keep those with novel tokens.
            for sentence in re.split(r'(?<=[.!?])\s+', other_desc):
                sentence = sentence.strip().rstrip(". ")
                if not sentence or len(sentence.split()) < 3:
                    continue
                sentence_lower = sentence.lower()
                # Keep sentence if >40% of its content words are novel
                content_words = [w for w in re.findall(r'[a-z]{3,}', sentence_lower)
                                 if w not in {'the', 'and', 'with', 'from', 'that', 'this', 'its', 'for', 'are', 'has', 'was'}]
                if content_words:
                    novel_ratio = sum(1 for w in content_words if w not in detail_text_lower) / len(content_words)
                    if novel_ratio > 0.4:
                        other_angle_phrases.append(sentence)
                        # Update the lower-text tracker so later views don't repeat
                        detail_text_lower = (detail_text_lower + " " + sentence_lower)

        # Deduplicate and cap at 3 angle phrases
        other_angle_phrases = self._dedupe_keep_order(other_angle_phrases)[:3]
        merged_attributes["multi_angle_phrases_used"] = list(other_angle_phrases)

        detail_sentences: List[str] = []

        if other_angle_phrases:
            detail_sentences.extend(
                phrase if phrase.endswith(".") else f"{phrase}."
                for phrase in other_angle_phrases
            )
            detailed_description_filters.append("multi_angle_fusion")

        unseen_features = [value for value in detailed_features_for_description if str(value).lower() not in detail_text_lower]
        if unseen_features:
            detail_sentences.append(f"It also has {self._join_natural(unseen_features[:4])}.")

        unseen_attachments = [value for value in detailed_attachments_for_description if str(value).lower() not in detail_text_lower]
        if unseen_attachments:
            detail_sentences.append(f"It also includes {self._join_natural(unseen_attachments[:2])}.")

        unseen_defects = [value for value in detailed_defects_for_description if str(value).lower() not in detail_text_lower]
        if unseen_defects:
            detail_sentences.append(f"It shows {self._join_natural(unseen_defects[:2])}.")

        if detailed_ocr_text and detailed_ocr_text.lower() not in detail_text_lower:
            detail_sentences.append(f'The text "{detailed_ocr_text}" is visible on the surface.')

        detailed_description_text = best_view_description.rstrip(". ")
        detailed_description_parts = [part for part in [detailed_description_text] if part]
        detailed_description_parts.extend(sentence.strip() for sentence in detail_sentences if sentence.strip())
        detailed_description_text = " ".join(
            part if part.endswith(".") else f"{part}."
            for part in detailed_description_parts
        ).strip()

        detailed_evidence: List[str] = []
        if best_view_description:
            detailed_evidence.append("best_view_description")
        elif detailed_caption:
            detailed_evidence.append("florence_caption")
        if other_angle_phrases:
            detailed_evidence.append("multi_angle_views")
        if detailed_features_for_description:
            detailed_evidence.append("grounded_features")
        if detailed_attachments_for_description:
            detailed_evidence.append("grounded_attachments")
        if detailed_defects_for_description:
            detailed_evidence.append("grounded_defects")
        if detailed_ocr_text:
            detailed_evidence.append("ocr_text")

        desc_source = "multi_angle_evidence_composer" if other_angle_phrases else "best_view_evidence_composer"
        detailed_description_bundle = {
            "detailed_description": detailed_description_text,
            "detailed_description_source": desc_source,
            "description_evidence_used": {"summary": detailed_evidence, "detailed": detailed_evidence},
            "description_filters_applied": ["best_view_evidence_composer"],
            "description_word_count": {
                "final_description": len(detailed_description_text.split()),
                "detailed_description": len(detailed_description_text.split()),
            },
            "description_timings_ms": {},
        }
        detailed_description_filters.extend(
            detailed_description_bundle.get("description_filters_applied", []) or []
        )
        merged_attributes["description_scope_view_indices"] = [int(v.view_index) for v in detailed_scope_views]
        merged_attributes["description_timings_ms"] = detailed_description_bundle.get("description_timings_ms", {})

        # 7. Fused Embedding metadata (actual fused-vector math is exposed via compute_fused_vector)
        fused_embedding_id = f"{item_id}_fused"

        return PP2FusedProfile(
            category=final_category,
            brand=final_brand,
            color=final_color,
            caption=main_caption,
            detailed_description=detailed_description_bundle.get("detailed_description"),
            description_source="consensus_conservative_caption",
            detailed_description_source=detailed_description_bundle.get("detailed_description_source"),
            description_evidence_used=detailed_description_bundle.get("description_evidence_used"),
            description_filters_applied=self._dedupe_keep_order(detailed_description_filters),
            description_word_count=detailed_description_bundle.get("description_word_count"),
            merged_ocr_tokens=merged_ocr_tokens,
            attributes=merged_attributes,
            defects=sorted_defects,
            best_view_index=best_view.view_index,
            fused_embedding_id=fused_embedding_id
        )

    def _resolve_majority_vote(self, values: List[str], best_value: Optional[str], field_name: str, attributes: Dict) -> Optional[str]:
        """
        Helper to resolve majority vote.
        - values: list of non-null candidates
        - best_value: fallback value from best view
        - field_name: name for conflict logging
        - attributes: dict to append conflict info to
        """
        if not values:
            return best_value

        # Normalize color values before voting to collapse aliases
        if field_name == "color":
            values = [normalize_color(v) or v for v in values]
            if best_value:
                best_value = normalize_color(best_value) or best_value

        counts = Counter(values)
        total = len(values)
        
        # Check for strict majority (> 50%)
        # Or simple plurality? Prompt says "majority vote". Usually means > 50%.
        # Prompt: "if no majority, pick best_view value"
        # 3 items: Needs 2 matches.
        
        most_common = counts.most_common(1)
        if not most_common:
            return best_value
            
        winner, count = most_common[0]
        
        # Strict majority check
        if count > (total / 2):
            return winner
        else:
            # No majority
            # Mark conflict
            conflict_entry = attributes.get("conflicts", {})
            conflict_entry[field_name] = f"No majority. Candidates: {dict(counts)}. Picked best view: {best_value}"
            attributes["conflicts"] = conflict_entry
            return best_value

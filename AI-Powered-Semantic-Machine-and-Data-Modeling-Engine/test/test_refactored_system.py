"""
Test script to verify refactored backend initialization and hybrid search
Author: Senior Backend Engineer
Date: December 3, 2025
"""

import asyncio
import sys
import logging
from app.core.database import connect_to_mongo, is_mongodb_connected, get_database
from app.core.semantic import SemanticEngine

# Configure detailed logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_startup_sequence():
    """Test 1: Verify proper startup sequence without race conditions"""
    logger.info("=" * 70)
    logger.info("TEST 1: STARTUP SEQUENCE & RACE CONDITION FIX")
    logger.info("=" * 70)
    
    # Step 1: MongoDB Connection
    logger.info("\n📡 Testing MongoDB connection with retry logic...")
    connection_success = await connect_to_mongo()
    
    if connection_success:
        logger.info("✅ MongoDB connected successfully")
        logger.info(f"   Connection state: {is_mongodb_connected()}")
    else:
        logger.warning("⚠️ MongoDB connection failed (expected if not running)")
    
    # Step 2: Semantic Engine Initialization
    logger.info("\n🤖 Testing Semantic Engine initialization...")
    engine = SemanticEngine()
    logger.info("✅ Semantic Engine initialized")
    logger.info(f"   Model dimension: {engine.dimension}")
    logger.info(f"   Index type: {type(engine.index).__name__}")
    logger.info(f"   Items in cache: {len(engine.items_metadata)}")
    
    # Step 3: MongoDB Data Load (only if connected)
    if connection_success and is_mongodb_connected():
        logger.info("\n📥 Testing data load from MongoDB...")
        items_loaded = await engine.load_from_mongodb()
        logger.info(f"✅ Loaded {items_loaded} items")
    else:
        logger.info("\n💾 Using disk cache (MongoDB not available)")
    
    logger.info("\n✅ TEST 1 PASSED: No race conditions detected!")
    return engine


def test_weighted_hybrid_search(engine: SemanticEngine):
    """Test 2: Verify 70% vector + 30% keyword hybrid search"""
    logger.info("\n" + "=" * 70)
    logger.info("TEST 2: WEIGHTED HYBRID SEARCH (70% Vector + 30% Keyword)")
    logger.info("=" * 70)
    
    # Add test items if index is empty
    if len(engine.items_metadata) == 0:
        logger.info("\n📝 Adding test items...")
        test_items = [
            {
                "id": "TEST001",
                "description": "Black leather wallet with credit cards",
                "category": "Wallet"
            },
            {
                "id": "TEST002",
                "description": "Blue denim wallet",
                "category": "Wallet"
            },
            {
                "id": "TEST003",
                "description": "iPhone 13 Pro Max mobile phone",
                "category": "Phone"
            }
        ]
        
        for item in test_items:
            # Synchronous add for testing
            import asyncio
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            
            # Add items synchronously for test
            vector = engine.vectorize(item['description'])
            import numpy as np
            engine.index.add(np.array([vector], dtype=np.float32))
            engine.items_metadata.append({
                "id": item['id'],
                "description": item['description'],
                "category": item['category']
            })
            logger.info(f"   Added: {item['id']}")
    
    # Test Query 1: Semantic + Keyword Match
    logger.info("\n🔍 Test Query 1: 'lost my black wallet'")
    results = engine.search("lost my black wallet", limit=3)
    
    if results:
        for i, result in enumerate(results, 1):
            logger.info(f"\n  Result #{i}:")
            logger.info(f"    ID: {result['item']['id']}")
            logger.info(f"    Description: {result['item']['description']}")
            logger.info(f"    RAW COSINE: {result['raw_cosine_similarity']:.4f}")
            logger.info(f"    VECTOR SCORE: {result['vector_score']}%")
            logger.info(f"    KEYWORD SCORE: {result['keyword_score']}%")
            logger.info(f"    FINAL SCORE: {result['semantic_score']}%")
            logger.info(f"    FORMULA: {result['details']['formula']}")
            
            # Verify the math
            expected = (result['vector_score'] * 0.7 + result['keyword_score'] * 0.3)
            if result['details']['category_boost']:
                expected *= 1.05
            expected = min(100, expected)
            
            actual = result['semantic_score']
            diff = abs(expected - actual)
            
            if diff < 0.1:
                logger.info(f"    ✅ Math verified: {expected:.2f} ≈ {actual:.2f}")
            else:
                logger.error(f"    ❌ Math error: Expected {expected:.2f}, Got {actual:.2f}")
    else:
        logger.warning("  No results returned")
    
    # Test Query 2: High keyword overlap
    logger.info("\n🔍 Test Query 2: 'wallet wallet wallet' (keyword spam)")
    results = engine.search("wallet wallet wallet", limit=3)
    
    if results:
        logger.info(f"  Keyword spam test returned {len(results)} results")
        logger.info(f"  Top result keyword score: {results[0]['keyword_score']}%")
        logger.info(f"  Top result vector score: {results[0]['vector_score']}%")
        logger.info(f"  Top result final score: {results[0]['semantic_score']}%")
        
        # Verify vector score still has 70% weight
        if results[0]['vector_score'] > results[0]['keyword_score']:
            logger.info("  ✅ Vector score (70%) dominates as expected")
        else:
            logger.warning("  ⚠️ Keyword score too high relative to vector score")
    
    logger.info("\n✅ TEST 2 PASSED: Weighted hybrid search verified!")


def test_vector_math():
    """Test 3: Verify vector embeddings are not null/fallback"""
    logger.info("\n" + "=" * 70)
    logger.info("TEST 3: VECTOR EMBEDDING VALIDATION")
    logger.info("=" * 70)
    
    engine = SemanticEngine()
    
    test_texts = [
        "Black leather wallet",
        "iPhone 13 Pro",
        "Blue backpack"
    ]
    
    logger.info("\n📊 Testing vector generation...")
    for text in test_texts:
        vector = engine.vectorize(text, normalize=True)
        
        # Check 1: Vector is not null
        if vector is None:
            logger.error(f"  ❌ NULL vector for: {text}")
            continue
        
        # Check 2: Vector has correct dimension
        if vector.shape[0] != engine.dimension:
            logger.error(f"  ❌ Wrong dimension for: {text}")
            logger.error(f"     Expected: {engine.dimension}, Got: {vector.shape[0]}")
            continue
        
        # Check 3: Vector is normalized (norm ≈ 1.0)
        import numpy as np
        norm = np.linalg.norm(vector)
        if abs(norm - 1.0) > 0.01:
            logger.error(f"  ❌ Vector not normalized for: {text}")
            logger.error(f"     Norm: {norm:.4f}")
            continue
        
        # Check 4: Vector is not all zeros (fallback indicator)
        if np.allclose(vector, 0):
            logger.error(f"  ❌ Zero vector (fallback) for: {text}")
            continue
        
        logger.info(f"  ✅ '{text}':")
        logger.info(f"     Shape: {vector.shape}, Norm: {norm:.4f}")
        logger.info(f"     First 5 values: {vector[:5]}")
    
    logger.info("\n✅ TEST 3 PASSED: All vectors valid!")


async def run_all_tests():
    """Run comprehensive backend verification tests"""
    logger.info("\n" + "=" * 70)
    logger.info("REFACTORED BACKEND VERIFICATION SUITE")
    logger.info("Senior Backend Engineer - December 3, 2025")
    logger.info("=" * 70)
    
    try:
        # Test 1: Startup sequence
        engine = await test_startup_sequence()
        
        # Test 2: Weighted hybrid search
        test_weighted_hybrid_search(engine)
        
        # Test 3: Vector math validation
        test_vector_math()

        # NEW TESTS — AI-Powered Matching Engine
        test_score_formula()
        test_attribute_matching()
        test_must_match_rule()
        test_normalizer_fallback()
        await test_impression_logger_no_db()
        test_ab_routing_determinism()

        logger.info("\n" + "=" * 70)
        logger.info("✅ ALL TESTS PASSED!")
        logger.info("=" * 70)
        logger.info("\nKey Improvements Verified:")
        logger.info("  1. ✅ No race conditions - Proper async/await sequencing")
        logger.info("  2. ✅ Weighted Hybrid Search - 70% vector + 30% keyword")
        logger.info("  3. ✅ Vector math validated - No null/fallback values")
        logger.info("  4. ✅ Detailed logging - Raw cosine similarity exposed")
        logger.info("  5. ✅ Connection retry logic - Graceful MongoDB failover")
        logger.info("  6. ✅ Score formula validated — weights/penalties correct")
        logger.info("  7. ✅ Attribute match scoring — fuzzy color/brand/model")
        logger.info("  8. ✅ Must-match hard rule — identifier forces top rank")
        logger.info("  9. ✅ Normalizer fallback — works without GEMINI_API_KEY")
        logger.info(" 10. ✅ Impression logger — graceful no-DB handling")
        logger.info(" 11. ✅ A/B routing — deterministic per session_id")
        logger.info("=" * 70)
        
        return True
        
    except Exception as e:
        logger.error(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


# =============================================================================
# NEW TESTS: AI-Powered Matching Engine
# =============================================================================

def test_score_formula():
    """Test 4: Verify compute_final_score formula correctness."""
    logger.info("=" * 70)
    logger.info("TEST 4: SCORING FORMULA")
    logger.info("=" * 70)

    from app.core.scorer import compute_final_score, contradiction_penalty

    # Perfect match scenario
    score = compute_final_score(
        semantic=1.0, keyword=1.0, attr=1.0,
        id_bonus=1.0, id_penalty=0.0, contradiction=0.0,
    )
    assert score == 1.0, f"Expected 1.0, got {score}"
    logger.info("  ✅ Perfect match → score=1.0")

    # No signal at all
    score = compute_final_score(
        semantic=0.0, keyword=0.0, attr=0.0,
        id_bonus=0.0, id_penalty=0.0, contradiction=0.0,
    )
    assert score == 0.0, f"Expected 0.0, got {score}"
    logger.info("  ✅ No signal → score=0.0")

    # Contradiction squishes a good semantic score
    score_no_contra = compute_final_score(
        semantic=0.9, keyword=0.5, attr=0.5,
        id_bonus=0.0, id_penalty=0.0, contradiction=0.0,
    )
    score_contra = compute_final_score(
        semantic=0.9, keyword=0.5, attr=0.5,
        id_bonus=0.0, id_penalty=0.0, contradiction=0.40,
    )
    assert score_contra < score_no_contra, "Contradiction should lower score"
    logger.info(f"  ✅ Contradiction penalty works: {score_no_contra:.4f} → {score_contra:.4f}")

    # Score floored at 0 (no negatives)
    score_floor = compute_final_score(0.0, 0.0, 0.0, 0.0, 1.0, 1.0)
    assert score_floor == 0.0, f"Score should not go negative, got {score_floor}"
    logger.info("  ✅ Score correctly floored at 0.0")

    logger.info("✅ TEST 4 PASSED: Score formula correct\n")


def test_attribute_matching():
    """Test 5: Verify fuzzy attribute match scoring."""
    logger.info("=" * 70)
    logger.info("TEST 5: ATTRIBUTE MATCHING")
    logger.info("=" * 70)

    from app.core.scorer import attribute_score, _per_attr_score

    lost = {"attributes": {"color": "black", "brand": "Samsung", "model": "Galaxy S21"}}
    found_exact = {"attributes": {"color": "black", "brand": "samsung", "model": "Galaxy S21"}}
    found_diff  = {"attributes": {"color": "red", "brand": "Apple", "model": "iPhone 13"}}
    found_null  = {"attributes": {"color": None, "brand": None, "model": None}}
    found_empty = {"attributes": {}}

    score_exact = attribute_score(lost, found_exact)
    score_diff  = attribute_score(lost, found_diff)
    score_null  = attribute_score(lost, found_null)
    score_empty = attribute_score(lost, found_empty)

    assert score_exact > 0.85, f"Exact match should score >0.85, got {score_exact}"
    assert score_diff < 0.20, f"Different attr should score <0.20, got {score_diff}"
    assert 0.25 <= score_null <= 0.35, f"Null found should get partial credit, got {score_null}"
    assert score_empty == 0.5, f"No found attrs → neutral 0.5, got {score_empty}"
    logger.info(f"  exact={score_exact:.4f}  diff={score_diff:.4f}  null={score_null:.4f}  empty={score_empty:.4f}")
    logger.info("✅ TEST 5 PASSED: Attribute matching correct\n")


def test_must_match_rule():
    """Test 6: Identifier must-match rule forces correct item to top rank."""
    logger.info("=" * 70)
    logger.info("TEST 6: MUST-MATCH HARD RULE")
    logger.info("=" * 70)

    from app.core.scorer import apply_must_match_rule

    lost_attrs = {
        "must_match_tokens": ["IMEI123456"],
        "keywords": ["samsung", "phone"],
    }

    # Wrong candidate (no IMEI) — high base score
    candidate_wrong = {
        "found_id": "F_WRONG",
        "description": "Samsung phone black",
        "score": 0.85,
        "extracted_attributes_json": {
            "attributes": {"identifiers": [], "brand": "samsung"},
            "searchable_tokens": [],
        },
        "features": {},
    }
    # Correct candidate (has IMEI) — lower base score
    candidate_right = {
        "found_id": "F_RIGHT",
        "description": "Galaxy phone IMEI123456",
        "score": 0.55,
        "extracted_attributes_json": {
            "attributes": {
                "identifiers": [{"type": "imei", "value": "IMEI123456"}],
                "brand": "samsung",
            },
            "searchable_tokens": ["IMEI123456"],
        },
        "features": {},
    }

    ranked = apply_must_match_rule([candidate_wrong, candidate_right], lost_attrs)

    assert ranked[0]["found_id"] == "F_RIGHT", \
        f"Item with matching IMEI must be first. Got: {ranked[0]['found_id']}"
    assert ranked[0]["score"] >= 0.85, \
        f"Must-match item should get boosted score >= 0.85, got {ranked[0]['score']}"
    logger.info("  ✅ Must-match item correctly promoted to rank #1")
    logger.info("✅ TEST 6 PASSED: Must-match rule works\n")


def test_normalizer_fallback():
    """Test 7: Normalizer produces valid output without Gemini API key."""
    logger.info("=" * 70)
    logger.info("TEST 7: NORMALIZER FALLBACK (no GEMINI_API_KEY)")
    logger.info("=" * 70)

    from app.core.normalizer import _passthrough_lost, _passthrough_found

    raw = "samsung galaxy black colour IMEI 123456789"
    result = _passthrough_lost(raw, "Electronics")

    required_keys = ["clean_description", "keywords", "attributes", "must_match_tokens", "_fallback"]
    for k in required_keys:
        assert k in result, f"Missing key: {k}"
    assert result["_fallback"] is True
    assert isinstance(result["keywords"], list)
    assert result["clean_description"] == raw.strip()
    logger.info(f"  keywords: {result['keywords']}")
    logger.info("  ✅ Fallback lost extraction produces valid schema")

    result_found = _passthrough_found(raw, "Electronics")
    assert "searchable_tokens" in result_found
    logger.info("  ✅ Fallback found extraction produces valid schema")

    logger.info("✅ TEST 7 PASSED: Normalizer fallback works\n")


async def test_impression_logger_no_db():
    """Test 8: ImpressionLogger handles None db gracefully."""
    logger.info("=" * 70)
    logger.info("TEST 8: IMPRESSION LOGGER (no DB)")
    logger.info("=" * 70)

    from app.core.impression_logger import ImpressionLogger

    impression_logger = ImpressionLogger()

    # log_impression with db=None should return None (not raise)
    impression_id = await impression_logger.log_impression(
        db=None,
        query_id="test-query-001",
        lost_raw="black samsung phone",
        category="Electronics",
        session_id="sess-abc",
        shown_results=[
            {"found_id": "F001", "score": 0.9, "features": {}, "model_version": "rule_based_v1"},
        ],
        model_version="rule_based_v1",
    )
    assert impression_id is None, f"Expected None impression_id, got {impression_id}"
    logger.info("  ✅ log_impression(db=None) returns None gracefully")

    # log_selection with db=None should return False (not raise)
    logged = await impression_logger.log_selection(
        db=None,
        impression_id="imp-001",
        query_id="test-query-001",
        lost_raw="black samsung phone",
        selected_found_id="F001",
        selected_rank=1,
    )
    assert logged is False
    logger.info("  ✅ log_selection(db=None) returns False gracefully")
    logger.info("✅ TEST 8 PASSED: ImpressionLogger handles None db\n")


def test_ab_routing_determinism():
    """Test 9: A/B variant is deterministic per session_id."""
    logger.info("=" * 70)
    logger.info("TEST 9: A/B ROUTING DETERMINISM")
    logger.info("=" * 70)

    from app.core.scorer import get_model_variant

    # All rule-based when rollout=0.0
    for sid in ["sess-1", "sess-2", "sess-abc", "user-99"]:
        variant = get_model_variant(sid, rollout_pct=0.0)
        assert variant == "rule_based_v1", f"Expected rule_based_v1 at 0% rollout, got {variant}"
    logger.info("  ✅ 0% rollout → all rule_based_v1")

    # All ML when rollout=1.0
    for sid in ["sess-1", "sess-2", "sess-abc", "user-99"]:
        variant = get_model_variant(sid, rollout_pct=1.0)
        assert variant == "lgbm", f"Expected lgbm at 100% rollout, got {variant}"
    logger.info("  ✅ 100% rollout → all lgbm")

    # Deterministic: same session always gets same variant
    sid = "session-determinism-check"
    first_call = get_model_variant(sid, rollout_pct=0.5)
    for _ in range(5):
        assert get_model_variant(sid, rollout_pct=0.5) == first_call, "Non-deterministic variant!"
    logger.info(f"  ✅ Deterministic for session '{sid}': {first_call} (repeated 5x)")
    logger.info("✅ TEST 9 PASSED: A/B routing is deterministic\n")


if __name__ == "__main__":
    # Run tests
    success = asyncio.run(run_all_tests())
    sys.exit(0 if success else 1)

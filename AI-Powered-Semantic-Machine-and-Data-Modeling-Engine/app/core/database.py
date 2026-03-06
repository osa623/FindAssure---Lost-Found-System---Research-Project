from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, TEXT
from app.config import settings
import logging
import asyncio
import os

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Fix DNS resolution for MongoDB Atlas +srv connections
# dnspython (used by pymongo for SRV lookups) respects this env var
# to use public DNS servers instead of unreliable local resolvers.
# ---------------------------------------------------------------------------
if "MONGOB_SRV_RESOLVER" not in os.environ:
    try:
        import dns.resolver
        # Force Google + Cloudflare public DNS for SRV lookups
        dns.resolver.default_resolver = dns.resolver.Resolver(configure=False)
        dns.resolver.default_resolver.nameservers = ["8.8.8.8", "8.8.4.4", "1.1.1.1"]
        logger.info("DNS resolver configured to use Google/Cloudflare DNS for MongoDB SRV")
    except ImportError:
        logger.warning("dnspython not installed — SRV resolution may fail on some networks")

logger = logging.getLogger(__name__)

class MongoDB:
    client: AsyncIOMotorClient = None
    db = None
    _connected: bool = False

mongodb = MongoDB()

async def connect_to_mongo(max_retries: int = 3, retry_delay: int = 2) -> bool:
    """Connect to MongoDB on startup with retry logic

    Returns:
        bool: True if connection successful, False otherwise
    """
    for attempt in range(1, max_retries + 1):
        try:
            logger.info(f"Attempting MongoDB connection (attempt {attempt}/{max_retries})...")

            # Build connection kwargs — use certifi CA bundle for Atlas TLS
            connect_kwargs = dict(
                serverSelectionTimeoutMS=10000,
                connectTimeoutMS=10000,
            )
            try:
                import certifi
                connect_kwargs["tlsCAFile"] = certifi.where()
            except ImportError:
                pass

            # Create client with timeout
            mongodb.client = AsyncIOMotorClient(
                settings.MONGODB_URL,
                **connect_kwargs,
            )
            mongodb.db = mongodb.client[settings.DATABASE_NAME]

            # Test connection with ping - THIS IS CRITICAL
            await mongodb.client.admin.command('ping')
            logger.info("MongoDB ping successful")

            # ----------------------------------------------------------------
            # Core collection indexes (original)
            # ----------------------------------------------------------------
            found_items_col = mongodb.db[settings.FOUND_ITEMS_COLLECTION]
            await found_items_col.create_index([("item_id", ASCENDING)], unique=True, sparse=True)
            await found_items_col.create_index([("category", ASCENDING)])
            await found_items_col.create_index([("created_at", DESCENDING)])
            await found_items_col.create_index([("createdAt", DESCENDING)])

            # Full-text index on found_items for BM25-style keyword search
            # Covers description + searchable_tokens (added by batch extractor)
            try:
                await found_items_col.create_index(
                    [("description", TEXT), ("searchable_tokens", TEXT)],
                    name="found_items_text_search"
                )
            except Exception:
                pass  # index may already exist

            # ----------------------------------------------------------------
            # Gemini result cache collection
            # ----------------------------------------------------------------
            await mongodb.db.gemini_cache.create_index(
                [("cache_key", ASCENDING)], unique=True
            )
            # TTL index: documents auto-expire after gemini_cache_ttl_seconds
            await mongodb.db.gemini_cache.create_index(
                [("expires_at", ASCENDING)],
                expireAfterSeconds=0  # expire AT the expires_at date
            )

            # ----------------------------------------------------------------
            # Lost query log
            # ----------------------------------------------------------------
            await mongodb.db.lost_item_queries.create_index([("query_id", ASCENDING)], unique=True)
            await mongodb.db.lost_item_queries.create_index([("cache_key", ASCENDING)])
            await mongodb.db.lost_item_queries.create_index([("created_at", DESCENDING)])

            # ----------------------------------------------------------------
            # Match Impressions — critical for negative sampling
            # ----------------------------------------------------------------
            await mongodb.db.match_impressions.create_index(
                [("impression_id", ASCENDING)], unique=True
            )
            await mongodb.db.match_impressions.create_index([("query_id", ASCENDING)])
            await mongodb.db.match_impressions.create_index([("timestamp", DESCENDING)])

            # ----------------------------------------------------------------
            # Match Selections
            # ----------------------------------------------------------------
            await mongodb.db.match_selections.create_index([("impression_id", ASCENDING)])
            await mongodb.db.match_selections.create_index([("selected_found_id", ASCENDING)])
            await mongodb.db.match_selections.create_index([("query_id", ASCENDING)])

            # ----------------------------------------------------------------
            # Handover Verifications (may already exist)
            # ----------------------------------------------------------------
            await mongodb.db.handover_verifications.create_index([("lost_id", ASCENDING)])
            await mongodb.db.handover_verifications.create_index([("found_id", ASCENDING)])
            await mongodb.db.handover_verifications.create_index([("verified_at", DESCENDING)])

            logger.info("All database indexes created/verified")

            mongodb._connected = True
            logger.info(f"Connected to MongoDB: {settings.DATABASE_NAME}")
            return True

        except Exception as e:
            error_msg = str(e)
            logger.error(f"MongoDB connection attempt {attempt} failed: {error_msg}")

            # Provide actionable guidance for common errors
            if "TLSV1_ALERT_INTERNAL_ERROR" in error_msg:
                logger.error(
                    "╔═══════════════════════════════════════════════════╗\n"
                    "║  MongoDB Atlas IP WHITELIST issue detected.      ║\n"
                    "║  Your current IP is NOT in the Atlas whitelist.  ║\n"
                    "║                                                  ║\n"
                    "║  FIX: Go to MongoDB Atlas → Security →           ║\n"
                    "║       Network Access → Add Current IP            ║\n"
                    "║       (or add 0.0.0.0/0 for development)        ║\n"
                    "╚═══════════════════════════════════════════════════╝"
                )
            elif "DNS" in error_msg or "SRV" in error_msg:
                logger.error("DNS/SRV resolution failed. Check your internet connection.")

            if attempt < max_retries:
                logger.info(f"Retrying in {retry_delay} seconds...")
                await asyncio.sleep(retry_delay)
            else:
                logger.error("All MongoDB connection attempts failed")
                logger.info("System will run in standalone mode with disk cache")
                mongodb._connected = False
                return False

    return False

def is_mongodb_connected() -> bool:
    """Check if MongoDB is connected and ready"""
    return mongodb._connected and mongodb.client is not None and mongodb.db is not None

async def close_mongo_connection():
    """Close MongoDB connection on shutdown"""
    if mongodb.client:
        mongodb.client.close()
        logger.info("MongoDB connection closed")

def get_database():
    """Get database instance

    Returns:
        Database instance if connected, None otherwise
    """
    if is_mongodb_connected():
        return mongodb.db
    return None

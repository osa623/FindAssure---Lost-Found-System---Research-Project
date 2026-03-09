import os
import redis
from dotenv import load_dotenv
from app.config.settings import settings

load_dotenv()

class RedisClient:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(RedisClient, cls).__new__(cls)
            cls._instance.initialize()
        return cls._instance

    def initialize(self):
        # Use simple 'redis://localhost:6379/0' as default
        self.redis_url = settings.REDIS_URL
        try:
            self.client = redis.from_url(self.redis_url, decode_responses=True)
        except Exception as e:
            print(f"Warning: Failed to initialize Redis client: {e}")
            self.client = None

    def ping(self):
        if not self.client:
            return False
        try:
            return self.client.ping()
        except redis.ConnectionError:
            return False

# Global instance
redis_manager = RedisClient()

def get_redis_client():
    """Exposes the global Redis client instance."""
    return redis_manager.client


def get_healthy_redis_client():
    """Returns a usable Redis client or None if Redis is unreachable."""
    client = redis_manager.client
    if not client:
        return None

    try:
        client.ping()
        return client
    except redis.RedisError:
        return None

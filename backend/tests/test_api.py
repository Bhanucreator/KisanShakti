from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Welcome to KisanShakti API"
    assert "version" in data

def test_smart_price_tomato():
    response = client.post("/api/v1/pricing/smart-price?crop_name=Tomato&quality_modifier=0.05")
    assert response.status_code == 200
    assert response.json() == {"crop_name": "Tomato", "smart_price": 21.0}

def test_smart_price_quality_clamp():
    """quality_modifier must be clamped to ±5%"""
    response = client.post("/api/v1/pricing/smart-price?crop_name=Tomato&quality_modifier=0.20")
    assert response.status_code == 200
    # 20.0 * 1.05 = 21.0 (clamped from 0.20 to 0.05)
    assert response.json()["smart_price"] == 21.0

def test_smart_price_negative_modifier():
    response = client.post("/api/v1/pricing/smart-price?crop_name=Potato&quality_modifier=-0.05")
    assert response.status_code == 200
    assert response.json() == {"crop_name": "Potato", "smart_price": 14.25}

def test_health_check_no_db():
    """Health check should gracefully handle missing DB connection."""
    response = client.get("/health")
    # Will return 503 if no DB, or 200 if DB is up — just verify it responds
    assert response.status_code in (200, 503)

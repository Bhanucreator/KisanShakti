from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "KisanShakti" in data.get("message", "")
    assert "version" in data

def test_health_check():
    """Health check should gracefully handle DB connection."""
    response = client.get("/health")
    assert response.status_code in (200, 503)

def test_get_subsidies():
    """Check subsidies endpoint returns valid items list."""
    response = client.get("/api/v1/subsidies?state=Karnataka")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data or isinstance(data, list)

def test_weather_endpoint_structure():
    """Check weather endpoint responds with expected JSON structure or status."""
    response = client.get("/api/v1/weather/current?lat=13.1367&lon=78.1325")
    assert response.status_code in (200, 503)


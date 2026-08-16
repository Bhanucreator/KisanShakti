import sqlite3
import os

DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../apps/upaj/assets/disease_treatments.db'))

def create_db():
    print(f"Creating offline SQLite DB at {DB_PATH}")
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS diseases (
            id INTEGER PRIMARY KEY,
            class_id INTEGER UNIQUE,
            name TEXT,
            severity TEXT,
            organic_treatment TEXT,
            chemical_treatment TEXT,
            kannada_name TEXT,
            kannada_organic TEXT,
            kannada_chemical TEXT
        )
    """)

    # Mock data for some classes (e.g., Tomato Late Blight, Tomato Early Blight, Healthy, etc.)
    diseases = [
        (0, 'Healthy', 'None', 'None', 'None', 'ಆರೋಗ್ಯಕರ', 'ಯಾವುದೂ ಇಲ್ಲ', 'ಯಾವುದೂ ಇಲ್ಲ'),
        (1, 'Tomato Late Blight', 'High', 'Copper spray, remove infected leaves', 'Fungicides like Chlorothalonil', 'ಟೊಮೆಟೊ ಲೇಟ್ ಬ್ಲೈಟ್ (ಅಂಗಮಾರಿ)', 'ತಾಮ್ರದ ಸಿಂಪಡಣೆ, ಸೋಂಕಿತ ಎಲೆಗಳನ್ನು ತೆಗೆದುಹಾಕಿ', 'ಕ್ಲೋರೋಥಾಲೋನಿಲ್ ನಂತಹ ಶಿಲೀಂಧ್ರನಾಶಕಗಳು'),
        (2, 'Tomato Early Blight', 'Medium', 'Crop rotation, Neem oil', 'Mancozeb', 'ಟೊಮೆಟೊ ಅರ್ಲಿ ಬ್ಲೈಟ್', 'ಬೆಳೆ ಪರಿವರ್ತನೆ, ಬೇವಿನ ಎಣ್ಣೆ', 'ಮ್ಯಾಂಕೋಜೆಬ್'),
        (3, 'Potato Early Blight', 'Medium', 'Remove affected lower leaves', 'Chlorothalonil', 'ಆಲೂಗಡ್ಡೆ ಅರ್ಲಿ ಬ್ಲೈಟ್', 'ಬಾಧಿತ ಕೆಳಗಿನ ಎಲೆಗಳನ್ನು ತೆಗೆದುಹಾಕಿ', 'ಕ್ಲೋರೋಥಾಲೋನಿಲ್'),
        (4, 'Potato Late Blight', 'High', 'Improve ventilation', 'Mefenoxam', 'ಆಲೂಗಡ್ಡೆ ಲೇಟ್ ಬ್ಲೈಟ್', 'ಗಾಳಿಯಾಡುವಿಕೆ ಸುಧಾರಿಸಿ', 'ಮೆಫೆನಾಕ್ಸಾಮ್')
    ]

    cursor.execute("DELETE FROM diseases") # Clear if exists
    cursor.executemany("""
        INSERT INTO diseases (class_id, name, severity, organic_treatment, chemical_treatment, kannada_name, kannada_organic, kannada_chemical)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, diseases)

    conn.commit()
    conn.close()
    print("Database created and populated.")

if __name__ == '__main__':
    create_db()

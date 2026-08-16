import pdfplumber

pdfs = [
    "PRD.pdf",
    "Tech Stack.pdf",
    "Frontend Guidelines.pdf",
]

for pdf_name in pdfs:
    print(f"\n{'='*80}")
    print(f"DOCUMENT: {pdf_name}")
    print('='*80)
    try:
        with pdfplumber.open(pdf_name) as pdf:
            for i, page in enumerate(pdf.pages):
                text = page.extract_text()
                if text:
                    print(f"\n--- Page {i+1} ---")
                    safe = text.encode('ascii', errors='replace').decode('ascii')
                    print(safe)
    except Exception as e:
        print(f"ERROR: {e}")

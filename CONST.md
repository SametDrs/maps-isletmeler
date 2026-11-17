# Sabitler

- Proje adı: `maps-isletmeler`
- Dil: Python 3.13
- Veri kaynağı: Google Maps web arayüzü, Playwright ile scraping
- Tarayıcı: sistemde kurulu Microsoft Edge (`channel="msedge"`, `MAPS_BROWSER_CHANNEL` ile değiştirilebilir). Playwright'ın kendi headless Chromium'u Maps'te "sınırlı görünüm" alıyor (yorum sayısı yok, saat yalnızca bugün).
- Paralel tarayıcı: en fazla 5 (panelden seçilir). Nezaket gecikmesi yok (kullanıcı kararı, 2026-11-17); yalnızca sayfa yüklenme beklemeleri var.
- Backend: FastAPI + Uvicorn
- Arayüz: FastAPI'nin sunduğu statik HTML/JS (build adımı yok)
- Veritabanı: SQLite (`data/isletmeler.db`)
- Dışa aktarım: Excel `.xlsx` (openpyxl)
- Toplanan alanlar:
  - Temel: ad, adres, enlem, boylam, kategori, place_id / Maps URL
  - İletişim: telefon, web sitesi
  - Puan: rating, yorum sayısı
  - Çalışma saatleri (haftalık)
- Her kayıt arama bölgesi, arama türü ve çekilme zamanıyla birlikte saklanır.

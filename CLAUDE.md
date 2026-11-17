# maps-isletmeler

Google Maps'ten seçilen bölge + işletme türüne göre işletme bilgilerini Playwright ile toplayan, SQLite'a kaydeden ve Excel'e aktaran web uygulaması.

## Proje haritası
- `app/scraper.py` — Playwright ile Google Maps arama, kaydırma ve detay çekme
- `app/db.py` — SQLite şeması ve kayıt (place_id / Maps URL ile tekilleştirme)
- `app/export.py` — SQLite → .xlsx dışa aktarım
- `app/main.py` — FastAPI: tarama başlatma, iş durumu, liste, Excel indirme
- `app/static/` — Web arayüzü (bölge + tür formu, sonuç tablosu)
- `data/` — SQLite dosyası, `exports/` — üretilen Excel dosyaları (git dışı)

## Ana talimatlar
- Sabitler (sürümler, alanlar, isimler) için `CONST.md`; değiştirmeden önce kullanıcıya sor.
- Yarım iş ve kaldığı yer `BACKLOG.md`'de; tamamlanan iş kaydı `BACKLOGLOG.md`'ye eklenir.
- Ham fikir ve tartışmalar `NOTES.md`'ye; koda veya bu dosyaya değil.
- Paralel tarayıcı sayısı panelden seçilir (1–5, kullanıcı kararı); her tarayıcı ayrı thread + ayrı `sync_playwright`. CAPTCHA görülünce tüm tarayıcılar durur.
- Google DOM seçicileri kırılgandır; seçicileri `scraper.py` başında tek yerde tut.

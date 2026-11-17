# Backlog Log

## 2026-11-17
- Proje başlatıldı, `git init`. Kararlar: Playwright scraping, FastAPI web arayüzü, SQLite + Excel, tüm alan grupları.
- CLAUDE.md, NOTES.md, CONST.md, BACKLOG.md, BACKLOGLOG.md oluşturuldu.
- Hydrogen xhigh: `app/db.py`, `app/scraper.py`, `app/export.py` yazıldı.
- Hydrogen xhigh: `app/main.py`, `requirements.txt`, `.gitignore` yazıldı. İlk çağrı 4 dk sınırına takıldı; arayüz (`app/static/`) `--continue` ile tamamlandı.
- `.venv` kuruldu, Chromium indirildi. Uçtan uca test: "Moda, Kadıköy" + "kafe", 3 sonuç, ~16 sn; SQLite ve Excel çalışıyor. 3 scraper hatası bulundu (bkz. BACKLOG.md).
- Hydrogen xhigh scraper düzeltmesi 7 dk'da değişiklik yapmadan zaman aşımına uğradı; görev Sonnet (high) alt ajanına yükseltildi.
- Sonnet: Yanlış bölge sonuçlarının nedeni feed başına sonradan eklenen "Sponsorlu" kartlarmış; feed sabitlenmesi beklenip bunlar atlanıyor. `place_id` artık `ChIJ...` öncelikli. Yorum sayısı ve 7 günlük saat parse'ı eklendi ama Maps headless oturumu "sınırlı görünüm"de sunduğu için bu veriler DOM'da yok. Canlı test: 3/3 Moda sonucu doğru.
- `app/static/data/regions.json` eklendi (81 il, 973 ilçe; kaynak: github.com/snrylmz/il-ilce-json).
- Bundled Chromium'da `chrome.dll` kayboldu (muhtemelen antivirüs). Kullanıcı isteğiyle tarayıcı Edge'e alındı (`BROWSER_CHANNEL`). Edge ile hem `headless=False` hem `headless=True` tam görünüm veriyor: yorum sayısı ve 7 günlük saat dolu.
- Hydrogen xhigh: arayüz yeniden tasarlandı (il/ilçe/tür combobox, detaylı filtre + chip'ler, kart/tablo/harita, KPI kartları, koyu/açık tema, her zaman görünür saatler). `categories.json` (63 tür, 10 grup). `main.py`: `POST /api/export.xlsx` `{ids}` ile filtreli Excel.
- Manager düzeltmeleri: harita karoları CARTO'dan (API anahtarı istiyordu) Esri Canvas'a alındı; tablo saat sütunu kırpılması düzeltildi.
- Doğrulama: test DB'si temizlendi; "Kadıköy, İstanbul" + kafe 8/8 doğru bölge, hepsinde yorum sayısı ve 7 gün saat. Filtreli Excel doğru satır sayısı. Edge ekran görüntüleri: konsol hatası yok, masaüstü/mobil yatay taşma 0.
- Hydrogen xhigh: "Hepsi" seçeneği (`max_results: null` → 1000 tavan, `main.py`), listede yalnızca bugünün saati, `#/isletme/<place_id>` detay sayfası (7 gün saat, harita, kopyala butonları), "Telefonu yok"/"Web sitesi yok" filtreleri, 3 KPI kartı (Toplam, Telefonu Olan, Web Sitesi Olmayan; sayı), 20'lik sayfalama.
- Doğrulama: "Adalar, İstanbul" + eczane (Hepsi) 11 kayıt / 45 sn; "Kadıköy, İstanbul" + kafe 20 kayıt / 90 sn. Sayfalama 1–20 / 31; "Telefonu yok" 4 sonuç (31−27, tutarlı); detay sayfası yenilemede açılıyor, Escape listeye dönüyor. Konsol hatası yok.
- Hydrogen xhigh: takip durumu (`durum`: yeni/bekleniyor/onaylandi/reddedildi, `not`, `durum_guncellendi`; mevcut DB'ye ALTER TABLE migrasyonu, yeniden taramada korunuyor). `PATCH /api/businesses/{place_id}/status`, `DELETE /api/businesses`. Detay sayfasında durum seçici + not; listede durum rozeti ve çoklu "Durum" filtresi; Excel'e Durum/Not sütunları. Kart/tabloda kategori ve ilçe ad yanına taşındı.
- Doğrulama: PATCH 200/422/404, upsert sonrası durum korunuyor; Edge ekran görüntüleri konsol hatası yok, taşma 0. Tüm kayıtlar silindi (31). Bolu toplu tarama başlatıldı: 9 ilçe × kafe/çiçekçi/berber/kuaför, "Hepsi".
- Bolu toplu taraması kullanıcı isteğiyle 9/36'da durduruldu (kafe 9 ilçe bitti); 492 kayıt. Merkez ve Gerede kafe 118'de kesildi (Google ~120 sınırı).
- Hydrogen xhigh: sunucu tarafı toplu tarama (`POST /api/batches`, `GET /api/batches/{id}`, pause/resume/cancel, `GET /api/active`), üstte sabit genel ilerleme çubuğu (Duraklat / Devam et / İptal et, satır içi onay), sayfa boyutu 12.
- Kullanıcı kararı: paralel tarayıcı 1–5 (panelden), nezaket gecikmeleri kaldırıldı. Hydrogen xhigh: `scrape(workers=N)` — faz 1 tek tarayıcı link toplar, faz 2 N thread / N `sync_playwright` / N Edge; `db._write_lock`.
- Opus (low) eşzamanlılık incelemesi: kilitlenme yok; 2 orta + 4 düşük bulgu (worker başlatma hatası sessiz başarı, çöken worker kuyruğu tüketiyor, çift sayım, bitişte pause yarışı, resume sonrası sayım, daemon thread'de yetim Edge). Hydrogen düzeltti.
- Doğrulama: "Merkez, Bolu" çiçekçi 20 sonuç — 1 tarayıcı 78 sn, 3 tarayıcı 36 sn. Toplu test (4 öğe, 3 tarayıcı): toplu sürerken tek iş 409, pause → paused, resume → done (24 kayıt), cancel → cancelled; yetim Edge 0; sayfada 12 kart; konsol hatası yok.
- Hydrogen xhigh: arayüzde Tek/Toplu tarama modu (il + çoklu ilçe / İl geneli + çoklu tür, "N ilçe × M tür = K arama" özeti), çalışan işin tarayıcı sayısı panelde gösteriliyor. Doğrulama: Bolu · Kıbrıscık+Seben × Kafe+Çiçekçi formdan başlatıldı (4 arama, 3 tarayıcı); mobil taşma 0 (iki tema).
- `.gitignore` düzeltildi (`data/` → `/data/`; `app/static/data/` dışarıda kalıyordu). README ve MIT LICENSE eklendi; boş dosya yok.

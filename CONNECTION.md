# CONNECTION.md

Catatan koneksi dan permintaan ke pemilik Langflow. Dokumen ini **tidak memuat nilai secret** — hanya lokasi dan bentuk konfigurasinya.

## 1. Konteks Integrasi

GenePilot punya backend di VPS (Bun + PostgreSQL + Redis + MinIO). Backend menjalankan *analysis worker* yang memanggil Langflow untuk menjalankan analisis sekuens.

Nama variabel di backend adalah `BIO_SERVICE_URL`, tapi yang dituju adalah **Langflow**, bukan Bio Service langsung. Alasannya, komponen LLM dan `StructuredOutput` berada di Langflow. Kalau backend memanggil Bio Service secara langsung, yang kembali hanya statistik Biopython tanpa insight AI.

## 2. Topologi

| Komponen | Dev | Prod |
| --- | --- | --- |
| Frontend | localhost | Vercel |
| Backend + PostgreSQL / Redis / MinIO | VPS | VPS |
| Cara akses VPS | Tailscale | Cloudflare Tunnel |

Hostname `*.n3level.id` hanya untuk dev (Tailscale). **Jangan dipakai di konfigurasi prod** — hostname tersebut tidak resolve di luar tailnet. Prod memakai domain root `n3level.id`.

Catatan: karena frontend prod (Vercel) dan API prod (VPS) berada di domain berbeda, keduanya bersifat cross-site. Backend harus `COOKIE_SAME_SITE=none`, kalau tidak cookie session akan drop di browser.

## 3. Alur Panggilan

Yang **benar-benar jalan sekarang** (backend memanggil flow, menunggu respons):

```
backend → Main flow (webhook) → Sequence Analysis Flow → POST /analyze → Bio Service
            ↘ 2× LanguageModel (ibm/granite-4-h-small, WatsonX)
            ↘ StructuredOutput
```

`StructuredOutput` saat ini dikonfigurasi menghasilkan `{ service, tools[], reason }`. Kelihatannya itu hasil klasifikasi request, bukan hasil analisis akhir.

**Usulan baru (dari teammate, 2026-10-04) — belum dikonfirmasi:**

```
frontend → backend: POST /analyze/file (multipart FASTA)
         → hasil Bio + prompt user digabung jadi 1 string, key "message"
         → POST webhook Langflow
         → (flow selesai) Langflow POST balik ke backend
         → frontend polling GET /analyses/:id/status
```

Dua bedanya dari yang sekarang, dan keduanya besar:

1. Bio Service dipanggil **dari backend kita**, bukan dari dalam flow. Node
   `APIRequest-kwUSA` yang memanggil `/analyze` harus dilepas.
2. Hasil **tidak lagi kembali lewat respons webhook**, tapi lewat callback dari Langflow
   ke backend kita.

`analysis_type` dan `sequence_id` tidak lagi punya tempat di body kalau semuanya
diratakan jadi satu string `message`, padahal mapping `analysisType` → nama tool Bio
bergantung padanya.

## 4. Masalah yang Kami Temukan

Node **Webhook belum dikonfigurasi** di kedua flow. Field masih berisi placeholder:

- `endpoint` → `BACKEND_URL`
- `curl` → `CURL_WEBHOOK`
- `Payload` → kosong

Akibatnya URL webhook mengembalikan **404**, sehingga integrasi belum bisa jalan.

Satu hal yang sudah pasti dari satu-satunya cURL yang benar tersimpan di flow: webhook **mewajibkan header `x-api-key`**, dan host yang tercatat adalah `http://103.89.6.149:8080` — bukan domain `n3level.id` yang justru membalas 404.

## 5. Yang Kami Butuh

1. **Host webhook yang benar** — `http://103.89.6.149:8080` atau `https://langflow.genepilot.n3level.id`? Yang kami coba lewat domain membalas 404.

2. **Schema request body.** Field Payload kosong dan `{"any": "data"}` hanya placeholder bawaan. Field apa saja yang diharapkan flow? Apakah urutan basa dikirim sebagai teks, atau sebagai file?

3. **Bentuk response.** Apakah webhook mengembalikan `{service, tools[], reason}` apa adanya, atau sudah berupa hasil analisis final?

4. **Auth.** Apakah API key yang dipakai untuk akses flow juga sah untuk pemanggilan webhook, atau ada key khusus webhook?

5. **Ekspektasi timeout.** Satu run melibatkan 2 panggilan LLM + Bio Service, jadi bisa memakan waktu lama. Timeout berapa yang wajar? Apakah perlu mode streaming atau async, karena POST biasa berpotensi timeout.

6. ~~**Multi-record FASTA.**~~ ✅ **Sudah diverifikasi langsung ke service** (2026-10-04).
   `POST /analyze/file` → `103.89.6.149:8001/analyze/file` dengan FASTA 2 record
   benar-benar mengembalikan `results[tool][recordId]`:

   ```json
   "results": { "calculate_gc_content": { "seq1_…": {…}, "seq2_…": {…} } }
   ```

   Bersama `file_metadata.records[]` yang berisi `{id, description, length}` per record.
   Angkanya benar (12/24 = 50% GC), jadi bukan echo input. **Yang belum jelas:**
   `tools` harus dikirim sebagai repeated form field atau satu nilai comma-separated —
   JSON array di multipart belum dicoba. Apakah flow nanti akan crippled juga, atau
   kami panggil `/analyze/file` langsung dari backend saja?

7. **Correlation ID di callback.** Body `{message}` tidak punya id, jadi saat Langflow
   POST balik, backend tidak tahu hasil itu untuk analisis yang mana. Apakah id-nya
   dibawa di URL callback (`POST /analyses/{id}/result`) atau di body
   (`{analysisId, message}`)? Tanpa ini tidak ada atribusi hasil yang benar.

8. **Autentikasi callback.** Callback itu menulis hasil ke database kami. Tanpa
   HMAC/shared secret, siapa pun yang tahu URL bisa menulis hasil palsu ke analisis
   mana pun. Apakah flow bisa mengirim header signature, dan secret-nya dikirim lewat
   env Langflow?

9. **Bentuk hasil callback.** Untuk 1 file multi-record: apakah flow mengirim 1 callback
   berisi semua record, atau 1 callback per record? Kami perlu ini untuk menentukan
   apakah `analyses` jadi satu baris per record atau satu baris berisi hasil majemuk.

10. **Ekspektasi timeout (callback).** Kalau alur jadi callback, kami tidak bisa
    menunggu respons webhook lagi. Berapa lama flow boleh sampai mengirim callback
    sebelum dianggap gagal? Kami butuh angka ini untuk watchdog.

## 6. Catatan Keamanan

- **Bio Service di `103.89.6.149:8001` dapat diakses publik dan tanpa autentikasi.** Endpoint mana pun bisa dipanggil siapa saja dari internet, termasuk mengunggah file 50 MB dan memakai compute. Perlu auth, atau di-bind ke Tailscale saja. Layanan lain (PostgreSQL, Redis, MinIO) sudah aman karena hanya memakai alamat Tailscale.

- Flow memanggil Bio Service **tanpa header auth apa pun**.

- API key pernah dibagikan lewat chat. Tolong rotasi setelah flow selesai dikonfigurasi.

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

```
backend → Main flow (webhook) → Sequence Analysis Flow → POST /analyze → Bio Service
            ↘ 2× LanguageModel (ibm/granite-4-h-small, WatsonX)
            ↘ StructuredOutput
```

`StructuredOutput` saat ini dikonfigurasi menghasilkan `{ service, tools[], reason }`. Kelihatannya itu hasil klasifikasi request, bukan hasil analisis akhir.

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

6. **Multi-record FASTA.** Saat ini flow memakai `/analyze` yang menerima satu string sekuens. Data kami bisa berisi FASTA multi-record. Endpoint `/analyze/file` sudah tersedia di Bio Service dan mengembalikan hasil **per record** (`results[tool][recordId]`). Apakah flow perlu beralih ke `/analyze/file` supaya semua record ikut teranalisis?

## 6. Catatan Keamanan

- **Bio Service di `103.89.6.149:8001` dapat diakses publik dan tanpa autentikasi.** Endpoint mana pun bisa dipanggil siapa saja dari internet, termasuk mengunggah file 50 MB dan memakai compute. Perlu auth, atau di-bind ke Tailscale saja. Layanan lain (PostgreSQL, Redis, MinIO) sudah aman karena hanya memakai alamat Tailscale.

- Flow memanggil Bio Service **tanpa header auth apa pun**.

- API key pernah dibagikan lewat chat. Tolong rotasi setelah flow selesai dikonfigurasi.
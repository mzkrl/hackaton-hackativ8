\# Genomic Insight Agent — Backend Development Plan (`back/`)



Dokumen ini adalah turunan dari \*Development Plan\* utama, dipersempit khusus untuk workspace `back/` di repo `hackaton-hackativ8` — yaitu Application Backend (§3.2 dev plan utama) yang memakai stack \*\*BEND\*\*: Bun + Elysia + Drizzle + Neon, dideploy sebagai Cloudflare Worker.



\## 1. Scope \& Batasan



`back/` bertanggung jawab atas API layer dan persistence. Yang \*\*bukan\*\* bagian dari `back/`:



\- \*\*Bio Service\*\* (Python/FastAPI/Biopython) — service terpisah, dipanggil lewat HTTP.

\- \*\*Langflow + IBM Granite\*\* — orchestration \& reasoning layer, dipanggil oleh \*worker\*, bukan oleh API layer secara langsung.

\- \*\*Worker eksekusi job\*\* (Bio Worker / BLAST Worker / AI Worker) — proses long-running terpisah yang menarik job dari queue; `back/` hanya membuat job dan mengeksposnya, tidak menjalankannya (lihat §6).



Dengan kata lain, `back/` adalah lapisan tipis: validasi request → baca/tulis Postgres (via Neon) → baca/tulis object storage → enqueue job → serve status.



\## 2. Tanggung Jawab (recap dari dev plan §3.2 + update v7)



| Area | Detail |

|---|---|

| Authentication | Optional, bukan gatekeeper — register/login/session |

| Projects | CRUD dasar, scoped ke user |

| Sequence \& Analysis | Persist metadata (bukan file mentah); status lifecycle `queued → processing → completed/failed` |

| Conversation | Persist riwayat chat per project |

| Guest migration | Import data dari IndexedDB client ke Postgres saat guest login/register |

| Object Storage API | Presigned upload/download ke MinIO/AIStor, credential tidak pernah sampai ke frontend |

| Queue orchestration | Membuat \& memasukkan job, \*\*bukan\*\* mengeksekusinya |

| API Gateway-facing | Semua endpoint di belakang reverse proxy (rate limit, TLS, dsb — di luar scope kode `back/` itu sendiri) |



\## 3. Data Model Plan



Entitas dan kolom mengikuti dev plan §4.3–4.8. Ringkasan sebagai referensi implementasi Drizzle:



| Entity | Kolom kunci | Catatan implementasi |

|---|---|---|

| User | id, email (unique), name | Hanya ada kalau user daftar akun |

| Project | id, user\_id (FK) | |

| Sequence | id, project\_id (FK, \*\*not null\*\* — data guest tidak pernah masuk sini, lihat §4.9 dev plan), object\_key, sequence\_hash | `object\_key` nunjuk ke file di MinIO/AIStor |

| Analysis | id, sequence\_id (FK), status (enum), queue\_job\_id, result\_json, error\_message | `status` inilah yang dipolling frontend lewat `GET /analyses/:id/status` |

| Conversation | id, project\_id (FK), role, content | |

| Report | id, project\_id (FK), object\_key | File report final juga di object storage |



Rekomendasi teknis: primary key `uuid` (`defaultRandom()`), `result\_json` sebagai `jsonb`, `status` sebagai Postgres enum (`queued`/`processing`/`completed`/`failed`). Driver Neon pakai `drizzle-orm/neon-http` (jalan di atas fetch, jadi kompatibel baik di Bun lokal maupun di Cloudflare Worker).



\## 4. API Surface Plan



| Group | Endpoint | Sync/Async | Catatan |

|---|---|---|---|

| Auth | `POST /auth/register`, `POST /auth/login` | Sync | Password di-hash PBKDF2-HMAC-SHA-512 via Web Crypto (aman di Workers runtime) |
| Auth | `POST /auth/logout`, `GET /auth/me` | Sync | Logout meng-expire cookie; `/me` buat ngecek sesi masih hidup |

| Projects | `GET/POST /projects`, `GET /projects/:id` | Sync | |

| Analyses | `POST /analyses` | \*\*Async\*\* | Validasi → insert row `status=queued` → enqueue → return `queue\_job\_id` langsung, tidak menunggu hasil |

| Analyses | `GET /analyses/:id`, `GET /analyses/:id/status` | Sync | Baca dari Postgres saja, tidak menyentuh queue/worker |

| Guest | `POST /guest/import` | Sync | **Butuh sesi login.** Terima payload dari IndexedDB, tulis per project dalam satu transaksi |

| Conversations | `GET /conversations/:projectId`, `POST /conversations` | Sync | |

| Storage | `GET /storage/health` | Sync | |

| Storage | `POST /storage/upload` | Sync | Upload lewat backend (untuk file kecil) |

| Storage | `POST /storage/presign` | Sync | Backend generate presigned URL, browser upload langsung ke MinIO/AIStor |

| Storage | `GET /storage/:key`, `DELETE /storage/:key` | Sync | Validasi authorization dulu sebelum generate presigned GET / delete |



\## 5. Object Storage Integration Plan



\- Client S3-compatible (mis. `@aws-sdk/client-s3` diarahkan ke endpoint MinIO) dipakai untuk kedua provider (MinIO self-hosted maupun AIStor), supaya application layer tidak terikat vendor.

\- Credential (access key/secret) disimpan sebagai Cloudflare Worker secret (`wrangler secret put`), tidak pernah dikirim ke frontend.

\- Alur presign: frontend minta `POST /storage/presign` → backend generate presigned PUT URL → frontend upload langsung ke object storage → backend catat `object\_key` + metadata ke Postgres (baik sebelum upload optimistically, atau dikonfirmasi lewat call balik setelah upload selesai — pilih salah satu, jangan dua-duanya supaya state tidak ambigu).



\## 6. Queue \& Worker Architecture — perlu keputusan sebelum implementasi



Ini titik yang paling perlu diputuskan lebih dulu karena target deploy `back/` adalah \*\*Cloudflare Worker\*\*, sementara Redis + BullMQ secara desain mengasumsikan proses Node yang hidup terus (`ioredis` pakai koneksi TCP persisten, worker-nya juga proses long-running yang terus narik job — bukan model request/response seperti Workers).



Dua opsi yang masuk akal:



1\. \*\*BullMQ + Redis sungguhan, tapi eksekusinya di proses terpisah.\*\* `back/` (Cloudflare Worker) cuma menulis row `Analysis` ke Postgres lalu mendorong job — baik langsung ke Redis (Workers punya `node:net`/TCP socket lewat `nodejs\_compat`, yang wrangler.toml kalian sudah aktifkan, jadi `ioredis` \*mungkin\* jalan, tapi ini bukan jalur yang lazim dipakai orang dan belum tentu stabil), atau lebih aman lewat satu HTTP call kecil ke service worker yang memang pegang koneksi Redis asli. Worker eksekusi (Bio/BLAST/AI Worker) tetap sebagai proses Bun/Node terpisah yang selalu hidup — ini sudah sesuai dengan Iteration 10 di dev plan utama yang memang mendaftarkan "bio/analysis worker container(s)" sebagai container sendiri, jadi tidak menyimpang dari plan yang sudah disubmit.

2\. \*\*Postgres-as-queue\*\* untuk MVP hackathon: kolom `status` + `queue\_job\_id` tetap ada di skema, tapi "queue"-nya cukup berupa worker terpisah yang polling `SELECT ... WHERE status = 'queued' FOR UPDATE SKIP LOCKED` ke Neon. Secara fungsional tetap memenuhi kebutuhan "guest request tidak boleh langsung ngeblok komputasi berat" tanpa harus menyambungkan Redis lewat Workers sama sekali. Trade-off: kalau dipresentasikan ke juri, ini menyimpang sedikit dari dev plan tertulis yang eksplisit menyebut Redis + BullMQ.



Rekomendasi: kalau waktu hackathon mepet, opsi 2 lebih aman untuk dieksekusi dan tetap terlihat sebagai "queue system" yang berfungsi saat demo. Kalau mau tetap benar-benar Redis + BullMQ sesuai dev plan tertulis, ambil opsi 1 dan pastikan worker eksekusi dites di luar Workers runtime dari awal (jangan diasumsikan jalan tanpa dicoba).



Baik opsi 1 maupun 2, kontrak `back/` ke luar tetap sama: `POST /analyses` selalu langsung balas dengan `queue\_job\_id` dan status `queued`, tanpa menunggu proses analisis selesai.



\## 7. Auth \& Guest Migration Plan



Both items are **implemented** (`back/src/routes/auth.ts`, `back/src/routes/guest.ts`). Decisions that differ from the original sketch, and why:

\*\*Auth\*\*

- Password hashing uses PBKDF2-HMAC-SHA-512 through Web Crypto (`deriveBits`), not `bcrypt`/`bcryptjs`. Both would work, but Web Crypto is the primitive Workers already has, so there is no extra dependency to bundle and no native binding to break on any of the three runtimes. Iteration count is `PBKDF2_ITERATIONS` (default `210000`).
- Sessions are HMAC-SHA-256 signed tokens in a `gia_session` cookie, signed with the `AUTH_SECRET` Worker secret. Stateless on purpose: `verifySession` needs no database round-trip, and every route already re-reads the owned row, so an extra lookup per request would buy nothing. A successful verification returns the user id without proving the account still exists, so deleting an account must also rotate `AUTH_SECRET` to invalidate outstanding cookies.
- Cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` on any hosted runtime; `SESSION_TTL_SECONDS` defaults to 7 days.
- `requireUserId()` resolves a real session first. The shared `developer@local.test` identity is a local convenience, reachable only when `ALLOW_DEV_AUTH` is enabled outside development, so a hosted deployment with no `AUTH_SECRET` fails closed with `401 UNAUTHENTICATED` instead of handing every anonymous visitor the same account.
- Login answers `Invalid email or password.` for both unknown email and wrong password, and always spends the same PBKDF2 work against a decoy hash, so response time does not reveal whether an account exists.

\*\*Guest migration\*\*

- `POST /guest/import` is authenticated, so the migration is only reachable once the guest has a real session.
- The browser sends the UUIDs it already assigned in IndexedDB. That makes the whole import idempotent: `on conflict do nothing` on every insert means a retry after a partial failure converges instead of duplicating.
- Each project is inserted inside its own Neon batch transaction (`sql.transaction([...])` fed by Drizzle `.toSQL()`), because `drizzle-orm/neon-http` has no interactive transactions. A failure mid-project rolls that project back completely and the response names the failing index; earlier projects stay committed, which is what makes a targeted retry safe.
- The client never supplies `userId`, `objectKey`, or `queueJobId`. Those are rejected with `422` (`t.Optional(t.Never())`) rather than silently dropped, so a caller that expects to set them gets a loud error. A guest has no object storage and no queue, so an imported analysis can only be `completed` or `failed` - anything else lands as `failed` rather than claiming a server-side job that does not exist.
- Payload is bounded at 50 projects, 200 sequences per project, 100 analyses per sequence, 500 conversations per project, and 64 KB per analysis result.



\## 8. Deployment Plan (dual target: Cloudflare Worker + Vercel)



`back/` ternyata dideploy ke dua tempat sekaligus (workers.dev dan vercel.app), jadi kode harus tetap jalan di dua runtime yang beda karakter:



| | Cloudflare Worker | Vercel |

|---|---|---|

| Runtime | V8 isolate (workerd), bukan Node asli | Node.js serverless function asli (kecuali dipilih Edge Runtime) |

| Akses env/secret | Lewat argumen `env` di `fetch(request, env, ctx)` — `process.env` kosong secara default | `process.env` jalan normal seperti Node biasa |

| Koneksi TCP keluar (mis. Redis) | Perlu `nodejs\_compat` + `node:net`, belum jalur yang lazim/teruji untuk `ioredis` | Jalan normal, `ioredis` tidak butuh workaround apa pun |

| Cocok buat worker BullMQ beneran? | Tidak — tetap butuh proses terpisah yang selalu hidup | Tidak juga — serverless function tetap per-invocation, bukan proses long-running |



Implikasinya:



\- \*\*Env/secret\*\*: paling gampang, di entrypoint Cloudflare (`export default { fetch }`) lakukan `Object.assign(process.env, env)` di awal sebelum manggil `app.fetch`, supaya sisa kode aplikasi cukup baca `process.env` di mana pun dia jalan — tidak perlu dua jalur baca config yang beda per platform.

\- \*\*Redis/BullMQ (§6)\*\*: kesimpulan di §6 tetap berlaku untuk kedua platform — worker eksekusi (Bio/BLAST/AI Worker) tetap harus jadi proses terpisah yang selalu hidup, bukan Cloudflare Worker maupun Vercel Function. Bedanya cuma di Vercel sisi \*enqueue\*-nya (dari `POST /analyses`) bisa langsung pakai `ioredis` tanpa drama TCP; di Cloudflare lebih aman lewat opsi Postgres-as-queue atau HTTP call ke worker service.

\- \*\*Migration\*\*: `drizzle-kit` tetap dijalankan dari mesin development terhadap Neon, bukan dari dalam Worker/Function manapun — ini sama untuk kedua platform.

\- Kalau dua-duanya bakal terus dipakai (bukan cuma salah satu buat demo), sebaiknya satu di antaranya ditetapkan sebagai "canonical" buat submission ke juri, supaya tidak ada kebingungan environment variable mana yang paling update pas presentasi.



\## 9. Urutan Kerja (backend-only, dipetakan ke iterasi di dev plan utama)



1\. **DONE** \*\*Schema \& migration\*\* - 6 entity di Drizzle, migration sudah jalan ke Neon. \*(Iteration 6)\*

2\. **DONE** \*\*CRUD dasar tanpa auth dulu\*\* - Projects, Sequences, Analyses, Conversations. Supaya frontend punya sesuatu buat diintegrasikan lebih awal.

3\. **DONE** \*\*Object Storage API\*\* - presign/upload/download/delete, credential tidak pernah sampai ke frontend. \*(Iteration 6)\*

4\. **DONE** \*\*Queue integration\*\* - opsi 1 di section 6: BullMQ asli di proses terpisah, Worker tidak langsung pegang koneksi Redis, tapi mendorong job lewat HTTP call ber-auth ke worker service. \*(Iteration 6)\*

5\. **DONE** \*\*Auth\*\* - register/login/logout/me, session HMAC + cookie, `requireUserId()` di semua route. \*(Iteration 7)\*

6\. **DONE** \*\*Guest migration endpoint\*\* - `POST /guest/import`, idempotent, satu transaksi per project. \*(Iteration 8)\*

7\. \*\*PARTIAL\*\* \*\*Reliability pass\*\* - upload validation dan retry/backoff sudah; rate limit + queue overflow handling belum. \*(Iteration 9)\*

8\. \*\*PARTIAL\*\* \*\*Deployment\*\* - Cloudflare workerd auth terverifikasi lokal dan Vercel build sukses; `wrangler deploy` live + smoke test URL deploy belum. \*(Iteration 10)\*



Tidak menyertakan Bio Service, BLAST/NCBI, atau Langflow di urutan ini — itu dependency eksternal yang cukup dipanggil lewat HTTP begitu backend-nya siap.
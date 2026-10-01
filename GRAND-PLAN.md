\# Genomic Insight Agent — Development Plan



| | |

|---|---|

| \*\*Project\*\* | Genomic Insight Agent |

| \*\*Category\*\* | AI Agent + Bioinformatics Platform |

| \*\*Primary Use Case\*\* | Research and education assistant for biological sequence analysis |

| \*\*Initial Context\*\* | IBM SkillsBuild University Education National Hackathon 2026 |

| \*\*Theme\*\* | Healthcare \& Wellbeing |



---



\## 1. Application Concept, Scientific Background, Problem Statement, and Solution



\### 1.1 Application Concept



\*\*Genomic Insight Agent\*\* adalah aplikasi bioinformatika berbasis AI agent yang membantu pengguna menganalisis data sequence biologis — terutama DNA — melalui kombinasi antara komputasi bioinformatika deterministik (Biopython), reasoning dan interpretasi berbasis AI agent, antarmuka web, penyimpanan lokal untuk guest, dan penyimpanan cloud opsional untuk pengguna yang memiliki akun.



Pembagian tanggung jawab antar layer:



| Layer | Peran |

|---|---|

| Next.js | Presentation layer |

| Langflow | Agent orchestration |

| IBM Granite | Reasoning, interpretasi, dan penjelasan hasil |

| Biopython | Komputasi bioinformatika deterministik |

| BLAST | Sequence similarity search |

| NCBI / GenBank | Sumber anotasi biologis |

| ElysiaJS | Application layer |

| MinIO / AIStor | Menyimpan research object (file FASTA, GenBank, artifact, report) |

| PostgreSQL | Persistent storage untuk metadata |

| Redis + BullMQ | Mengontrol analysis job yang mahal secara komputasi dan menyerap lonjakan traffic |



Aplikasi dirancang agar dapat langsung digunakan tanpa login. Guest dapat mengunggah sequence, menjalankan analisis, membaca interpretasi AI, dan menyimpan riwayat secara lokal. Pengguna yang memilih membuat akun mendapatkan tambahan berupa cloud history, project management, cross-device persistence, dan migrasi riwayat dari sesi guest. Authentication bukan syarat utama untuk menggunakan tools dasar.



\### 1.2 Scientific Background



Data biologis seperti DNA direpresentasikan dalam bentuk sequence nucleotide, di mana setiap simbol mewakili satu basa nitrogen: A (Adenine), T (Thymine), G (Guanine), dan C (Cytosine). Sequence DNA dapat dianalisis untuk memperoleh berbagai informasi biologis, di antaranya sequence length, nucleotide composition, GC content, ORF detection, dan DNA translation.



\*\*Nucleotide Composition\*\* — menghitung jumlah kemunculan A, T, G, dan C dalam sequence. Contoh hasil:



```json

{

&nbsp; "A": 4890,

&nbsp; "T": 4670,

&nbsp; "G": 2610,

&nbsp; "C": 4471

}

```



\*\*GC Content\*\* — menunjukkan proporsi Guanine dan Cytosine terhadap keseluruhan nucleotide, dihitung dengan:



```text

GC% = (G + C) / total nucleotide × 100

```



GC content dapat menjadi salah satu indikator awal karakteristik biologis suatu sequence.



\*\*ORF Detection\*\* — ORF (\*Open Reading Frame\*) adalah region DNA yang berpotensi menghasilkan protein. Analisis ORF mencakup penentuan start codon, reading frame, stop codon, panjang region, dan strand.



\*\*Translation\*\* — DNA coding region dapat diterjemahkan menjadi sequence asam amino, misalnya `ATGGCC...` (DNA) → `MA...` (protein).



\### 1.3 Peran AI



AI tidak digunakan untuk menghitung nucleotide atau menentukan hasil biologis secara probabilistik. Perhitungan ilmiah dilakukan oleh tool deterministik (Biopython), pencarian kemiripan sequence dilakukan melalui BLAST, dan metadata biologis diambil dari sumber seperti NCBI/GenBank. Pada arsitektur saat ini:



\- \*\*Langflow\*\* — orchestration layer.

\- \*\*IBM Granite\*\* (via watsonx.ai) — intent understanding, reasoning, dan explanation.

\- \*\*Biopython\*\* — deterministic local bioinformatics computation.

\- \*\*BLAST\*\* — sequence similarity search.

\- \*\*NCBI / GenBank\*\* — annotation dan sumber biological record.



Alur AI utama:



1\. User mengirim request.

2\. Langflow Agent + IBM Granite memahami task.

3\. Granite menentukan analysis plan.

4\. Langflow memilih dan memanggil tool yang diperlukan.

5\. Biopython / BLAST / NCBI tool menghasilkan structured evidence.

6\. Granite mengintegrasikan evidence tersebut.

7\. Granite menjelaskan hasil dalam bahasa yang mudah dipahami.

8\. Response dikirim ke user.



Prinsip ilmiahnya: \*\*AI bukan sumber kebenaran biologis. AI adalah reasoning layer yang menggabungkan evidence dari scientific tools dan biological databases.\*\*



\### 1.4 Problem Statement



Banyak tool bioinformatika yang sudah dapat melakukan analisis sequence secara akurat, tetapi pengguna pemula masih menghadapi beberapa hambatan:



1\. \*\*Format data biologis tidak sederhana.\*\* Format seperti FASTA dan GenBank memiliki struktur yang harus dipahami sebelum dianalisis. Contoh FASTA:

&nbsp;  ```text

&nbsp;  >sequence\_id description

&nbsp;  ATGCTGATCGATCG...

&nbsp;  ```

&nbsp;  Jika file dibaca sebagai string biasa tanpa parsing yang benar, metadata dapat ikut terbaca sebagai bagian dari sequence.



2\. \*\*Banyak tool membutuhkan pengetahuan teknis\*\* — pengguna perlu tahu tool apa yang dipakai, parameter apa yang diperlukan, hasil mana yang penting, dan analisis lanjutan apa yang relevan.



3\. \*\*Output bioinformatika sering sulit dipahami.\*\* Tool dapat menghasilkan angka dan sequence tanpa menjelaskan maknanya. Misalnya, hasil `GC content = 42.5%` tidak otomatis menjawab pertanyaan pengguna pemula seperti: apakah angka ini tinggi, apa maknanya, dan apa yang sebaiknya dianalisis berikutnya.



4\. \*\*Hambatan penggunaan.\*\* Untuk analisis sederhana, pengguna seharusnya tidak dipaksa register, verify email, dan login terlebih dahulu sebelum dapat menggunakan satu tool dasar.



\### 1.5 Solusi



Genomic Insight Agent menawarkan workflow agentic yang tidak memaksa pengguna mengetahui tool bioinformatika mana yang harus dipakai.



\*\*Basic workflow:\*\*



1\. User memberikan FASTA dan task.

2\. Langflow Agent + IBM Granite memahami permintaan.

3\. AI membuat analysis plan.

4\. Langflow memanggil Biopython tool yang diperlukan.

5\. Sistem menghasilkan structured sequence analysis.

6\. Granite menginterpretasikan hasil.

7\. Output ditampilkan ke user.



\*\*Jika task membutuhkan identifikasi atau pencarian kemiripan sequence:\*\*



1\. Input FASTA.

2\. AI task understanding.

3\. AI analysis planning.

4\. Biopython local analysis.

5\. BLAST similarity search.

6\. Sistem memperoleh BLAST hits (accession, identity, E-value, alignment).

7\. NCBI / GenBank record retrieval.

8\. Sistem menyusun annotation dan metadata.

9\. Granite mengintegrasikan evidence.

10\. Final biological interpretation ditampilkan ke user.



Aplikasi ini bersifat \*guest-first\*, \*account-optional\*, \*research-oriented\*, dan \*education-oriented\*. Aplikasi ini \*\*bukan\*\* sistem diagnosis klinis, disease prediction engine, atau treatment recommender.



---



\## 2. Fitur



\### 2.1 Fitur MVP (Wajib untuk Versi Hackathon/Demo)



| Fitur | Deskripsi |

|---|---|

| \*\*A. Guest Mode\*\* | User dapat menggunakan aplikasi tanpa login — upload sequence, menjalankan analisis, memakai AI interpretation, dan melihat local history. |

| \*\*B. FASTA Upload\*\* | Dukungan awal untuk ekstensi `.fasta`, `.fa`, dan `.fna`. |

| \*\*C. Biological Sequence Parsing\*\* | Menggunakan Biopython (`from Bio import SeqIO`); parser harus memisahkan sequence ID, description, dan sequence itu sendiri. |

| \*\*D. Sequence Validation\*\* | Mencakup pengecekan empty sequence, invalid character, ambiguous base, sequence length, dan sequence type. |

| \*\*E. Nucleotide Composition\*\* | Menghitung jumlah A, T, G, C. |

| \*\*F. GC Content\*\* | Menghitung persentase (G + C) terhadap total sequence. |

| \*\*G. ORF Detection\*\* | Versi dasar mencakup forward strand, reading frame, start, stop, dan length. |

| \*\*H. DNA Translation\*\* | Mengubah coding region menjadi protein sequence. |

| \*\*I. AI Interpretation\*\* | AI menjelaskan sequence statistics, GC content, ORF findings, translation result, dan kemungkinan analisis lanjutan. |

| \*\*J. AI Tool Calling\*\* | Langflow Agent menggunakan IBM Granite sebagai reasoning model untuk memahami task dan menentukan tool yang diperlukan — tool tidak dipanggil berdasarkan keyword hard-coded, melainkan berdasarkan kebutuhan task dan hasil tool sebelumnya (lihat contoh di bawah). |

| \*\*K. Local History\*\* | Guest history disimpan di browser menggunakan IndexedDB (bukan hanya localStorage), mencakup analysis metadata, sequence metadata, analysis results, dan conversation history. Raw sequence dapat disimpan secara selektif. |

| \*\*L. Object Storage for Research Files\*\* | Authenticated user dapat menyimpan file penelitian (FASTA, GenBank, analysis artifact, report, serta dataset biologis besar ke depannya) pada object storage S3-compatible — MinIO untuk self-hosted development, atau MinIO AIStor untuk kebutuhan yang lebih enterprise. PostgreSQL tidak menyimpan file binary berukuran besar; PostgreSQL hanya menyimpan metadata dan object key, sementara file aktual disimpan di object storage. Upload dapat dilakukan lewat backend atau lewat presigned URL, sehingga browser dapat mengirim file langsung ke object storage tanpa pernah menerima credential storage. |

| \*\*M. Optional Authentication\*\* | Login bukan syarat menggunakan tools; akun digunakan untuk cloud history, project persistence, project management, dan cross-device access. |

| \*\*N. Guest-to-Account Migration\*\* | Jika guest membuat akun: data di IndexedDB → login → import local analyses → ElysiaJS → PostgreSQL. |



Contoh alur tool calling (fitur J):



```text

User: "Find the longest ORF and translate it."



1\. Granite understands task

2\. Langflow calls find\_orfs()

3\. Granite identifies the longest ORF

4\. Langflow calls translate\_orf()

5\. Granite explains the result

```



\### 2.2 Fitur yang Disarankan (Nice-to-Have)



Fitur berikut tidak mutlak untuk MVP pertama, tetapi sangat berguna jika waktu pengembangan mencukupi:



\- \*\*Sequence Visualization\*\* — length, composition chart, GC chart, ORF table.

\- \*\*GenBank Support\*\* — format `.gb`, `.gbk`, `.genbank`.

\- \*\*Six-Frame ORF Detection\*\* — 3 forward frame + 3 reverse-complement frame.

\- \*\*BLAST Similarity Search\*\* — prioritas awal adalah BLASTN, dengan hasil utama berupa accession ID, sequence identity, E-value, bit score, dan alignment.

\- \*\*NCBI / GenBank Record Retrieval\*\* — accession ID dari BLAST digunakan untuk mengambil record biologis terkait (organism, gene, CDS, product, feature annotations, references, record metadata). BLAST dan GenBank diperlakukan sebagai dua tool terpisah: `blast\_sequence()` dan `fetch\_ncbi\_record()`.

\- \*\*Project Workspace\*\* — authenticated user dapat membuat Project yang berisi Sequence, Analysis, Conversation, dan Report.

\- \*\*Analysis History\*\* — authenticated user dapat membuka kembali analisis lama.

\- \*\*Report Generation\*\* — merangkum sequence metadata, analysis result, dan AI interpretation.

\- \*\*Queueing and Abuse Protection\*\* — karena tools dasar bisa dipakai tanpa login, request yang butuh komputasi atau external API tidak langsung dieksekusi worker, melainkan masuk ke queue (Redis + BullMQ) lebih dulu agar lonjakan traffic tidak membuat Bio Service, BLAST, atau AI provider overload. Queue menangani analysis job, BLAST job, AI interpretation job, retry handling, concurrency control, serta job timeout/expiration. Rate limiting tetap diterapkan pada API gateway dan job submission; guest tidak membutuhkan account ID karena job memakai anonymous job/session identifier yang disimpan di browser.

\- \*\*Reverse Proxy / API Gateway\*\* — menangani TLS, routing, request-size limit, rate limiting, dan service isolation.



\### 2.3 Fitur Tambahan untuk Pengembangan ke Depan



\- \*\*Bioinformatics:\*\* sequence annotation, multiple sequence alignment, phylogenetic analysis, protein analysis, variant analysis, mode BLAST tambahan (BLASTP, BLASTX, TBLASTN, TBLASTX).

\- \*\*External Biological Databases:\*\* integrasi NCBI, UniProt, Ensembl.

\- \*\*Advanced Agent Workflow:\*\* Langflow Agent dan IBM Granite bekerja sama untuk memahami request kompleks, merencanakan workflow multi-tool, memanggil Biopython tools, menjalankan BLAST similarity search, mengambil record NCBI/GenBank, membandingkan structured evidence, melakukan follow-up analysis, dan menghasilkan research summary.

\- \*\*Advanced Data Visualization:\*\* interactive genome viewer, ORF map, feature map, alignment viewer.

\- \*\*Distributed Processing:\*\* BullMQ, Redis, multiple Bio Workers untuk workload besar.

\- \*\*Monetization:\*\* eksplisit \*\*di luar scope hackathon/demo\*\*. Jika aplikasi dipublikasikan di masa depan, keputusan monetization baru diambil setelah usage analysis, infrastructure cost analysis, dan user demand analysis — dengan model potensial berupa free tools plus paid advanced compute.



---



\## 3. Tech Stack



\### 3.1 Frontend



\*\*Stack:\*\* Next.js, TypeScript, Tailwind CSS, shadcn/ui, Recharts, TanStack Query, IndexedDB.



\*\*Tanggung jawab:\*\* UI, file upload, guest history, chat interface, dashboard, visualization, dan project navigation.



\### 3.2 Application Backend



\*\*Stack:\*\* ElysiaJS, Bun, TypeScript, Drizzle ORM, PostgreSQL.



\*\*Tanggung jawab:\*\* authentication, authorization, users, projects, analysis persistence, conversation persistence, guest migration, integrasi Langflow, dan API management.



ElysiaJS dipilih karena ringan, type-safe, dan lebih cepat dikembangkan untuk scope aplikasi ini dibanding backend framework yang lebih berat. Drizzle ORM digunakan sebagai database layer yang tetap dekat dengan SQL dan cocok dipasangkan dengan TypeScript + Bun.



\### 3.3 Bioinformatics Service



\*\*Stack:\*\* Python, FastAPI, Biopython, Pydantic, pytest.



\*\*Tanggung jawab:\*\* FASTA parsing, validation, nucleotide counting, GC content, ORF detection, translation, dan pengembangan bioinformatika lanjutan ke depannya.



Bio Service dibuat terpisah dari ElysiaJS agar scientific computation dapat berkembang secara independen.



\### 3.4 AI Layer



\*\*Stack:\*\* Langflow, IBM Granite, watsonx.ai model inference API.



| Komponen | Tanggung Jawab |

|---|---|

| Langflow | Agent orchestration, tool selection, tool calling, multi-step workflow, tool-result routing |

| IBM Granite | Intent understanding, analysis planning, reasoning over tool results, biological interpretation, response formulation |

| watsonx.ai | Granite model provider / inference endpoint |



Pada MVP, Langflow menjadi satu-satunya orchestration layer, dengan IBM Granite digunakan sebagai reasoning model melalui provider watsonx.ai. Langflow dijalankan sebagai service/container tersendiri apabila self-hosted. Arsitektur dirancang agar model provider dapat diganti di masa depan tanpa mengubah Bio Service atau frontend — misalnya ke Granite self-hosted melalui Ollama jika diperlukan.



\### 3.5 Object Storage



\*\*Stack:\*\* MinIO, MinIO AIStor, S3-compatible API.



Digunakan untuk menyimpan file dan artifact penelitian yang tidak cocok disimpan langsung di PostgreSQL, seperti raw FASTA/GenBank file, analysis artifact, project report, dan result file berukuran besar.



MinIO dipakai untuk local/self-hosted development, sedangkan MinIO AIStor dapat dipakai ketika deployment membutuhkan object-storage platform yang lebih enterprise. Keduanya diakses melalui API S3-compatible sehingga application layer tidak terikat pada vendor tertentu.



Backend bertanggung jawab atas credential storage. Frontend sebaiknya menggunakan presigned URL untuk upload/download object apabila ukuran file besar atau direct-to-storage upload lebih efisien.



\### 3.6 Database



PostgreSQL digunakan sebagai persistent source of truth untuk data terstruktur — metadata, relasi project/analysis/conversation, serta reference ke object storage.



\### 3.7 Browser Storage



IndexedDB digunakan untuk guest history.



\### 3.8 Queue and Cache



\*\*Stack:\*\* Redis, BullMQ.



Redis + BullMQ \*\*wajib untuk MVP public/guest flow\*\*, bukan sekadar fitur future scaling — karena aplikasi menerima request tanpa authentication, user tidak boleh dapat langsung memicu banyak proses berat secara bersamaan.



Redis berfungsi sebagai backing store untuk BullMQ, sementara PostgreSQL tetap menjadi persistent source of truth untuk metadata dan status domain; queue tidak menggantikan PostgreSQL. Queue digunakan untuk analysis job queue, BLAST job queue, AI interpretation queue, concurrency limit, retry/backoff, job timeout/expiration, queue depth monitoring, dan optional cache.



Prinsip alurnya:



1\. User request diterima ElysiaJS.

2\. ElysiaJS membuat analysis job.

3\. PostgreSQL menyimpan job metadata.

4\. Job dimasukkan ke BullMQ, dengan Redis sebagai backing store-nya.

5\. Worker mengeksekusi job.



Dengan pola ini, request guest tetap dapat diterima walaupun worker sedang sibuk — user mendapatkan status seperti `queued`, `processing`, `completed`, atau `failed`, bukan HTTP request yang menunggu proses panjang.



\### 3.9 Development Tools



pnpm, uv, Docker, Docker Compose, GitHub Actions, ESLint, Prettier, Ruff, pytest.



---



\## 4. Arsitektur Basis Data dan API



\### 4.1 Database Architecture



Persistent database menggunakan PostgreSQL dengan Drizzle ORM pada ElysiaJS. Data binary/file penelitian disimpan pada object storage S3-compatible (MinIO / MinIO AIStor), dengan pembagian tanggung jawab sebagai berikut:



| Sistem | Menyimpan |

|---|---|

| PostgreSQL | Users, projects, sequence metadata, analysis metadata, conversation, object\_key / file metadata |

| MinIO / AIStor | FASTA files, GenBank files, generated reports, analysis artifacts, research file besar lainnya |



Dengan pola ini, database tetap fokus pada data terstruktur sementara object storage menangani file berukuran besar.



\### 4.2 Core Entities



Entitas utama: \*\*User, Project, Sequence, Analysis, Conversation, Report.\*\*



Relasi dasar:



```text

User

└── Project

&nbsp;    ├── Sequence

&nbsp;    │    └── Analysis

&nbsp;    ├── Conversation

&nbsp;    └── Report

```



\### 4.3–4.8 Entity Schema



| Entity | Kolom | Catatan |

|---|---|---|

| \*\*User\*\* | `id`, `email`, `name`, `created\_at`, `updated\_at` | Hanya diperlukan jika pengguna membuat akun |

| \*\*Project\*\* | `id`, `user\_id`, `name`, `created\_at`, `updated\_at` | |

| \*\*Sequence\*\* | `id`, `project\_id`, `record\_id`, `description`, `format`, `sequence\_length`, `sequence\_hash`, `object\_key`, `original\_filename`, `created\_at` | `object\_key` mengarah ke file sequence di MinIO/AIStor; raw sequence tidak perlu disimpan sebagai kolom database bila file aslinya sudah ada di object storage |

| \*\*Analysis\*\* | `id`, `sequence\_id`, `analysis\_type`, `status`, `queue\_job\_id`, `result\_json`, `error\_message`, `created\_at`, `updated\_at` | `status` berupa `queued` / `processing` / `completed` / `failed`; `queue\_job\_id` menyimpan identifier BullMQ agar status domain di PostgreSQL dapat dikaitkan dengan execution job di Redis; `result\_json` menyimpan struktur hasil bioinformatika secara fleksibel |

| \*\*Conversation\*\* | `id`, `project\_id`, `role`, `content`, `created\_at` | |

| \*\*Report\*\* | `id`, `project\_id`, `content`, `object\_key`, `created\_at` | `content` menyimpan metadata/text ringkas, sementara file report final disimpan sebagai object di MinIO/AIStor melalui `object\_key` |



\### 4.9 Guest Storage Architecture



Guest tidak wajib memiliki record User. State lokal disimpan di IndexedDB, mencakup projects, analyses, dan conversations. Guest history dapat dimigrasikan setelah login.



\### 4.10 API Architecture



Sistem memiliki tiga kelompok API utama.



\*\*Application API\*\* (dikelola ElysiaJS):



```text

POST   /auth/login

POST   /auth/register



GET    /projects

POST   /projects

GET    /projects/:id



POST   /analyses

GET    /analyses/:id

GET    /analyses/:id/status



POST   /guest/import



GET    /conversations/:projectId

POST   /conversations

```



Analysis submission tidak harus mengeksekusi computation secara synchronous: ElysiaJS membuat analysis record, memasukkan job ke BullMQ, lalu langsung mengembalikan job identifier ke frontend.



\*\*Object Storage API\*\* (dikelola ElysiaJS, menyediakan akses terkontrol ke MinIO/AIStor):



```text

GET    /storage/health

POST   /storage/upload

POST   /storage/presign

GET    /storage/:key

DELETE /storage/:key

```



Untuk file besar, `POST /storage/presign` dapat mengembalikan presigned URL agar browser melakukan upload langsung ke object storage. Credential MinIO/AIStor tidak pernah dikirim ke frontend.



\*\*Bioinformatics API\*\* (dikelola FastAPI): endpoint-endpoint ini didaftarkan sebagai tools pada Langflow Agent — IBM Granite menentukan kebutuhan analisis, lalu Langflow memanggil tool yang sesuai.



```text

POST /sequence/parse

POST /sequence/validate

POST /sequence/analyze

POST /sequence/gc-content

POST /sequence/orfs

POST /sequence/translate

POST /similarity/blast

GET  /ncbi/records/:accession

```



\### 4.11 Contoh Response Bio API



```json

{

&nbsp; "record": {

&nbsp;   "id": "NC\_XXXXXX",

&nbsp;   "description": "Epinephelus bontoides mitochondrion",

&nbsp;   "length": 16641

&nbsp; },

&nbsp; "composition": {

&nbsp;   "A": 4890,

&nbsp;   "T": 4670,

&nbsp;   "G": 2610,

&nbsp;   "C": 4471

&nbsp; },

&nbsp; "gc\_content": 42.5,

&nbsp; "orfs": \[]

}

```



\### 4.12 BLAST and NCBI Tool Contract



\*\*BLAST Tool\*\* — conceptual endpoint `POST /similarity/blast`, contoh structured output:



```json

{

&nbsp; "program": "blastn",

&nbsp; "hits": \[

&nbsp;   {

&nbsp;     "accession": "NC\_XXXXXX",

&nbsp;     "identity": 99.1,

&nbsp;     "e\_value": 0.0,

&nbsp;     "bit\_score": 2401.0

&nbsp;   }

&nbsp; ]

}

```



\*\*NCBI / GenBank Retrieval Tool\*\* — conceptual endpoint `GET /ncbi/records/:accession`. Tool ini mengambil biological record berdasarkan accession dari BLAST, bukan menganggap BLAST sendiri sebagai sumber seluruh metadata GenBank.



\### 4.13 API Security



Bio Service sebaiknya tidak diekspos secara bebas tanpa proteksi. Rekomendasi arsitektur:



```text

Frontend

&nbsp; → API Gateway / Reverse Proxy

&nbsp;      → ElysiaJS

&nbsp;      → Bio Service

```



Gateway menangani rate limiting, request size, TLS, routing, basic service protection, dan object storage access control.



---



\## 5. Flowchart Sistem



\### 5.1 Guest Flow



1\. User → Next.js → ElysiaJS API.

2\. ElysiaJS API → Langflow Agent → IBM Granite (via watsonx.ai).

3\. Tool selection → Bio Service / scientific tool lain.

4\. Structured result → Granite interpretation.

5\. ElysiaJS → Next.js → IndexedDB (local history).



Guest tidak membutuhkan record User di PostgreSQL untuk menjalankan basic tools. (Lihat 5.6–5.7 untuk versi lengkap yang memasukkan job queue.)



\### 5.2 Authenticated User Flow



1\. User → Next.js → ElysiaJS (authentication, project context, persistence).

2\. ElysiaJS → Langflow Agent → IBM Granite (via watsonx.ai) → scientific tools.

3\. Granite interpretation → ElysiaJS → PostgreSQL, lalu MinIO/AIStor untuk research file.

4\. Hasil ditampilkan kembali ke Next.js.



\### 5.3 Basic Agent Tool-Calling Flow



1\. User request diterima Langflow Agent + Granite.

2\. Granite memahami task dan merencanakan analisis yang diperlukan.

3\. Jika tidak membutuhkan scientific tool, Granite langsung menghasilkan response.

4\. Jika membutuhkan scientific tool, Langflow memanggil Biopython tool, menghasilkan structured result, yang kemudian diinterpretasikan Granite sebelum dikirim ke frontend.



\### 5.4 BLAST + NCBI / GenBank Research Flow



1\. Input FASTA diterima Langflow Agent + Granite.

2\. AI melakukan task understanding lalu analysis planning.

3\. Biopython menjalankan local analysis (validation, composition, GC content, ORF, translation bila diperlukan).

4\. Granite mengevaluasi hasil lokal dan menentukan apakah similarity search diperlukan.

5\. Jika tidak, sistem langsung menghasilkan final interpretation.

6\. Jika ya, Langflow memanggil BLAST tool dan memperoleh similarity hits (accession, identity, E-value, bit score, alignment).

7\. Granite memilih hit yang relevan, lalu Langflow memanggil NCBI/GenBank tool untuk mengambil record dan anotasi (organism, gene, CDS, product, features, references).

8\. Granite mengintegrasikan seluruh evidence menjadi final biological interpretation yang ditampilkan ke user.



BLAST dan NCBI retrieval tetap dipisahkan sebagai dua tool agar agent dapat memutuskan kapan annotation record benar-benar diperlukan.



\### 5.5 Research File Storage Flow



1\. User mengunggah FASTA / GenBank / Report melalui Next.js.

2\. ElysiaJS meminta presigned upload URL ke MinIO/AIStor.

3\. MinIO/AIStor mengembalikan object key.

4\. ElysiaJS menyimpan metadata + object key tersebut ke PostgreSQL.



Untuk proses download, backend memvalidasi authorization lalu menghasilkan presigned GET URL, sehingga object tetap private.



\### 5.6 Analysis Queue Architecture



Semua operasi yang berpotensi mahal atau memerlukan external service dijalankan melalui queue, terutama pada guest flow:



1\. Guest/authenticated user mengirim request lewat Next.js ke ElysiaJS.

2\. ElysiaJS memvalidasi request dan menerapkan rate limit.

3\. ElysiaJS membuat Analysis record di PostgreSQL.

4\. Job dimasukkan ke BullMQ, dengan Redis sebagai backing store.

5\. Bio Worker / BLAST Worker / AI Worker mengeksekusi job dan menghasilkan structured result.

6\. PostgreSQL memperbarui status dan result.

7\. Next.js melakukan polling atau menerima job status.



Queue policy minimal mencakup: maximum active jobs per worker, maximum queue depth, job timeout, retry with backoff, failed-job retention, dan result persistence di PostgreSQL.



Guest job identifier tidak bergantung pada database User — browser menyimpan anonymous session/job reference agar guest dapat melihat progress tanpa login. Redis dipakai untuk queue execution state dan koordinasi worker, sedangkan PostgreSQL dipakai untuk durable application state, sehingga restart Redis atau worker bukan satu-satunya sumber data analisis.



\### 5.7 Guest Analysis Queue Flow



Karena anonymous/guest request dapat datang tanpa login, computation berat tidak boleh dijalankan langsung pada request HTTP:



1\. Guest user mengirim request lewat Next.js ke ElysiaJS.

2\. ElysiaJS menjalankan rate limit dan validation.

3\. PostgreSQL membuat analysis record dengan status `queued`.

4\. Job masuk ke BullMQ, dengan Redis sebagai backing store.

5\. Bio Worker / BLAST Worker / AI Worker mengeksekusi job dan menghasilkan structured result.

6\. PostgreSQL memperbarui record analysis.

7\. Next.js memeriksa job status dan menampilkan hasil ke user.



Contoh transisi state: `queued → processing → completed`, dengan cabang `→ failed` bila terjadi error. Worker concurrency harus dibatasi agar jumlah job paralel sesuai kapasitas CPU, memory, kuota external API, dan batas AI provider.



---



\## 6. SDLC Pengembangan secara Iteratif



Model pengembangan menggunakan pendekatan \*\*iterative development\*\*, di mana setiap iterasi menghasilkan versi aplikasi yang dapat diuji, mengikuti siklus: Plan → Design → Build → Test → Evaluate → Improve → Next Iteration. Tidak seluruh fitur dibangun sekaligus.



\*\*Iteration 0 — Requirement and Scope Definition\*\*

\*Goal:\* mendefinisikan MVP, menghindari scope creep, dan mengonfirmasi requirement IBM.

\- \[ ] Define user persona

\- \[ ] Define biological analysis scope

\- \[ ] Confirm IBM required technology

\- \[ ] Define supported file formats

\- \[ ] Select demo dataset

\- \[ ] Define success criteria

\- \[ ] Define guest vs authenticated experience

\*Output:\* spesifikasi MVP yang jelas.



\*\*Iteration 1 — Scientific Core\*\*

\*Goal:\* membuktikan scientific computation bekerja dengan benar.

\- \[ ] FASTA parser

\- \[ ] Sequence validation

\- \[ ] Metadata extraction

\- \[ ] Nucleotide composition

\- \[ ] GC content

\- \[ ] Basic ORF detection

\- \[ ] Translation

\- \[ ] Unit testing

\*System:\* FASTA → Biopython → JSON result. Belum melibatkan AI, database, maupun frontend.



\*\*Iteration 2 — Bio Service API\*\*

\*Goal:\* mengekspos scientific core sebagai reusable service.

\- \[ ] FastAPI application

\- \[ ] Pydantic schemas

\- \[ ] `/sequence/analyze`

\- \[ ] `/sequence/gc-content`

\- \[ ] `/sequence/orfs`

\- \[ ] `/sequence/translate`

\- \[ ] OpenAPI documentation

\- \[ ] Integration tests

\*Output:\* Bio Service Container.



\*\*Iteration 3 — AI Agent Integration\*\*

\*Goal:\* membuktikan Langflow Agent + IBM Granite dapat memahami task, memilih scientific tool, menjalankan analisis, dan menjelaskan hasilnya.

\- \[ ] Langflow setup

\- \[ ] Koneksi IBM Granite melalui watsonx.ai

\- \[ ] Bio API terdaftar sebagai Langflow tools

\- \[ ] Intent understanding

\- \[ ] Analysis planning

\- \[ ] Tool selection

\- \[ ] Multi-step tool calling

\- \[ ] Structured tool result handling

\- \[ ] Scientific interpretation guardrails



\*Target demo:\*

```text

User: "Find the longest ORF and translate it."

1\. Granite understands the task

2\. Langflow calls find\_orfs

3\. Granite identifies the longest ORF

4\. Langflow calls translate\_orf

5\. Granite explains the result

```



\*\*Iteration 4 — Basic Frontend\*\*

\*Goal:\* user dapat menggunakan aplikasi dari browser.

\- \[ ] Landing page

\- \[ ] FASTA uploader

\- \[ ] Analysis loading state

\- \[ ] Analysis dashboard

\- \[ ] Nucleotide chart

\- \[ ] GC card

\- \[ ] ORF result

\- \[ ] AI interpretation

\- \[ ] Chat interface



\*\*Iteration 5 — Guest Mode\*\*

\*Goal:\* aplikasi dapat digunakan tanpa authentication.

\- \[ ] IndexedDB setup

\- \[ ] Save local analysis

\- \[ ] Load local history

\- \[ ] Delete local history

\- \[ ] Guest session UX

\*Output:\* Guest → use tool → history tersimpan secara lokal.



\*\*Iteration 6 — Application Backend\*\*

\*Goal:\* menambahkan persistence, object storage, dan job queue dengan application layer yang ringan.

\- \[ ] ElysiaJS + Bun

\- \[ ] Drizzle ORM

\- \[ ] PostgreSQL

\- \[ ] MinIO / AIStor object storage

\- \[ ] S3-compatible storage client

\- \[ ] Upload / presign API

\- \[ ] Object metadata + object key persistence

\- \[ ] Project API

\- \[ ] Sequence metadata

\- \[ ] Analysis history

\- \[ ] Conversation persistence

\- \[ ] Redis integration

\- \[ ] BullMQ queue setup

\- \[ ] Analysis job lifecycle

\- \[ ] Worker concurrency limits

\- \[ ] Job retry / backoff

\- \[ ] Queue status API

\- \[ ] Langflow API integration



\*\*Iteration 7 — Optional Authentication\*\*

\*Goal:\* authentication menjadi value-add, bukan gatekeeper.

\- \[ ] Register

\- \[ ] Login

\- \[ ] Auth middleware

\- \[ ] User ownership

\- \[ ] Cloud history

\- \[ ] Project persistence

\- \[ ] Authenticated object storage access



\*\*Iteration 8 — Guest Migration\*\*

\*Goal:\* guest dapat membawa local history ke account.

\*Flow:\* Guest IndexedDB → register/login → import local analyses → ElysiaJS → PostgreSQL.

\- \[ ] Guest import endpoint

\- \[ ] Local/cloud duplicate handling

\- \[ ] Migration confirmation UI

\- \[ ] Migration tests



\*\*Iteration 8.5 — BLAST and NCBI Integration\*\*

\*Goal:\* membuktikan agent dapat melakukan similarity search dan mengambil annotation evidence dari NCBI/GenBank.

\- \[ ] BLASTN tool integration

\- \[ ] Structured BLAST hit parser

\- \[ ] Accession extraction

\- \[ ] NCBI/GenBank record retrieval tool

\- \[ ] Tool result schemas

\- \[ ] Langflow multi-tool workflow test

\- \[ ] Evidence-aware Granite prompt

\- \[ ] Error / no-hit handling



\*Target demo:\*

```text

1\. User uploads unknown DNA sequence

2\. Biopython analyzes locally

3\. Langflow calls BLASTN

4\. BLAST returns candidate accession

5\. Langflow retrieves GenBank record

6\. Granite explains the sequence using tool evidence

```



\*\*Iteration 9 — UX and Reliability\*\*

\*Goal:\* menjadikan MVP layak dipresentasikan.

\- \[ ] Error handling

\- \[ ] Upload validation

\- \[ ] Loading feedback

\- \[ ] Responsive UI

\- \[ ] Retry states

\- \[ ] Empty states

\- \[ ] Scientific disclaimer

\- \[ ] Queue overflow handling

\- \[ ] Concurrent guest request test

\- \[ ] Worker timeout / retry test

\- \[ ] Polished demo flow



\*\*Iteration 10 — Deployment\*\*



Containers yang dibangun: frontend, application-api (ElysiaJS + Bun), bio-service (FastAPI + Biopython), langflow, postgres, redis, bio/analysis worker, dan minio. External AI provider mengikuti alur Langflow → watsonx.ai API → IBM Granite.



\- \[ ] Docker Compose

\- \[ ] Environment variables

\- \[ ] Langflow configuration

\- \[ ] watsonx.ai credentials

\- \[ ] API gateway / reverse proxy

\- \[ ] CI/CD

\- \[ ] Deployment test

\- \[ ] MinIO / AIStor bucket configuration

\- \[ ] Storage credentials via environment/secrets

\- \[ ] Object storage healthcheck

\- \[ ] Private bucket policy validation

\- \[ ] Redis configuration

\- \[ ] BullMQ worker deployment

\- \[ ] Queue concurrency limits

\- \[ ] Queue monitoring / healthcheck



\*\*Iteration 11 — Hackathon Finalization\*\*

\*Focus:\* reliability, demo clarity, scientific credibility, agent behavior, storytelling.

\- \[ ] MVP

\- \[ ] Technical diagram

\- \[ ] Documentation

\- \[ ] Demo video

\- \[ ] Business/product explanation

\- \[ ] Final presentation



Tidak menambahkan fitur baru secara acak pada iterasi ini.



\*\*Iteration 12 — Future Scaling\*\*



Redis + BullMQ sudah menjadi bagian MVP, karena guest access dapat menghasilkan concurrent job tanpa authentication. Future scaling di sini berfokus pada peningkatan kapasitas dan reliability, bukan menambahkan queue dari nol.



Potensi penambahan: multiple queue workers, worker pool terpisah untuk Bio/BLAST/AI, Redis high availability/scaling, queue priority classes, distributed rate limiting, analysis result cache, large genome processing, job deduplication, dan automatic worker autoscaling.



Kondisi pemicu: high concurrent usage, large queue depth, analisis memakan waktu beberapa detik atau lebih, large genome processing, external API bottleneck, kebutuhan priority job, dan worker scaling.



---



\## Final MVP Definition



Proyek dianggap berhasil secara teknis ketika alur dasar berikut berjalan dengan andal:



1\. User mengunggah FASTA dan memberikan task.

2\. ElysiaJS memvalidasi request dan membuat analysis job.

3\. BullMQ memasukkan job tersebut ke antrean di Redis.

4\. Worker menjalankan Langflow Agent + IBM Granite + scientific tools.

5\. Biopython menjalankan deterministic analysis.

6\. Structured result dikembalikan ke worker/Granite.

7\. PostgreSQL menyimpan status dan hasil analisis secara durable.

8\. Hasil ditampilkan di frontend.

9\. Guest history tersimpan secara lokal.



Untuk similarity-based research workflow: local sequence analysis → BLAST similarity search → BLAST hit + accession → NCBI/GenBank record retrieval → Granite menggabungkan local analysis, BLAST evidence, dan anotasi menjadi final research-oriented interpretation.



Untuk authenticated users: login → project tersimpan melalui ElysiaJS + Drizzle → PostgreSQL → MinIO/AIStor untuk research file → history tersinkronisasi.



Pada titik ini: \*\*hentikan penambahan fitur baru dan fokus pada peningkatan reliability, UX, scientific credibility, dan demo quality.\*\*



---



\## Final Project Pitch



> \*\*Genomic Insight Agent is an AI-powered bioinformatics research assistant that combines deterministic biological computation with agentic reasoning to transform raw DNA sequences into understandable and actionable research insights.\*\*


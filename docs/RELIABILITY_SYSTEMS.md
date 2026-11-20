# ILYASS AI reliability systems

This document distinguishes implemented code from deployment requirements and source material that has not yet been loaded.

## Existing systems retained
- Image Intelligence: original image plus detail crops, pre-solve transcription, uncertainty review, and transcript reuse.
- Mathematical verification: safe expression parser, claim extraction, code-based recalculation, and static answer checks.
- Independent review: strict verification can compare a separate solution and independently reread images.
- Panache: multi-stage solve, independent solution, arithmetic review, and a final correction/rewrite pass.
- Moroccan subject rubrics: subject-specific methodology prompts already exist.

## Added in this branch

### Unit and dimension checks
src/server-ai/verify/unitEngine.ts parses a conservative subset of SI units and compares dimensions. Static verification flags only equations containing exactly two explicitly marked LaTeX units on one line. Unknown or ambiguous expressions are skipped rather than guessed.

This is dimensional consistency, not a complete conversion engine or a replacement for a physics solver.

### Humanities rubric review
Standard verification now invokes the existing subject-specific rubric for Arabic, Islamic education, philosophy, history/geography, French, and English. Strict verification continues to review scientific subjects too. Rubric comments remain advisory, not a definitive mark.

### Feedback collection
AnswerFeedback appears under completed answers. Students can report correctness, select an issue category, optionally add a score out of 20, and leave a short note.
The API verifies the Supabase access token before saving. Feedback is stored only after student submission; it is not silently copied or sent to model training. Entries require review before being treated as ground truth.
Apply supabase/migrations/20261116000100_answer_feedback.sql.

### Moroccan curriculum retrieval
The schema stores source metadata (publisher, URL, year, subject, grade, track, **document type**: framework, lesson, exam, correction or guide) and text passages with their page and section title. Full-text search only sees sources marked official **and** verified. The ingestion endpoint is protected by CURRICULUM_INGEST_KEY. Retrieved passages are injected into the solve prompt with source labels, document type, page and URL.
Apply supabase/migrations/20261116000200_curriculum_knowledge_base.sql, then supabase/migrations/20261120000100_curriculum_search_v2.sql (PostgreSQL 13 or newer; it rebuilds the search column, so apply it before the corpus is large).

#### How a question is searched
1. `selectSearchTerms` (src/lib/curriculumText.ts) keeps the meaningful words of the question and drops Arabic, Darija, French and English filler. Latin plurals also send their singular.
2. `search_curriculum_chunks_v2` normalises both stored text and words the same way (`normalize_curriculum_text`): hamza forms of alef, ى/ي, ة/ه, diacritics, tatweel, Arabic-Indic digits, a leading definite article (ال, وال, بال...), French accents and œ/æ. A passage matches if it contains ANY word (longer words match as prefixes, so plurals and suffixes still hit). The old function used to require every word of the sentence, so it almost never matched. The old function still exists and now calls v2.
3. The app reranks the candidates (`rerankChunks`: BM25 over the candidate set scaled by how many question words the passage covers), drops passages that share fewer than two words with a multi-word question, and allows at most two passages per document.
4. If v2 is not installed yet (HTTP 404), the app falls back to the old search, which cannot filter by document type.

The TypeScript normaliser mirrors the SQL one; both are pinned by the same example pairs in curriculumText.test.ts.

#### Adding an official document
1. Download the official PDF yourself from its publisher. The assistant's cloud workspace cannot reach official sites, and nothing is bundled in this repository.
2. `node scripts/curriculum-ingest.ts file.pdf --title "..." --source-name "..." --source-url https://... --subject math --doc-type exam --year 2023 --official` (Node 22.18+, and `pdftotext` for PDFs). Without `--verified` the source is stored but hidden from students. This writes `file.review.md` and `file.seed.sql`; nothing is sent anywhere.
3. Read the review report and compare the sampled passages with the original word for word (digits, formulas, Arabic letters, barème points). Text that comes out letter-reversed, or a PDF with no text layer (scanned: OCR is not included), is refused.
4. Run again with `--official --verified` (or run the verify statement at the end of the seed file), then paste the SQL into the database's SQL editor. It is idempotent: the file's SHA-256 is stored, so running it twice inserts nothing the second time. `--json` writes the same data for POST /api/curriculum-ingest, which now accepts `docType`, `sourceHash` (a repeated file gets 409), passages with page metadata, and up to 400 passages.
5. Write evaluation cases from the ingested text (see docs/curriculum-eval.example.json) and run `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/curriculum-eval.ts cases.json --min-hit 0.8`. It reports hit@1, hit@k, MRR and how often an out-of-scope question wrongly returns something.

Set server environment variables:
- CURRICULUM_INGEST_KEY: a strong private secret used only by trusted ingestion jobs.
- CURRICULUM_RAG_ENABLED=true: enables retrieval at solve time.
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

No official Moroccan curriculum documents are bundled in this repository. The RAG corpus remains empty until trusted documents are ingested. Never set verified=true for a source that has not been checked against its original official document.

### Atomic daily quota and authenticated identity
consume_daily_usage increments daily usage atomically, avoiding the old read-then-write race. Browser requests now send the Supabase session when available, and quota is keyed to the verified account ID for signed-in students. Guest use remains keyed to the client-generated device UUID and can still be reset by a determined user; stronger anonymous abuse prevention requires an edge/IP-based limiter.

Migration 20261116000300_atomic_daily_quota.sql was added to main separately and is a prerequisite for this branch's quota implementation.

## Deployment order
1. Apply the feedback and curriculum migrations in Supabase (curriculum: 20261116000200, then 20261120000100).
2. Confirm the atomic quota migration is present (it is already on main).
3. Configure the server-only secrets listed above.
4. Ingest a small, reviewed set of official 2BAC sources first; verify retrieval and citations before adding more.
5. Run CI, then manually test signed-in and guest flows, feedback submission, and image/text solving.

## Explicit limitations
- This branch does not add a hosted Python/SymPy service. The existing TypeScript expression parser and claim verifier are retained; deploying SymPy requires a separately hosted and secured Python service and an explicit latency/cost budget.
- The new unit checker checks dimensions only for unambiguous explicit unit pairs. It does not yet validate every conversion, significant-figure rule, or arbitrary compound expression.
- The knowledge base is infrastructure, not a pre-filled official corpus. Retrieval quality on real Moroccan documents has not been measured yet; the tests use invented sentences, and the SQL was exercised on temporary objects in a PostgreSQL 17 test database, not on the app's own database.
- Search is lexical. An Arabic question does not find a French passage (and the reverse) until a bilingual glossary or embeddings are added. A leading و attached to a word is not stripped, so "وسلم" and "سلم" are different words.
- Feedback is collected for human review; it is not automatically used to fine-tune or change answers.
- Panache already performs correction before its final answer. Standard/accurate modes retain post-answer verification and advisory findings; this branch does not silently rewrite their streamed answers after delivery.

## CI
.github/workflows/ci.yml runs bun install --frozen-lockfile, bun run test, and bun run build on pushes and pull requests to main.
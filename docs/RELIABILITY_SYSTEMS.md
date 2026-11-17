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
The schema stores source metadata and text chunks, and exposes full-text search restricted to documents marked official and verified. The ingestion endpoint is protected by CURRICULUM_INGEST_KEY. Retrieved passages are injected into the solve prompt with source labels and URLs.
Apply supabase/migrations/20261116000200_curriculum_knowledge_base.sql.

Set server environment variables:
- CURRICULUM_INGEST_KEY — a strong private secret used only by trusted ingestion jobs.
- CURRICULUM_RAG_ENABLED=true — enables retrieval at solve time.
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

No official Moroccan curriculum documents are bundled in this repository. The RAG corpus remains empty until trusted documents, publication years, source URLs, and reviewed text chunks are ingested. Never set verified=true for a source that has not been checked against its original official document.

The ingestion endpoint accepts up to 100 text chunks per source. Send title, sourceName, sourceUrl, subject, grade, optional track and sourceYear, isOfficial, verified, and chunks; authorize with Bearer CURRICULUM_INGEST_KEY.

### Atomic daily quota and authenticated identity
consume_daily_usage increments daily usage atomically, avoiding the old read-then-write race. Browser requests now send the Supabase session when available, and quota is keyed to the verified account ID for signed-in students. Guest use remains keyed to the client-generated device UUID and can still be reset by a determined user; stronger anonymous abuse prevention requires an edge/IP-based limiter.

Migration 20261116000300_atomic_daily_quota.sql was added to main separately and is a prerequisite for this branch's quota implementation.

## Deployment order
1. Apply the feedback and curriculum migrations in Supabase.
2. Confirm the atomic quota migration is present (it is already on main).
3. Configure the server-only secrets listed above.
4. Ingest a small, reviewed set of official 2BAC sources first; verify retrieval and citations before adding more.
5. Run CI, then manually test signed-in and guest flows, feedback submission, and image/text solving.

## Explicit limitations
- This branch does not add a hosted Python/SymPy service. The existing TypeScript expression parser and claim verifier are retained; deploying SymPy requires a separately hosted and secured Python service and an explicit latency/cost budget.
- The new unit checker checks dimensions only for unambiguous explicit unit pairs. It does not yet validate every conversion, significant-figure rule, or arbitrary compound expression.
- The knowledge base is infrastructure, not a pre-filled official corpus.
- Feedback is collected for human review; it is not automatically used to fine-tune or change answers.
- Panache already performs correction before its final answer. Standard/accurate modes retain post-answer verification and advisory findings; this branch does not silently rewrite their streamed answers after delivery.

## CI
.github/workflows/ci.yml runs bun install --frozen-lockfile, bun run test, and bun run build on pushes and pull requests to main.
-- Curriculum search v2: Arabic/French-aware matching and document types.
--
-- Why: v1 used websearch_to_tsquery over raw text, which ANDs every word of the
-- student's question (a whole sentence almost never matches one chunk) and
-- treats "المعادلة", "معادلة", "équation" and "equations" as unrelated words.
--
-- Requires PostgreSQL 13 or newer (normalize(), tsvector_to_array()).
-- The curriculum corpus is expected to be empty or small when this runs, because
-- the search_vector column is rebuilt (table rewrite).

-- 1. Text normalisation, applied identically to stored chunks and to queries.
--    Mirrored in src/lib/curriculumText.ts; keep both in sync (tests cover the TS side).
CREATE OR REPLACE FUNCTION public.normalize_curriculum_text(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = ''
AS $$
  SELECT regexp_replace(            -- drop the Arabic definite article (and wa/ba/ka/fa + al) on longer words
    regexp_replace(                 -- drop Arabic marks (tashkeel, dagger alef, tatweel)
      regexp_replace(               -- drop invisible direction/format characters that PDF extraction leaves
        translate(                  -- fold Latin accents, Arabic letter variants, Arabic-Indic digits
          replace(replace(lower(normalize(input, NFKC)), 'œ', 'oe'), 'æ', 'ae'),
          'àâäáãåçéèêëíìîïñóòôöõúùûüýÿأإآٱىؤئة٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
          'aaaaaaceeeeiiiinooooouuuuyyاااايويه01234567890123456789'
        ),
        '[\u00AD\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]', '', 'g'
      ),
      '[\u064B-\u065F\u0670\u0640]', '', 'g'
    ),
    '(^|[^\u0621-\u064A])(?:وال|بال|كال|فال|ال)(?=[\u0621-\u064A]{3})', '\1', 'g'
  )
$$;

-- 2. Document type, so exam and correction material can be requested separately
--    from lessons (needed by the Moroccan exam evaluator), plus a file hash that
--    makes re-ingesting the same PDF detectable.
ALTER TABLE public.curriculum_sources
  ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'lesson'
    CHECK (doc_type IN ('framework','lesson','exam','correction','guide'));
ALTER TABLE public.curriculum_sources
  ADD COLUMN IF NOT EXISTS source_hash text
    CHECK (source_hash IS NULL OR source_hash ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX IF NOT EXISTS curriculum_sources_hash_idx
  ON public.curriculum_sources(source_hash) WHERE source_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS curriculum_sources_doc_type_idx
  ON public.curriculum_sources(subject, grade, doc_type);

-- 3. Rebuild the generated search column over normalised text.
DROP INDEX IF EXISTS public.curriculum_chunks_search_idx;
ALTER TABLE public.curriculum_chunks DROP COLUMN IF EXISTS search_vector;
ALTER TABLE public.curriculum_chunks
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', public.normalize_curriculum_text(content))) STORED;
CREATE INDEX curriculum_chunks_search_idx
  ON public.curriculum_chunks USING gin(search_vector);

-- 4. Search v2. The caller passes the meaningful words of the question; any of
--    them may match (OR), and longer words match as prefixes so that French
--    plurals/conjugations and Arabic suffixes still hit. Ranking uses cover
--    density; the application reranks the candidates.
CREATE OR REPLACE FUNCTION public.search_curriculum_chunks_v2(
  search_terms text[],
  filter_subject text,
  filter_grade text DEFAULT '2bac',
  filter_track text DEFAULT NULL,
  filter_doc_types text[] DEFAULT NULL,
  result_limit integer DEFAULT 12
)
RETURNS TABLE (
  chunk_id uuid,
  source_id uuid,
  chunk_index integer,
  content text,
  metadata jsonb,
  title text,
  source_name text,
  source_url text,
  source_year integer,
  subject text,
  grade text,
  track text,
  doc_type text,
  rank real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH words AS (
    SELECT unnest(tsvector_to_array(
      to_tsvector('simple', public.normalize_curriculum_text(array_to_string(search_terms[1:24], ' ')))
    )) AS word
  ),
  q AS (
    SELECT to_tsquery('simple', string_agg(
             CASE WHEN char_length(word) >= 4
                  THEN quote_literal(word) || ':*'
                  ELSE quote_literal(word) END,
             ' | ')) AS tsq
    FROM words
  )
  SELECT c.id, s.id, c.chunk_index, c.content, c.metadata,
         s.title, s.source_name, s.source_url, s.source_year,
         s.subject, s.grade, s.track, s.doc_type,
         ts_rank_cd(c.search_vector, q.tsq, 1)::real AS rank
  FROM q
  CROSS JOIN public.curriculum_chunks c
  JOIN public.curriculum_sources s ON s.id = c.source_id
  WHERE s.is_official = true
    AND s.verified_at IS NOT NULL
    AND s.subject = filter_subject
    AND s.grade = filter_grade
    AND (filter_track IS NULL OR s.track IS NULL OR s.track = filter_track)
    AND (filter_doc_types IS NULL OR s.doc_type = ANY(filter_doc_types))
    AND c.search_vector @@ q.tsq
  ORDER BY rank DESC, s.source_year DESC NULLS LAST, c.chunk_index
  LIMIT LEAST(GREATEST(result_limit, 1), 30);
$$;

-- 5. Keep the v1 entry point working for an application build that has not
--    switched over yet. Same columns as before, now backed by v2.
CREATE OR REPLACE FUNCTION public.search_curriculum_chunks(
  search_query text,
  filter_subject text,
  filter_grade text DEFAULT '2bac',
  filter_track text DEFAULT NULL,
  result_limit integer DEFAULT 5
)
RETURNS TABLE (
  chunk_id uuid,
  content text,
  title text,
  source_name text,
  source_url text,
  source_year integer,
  subject text,
  grade text,
  track text,
  rank real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT r.chunk_id, r.content, r.title, r.source_name, r.source_url,
         r.source_year, r.subject, r.grade, r.track, r.rank
  FROM public.search_curriculum_chunks_v2(
    regexp_split_to_array(trim(search_query), '\s+'),
    filter_subject, filter_grade, filter_track, NULL, result_limit
  ) r;
$$;

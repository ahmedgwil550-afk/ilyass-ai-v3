-- Verified Moroccan curriculum corpus. No content is trusted until explicitly ingested and verified.
CREATE TABLE IF NOT EXISTS public.curriculum_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  source_name text NOT NULL CHECK (char_length(source_name) BETWEEN 1 AND 200),
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  subject text NOT NULL CHECK (subject IN ('math','physics','chemistry','biology','french','arabic','english','philosophy','history','islamic')),
  grade text NOT NULL DEFAULT '2bac',
  track text,
  source_year integer CHECK (source_year IS NULL OR source_year BETWEEN 1990 AND 2100),
  is_official boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.curriculum_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.curriculum_sources(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content text NOT NULL CHECK (char_length(content) BETWEEN 20 AND 12000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  UNIQUE(source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS curriculum_chunks_search_idx
  ON public.curriculum_chunks USING gin(search_vector);
CREATE INDEX IF NOT EXISTS curriculum_sources_filter_idx
  ON public.curriculum_sources(subject, grade, track, verified_at);

ALTER TABLE public.curriculum_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read verified official curriculum sources" ON public.curriculum_sources;
CREATE POLICY "Read verified official curriculum sources"
  ON public.curriculum_sources FOR SELECT TO authenticated
  USING (is_official = true AND verified_at IS NOT NULL);
DROP POLICY IF EXISTS "Read verified official curriculum chunks" ON public.curriculum_chunks;
CREATE POLICY "Read verified official curriculum chunks"
  ON public.curriculum_chunks FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.curriculum_sources s
    WHERE s.id = source_id AND s.is_official = true AND s.verified_at IS NOT NULL
  ));

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
  SELECT c.id, c.content, s.title, s.source_name, s.source_url,
         s.source_year, s.subject, s.grade, s.track,
         ts_rank(c.search_vector, websearch_to_tsquery('simple', search_query)) AS rank
  FROM public.curriculum_chunks c
  JOIN public.curriculum_sources s ON s.id = c.source_id
  WHERE s.is_official = true
    AND s.verified_at IS NOT NULL
    AND s.subject = filter_subject
    AND s.grade = filter_grade
    AND (filter_track IS NULL OR s.track IS NULL OR s.track = filter_track)
    AND c.search_vector @@ websearch_to_tsquery('simple', search_query)
  ORDER BY rank DESC, s.source_year DESC NULLS LAST
  LIMIT LEAST(GREATEST(result_limit, 1), 8);
$$;

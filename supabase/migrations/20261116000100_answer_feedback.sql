-- Student feedback is private and opt-in. Raw answers are not copied into this table.
CREATE TABLE IF NOT EXISTS public.answer_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answer_id text NOT NULL CHECK (char_length(answer_id) BETWEEN 1 AND 120),
  subject text NOT NULL CHECK (subject IN ('math','physics','chemistry','biology','french','arabic','english','philosophy','history','islamic','other')),
  rating text NOT NULL CHECK (rating IN ('correct','incorrect')),
  issue_type text CHECK (issue_type IS NULL OR issue_type IN ('image_reading','calculation','scientific_fact','method','formatting','incomplete','other')),
  score numeric(4,1) CHECK (score IS NULL OR (score >= 0 AND score <= 20)),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  reviewed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS answer_feedback_created_at_idx
  ON public.answer_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS answer_feedback_issue_type_idx
  ON public.answer_feedback (issue_type, created_at DESC);

ALTER TABLE public.answer_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read their own answer feedback" ON public.answer_feedback;
CREATE POLICY "Users can read their own answer feedback"
  ON public.answer_feedback FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can submit their own answer feedback" ON public.answer_feedback;
CREATE POLICY "Users can submit their own answer feedback"
  ON public.answer_feedback FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

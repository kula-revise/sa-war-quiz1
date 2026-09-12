/* Kula Revise, Grade 10 content quiz. Connection settings.
   Edit this file only. Nothing else needs changing to point at Supabase. */

/* Supabase dashboard, Connect dialog, or Project Settings then Data API. */
window.KULA_SUPABASE_URL = 'https://bfefisvoydlszezcadst.supabase.co';

/* The publishable key. New projects look like sb_publishable_...
   Older projects call the same thing the anon key. Either works.
   Never the secret or service role key. That one must not appear in a file
   a learner can open. The publishable key is meant to be public: the policies
   let it insert rows and read nothing at all. */
window.KULA_SUPABASE_ANON_KEY = 'sb_publishable_43A-VYKwWidwSUfcPUMOkA_kMAP5DHV';

/* Optional. Lets a teacher filter one class, and scopes the middle score. */
window.KULA_CLASS_CODE = null;

/* Set to false to keep names on the phone and send only the device reference. */
window.KULA_SEND_NAMES = true;

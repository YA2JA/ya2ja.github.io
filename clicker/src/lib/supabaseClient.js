import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lxpvezeppvkvozuneqly.supabase.co';
const supabaseAnonKey = 'sb_publishable_Pew-qHy5BWlW6w0KVlkxIQ_C9JYUFPg';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
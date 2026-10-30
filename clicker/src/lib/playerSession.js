import { supabase } from './supabaseClient';

/**
 * @typedef {{
 *   id: string | number,
 *   email: string,
 *   name: string | null,
 *   group: { id: string | number, name: string } | null
 * }} Player
 */

const PLAYER_EMAIL_KEY = 'player_email';

/** @returns {string | null} */
export function getSavedPlayerEmail() {
    return localStorage.getItem(PLAYER_EMAIL_KEY);
}

/** @param {string} email */
export function savePlayerEmail(email) {
    localStorage.setItem(PLAYER_EMAIL_KEY, email);
}

export function clearPlayerEmail() {
    localStorage.removeItem(PLAYER_EMAIL_KEY);
}

/**
 * @param {string} email
 * @returns {Promise<{ player: Player | null, error: import('@supabase/supabase-js').PostgrestError | null }>}
 */
export async function findPlayerByEmail(email) {
    const { data, error } = await supabase
        .from('player')
        .select('*, group(id, name)')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();

    return { player: data, error };
}

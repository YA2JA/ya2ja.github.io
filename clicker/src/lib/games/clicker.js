import { supabase } from '../supabaseClient';

const CLICKER_TABLE = 'ClickerCompetition';

/**
 * @param {string | number} playerId
 * @param {number} extraClicks
 */
export async function recordClick(playerId, extraClicks = 0) {
    const numberOfClicks = 1 + extraClicks;
    return supabase
        .from(CLICKER_TABLE)
        .insert(Array.from({ length: numberOfClicks }, () => ({ author_id: playerId })));
}

export async function fetchClickerSettings() {
    return supabase
        .from('clicker_game_settings')
        .select('bonus_min_clicks, bonus_max_clicks, family_coefficient_per_player')
        .eq('id', true)
        .maybeSingle();
}

/**
 * @param {string | number | null | undefined} groupId
 * @returns {Promise<{ playerIds: Set<string>, error: import('@supabase/supabase-js').PostgrestError | null }>}
 */
export async function fetchActiveFamilyPlayers(groupId) {
    if (groupId === null || groupId === undefined) {
        return { playerIds: new Set(), error: null };
    }

    const { data: familyPlayers, error: playerError } = await supabase
        .from('player')
        .select('id')
        .eq('groupId', groupId);

    if (playerError || !familyPlayers) {
        return { playerIds: new Set(), error: playerError };
    }

    const familyPlayerIds = familyPlayers.map((player) => String(player.id));
    if (familyPlayerIds.length === 0) return { playerIds: new Set(), error: null };

    const activeChecks = await Promise.all(
        familyPlayerIds.map((playerId) =>
            supabase
                .from(CLICKER_TABLE)
                .select('id')
                .eq('author_id', playerId)
                .limit(1)
                .maybeSingle()
        )
    );
    const failedCheck = activeChecks.find(({ error }) => error);

    if (failedCheck?.error) {
        return { playerIds: new Set(), error: failedCheck.error };
    }

    return {
        playerIds: new Set(
            activeChecks.flatMap((check, index) => check.data ? [familyPlayerIds[index]] : [])
        ),
        error: null
    };
}

/** @returns {Promise<Array<{ id: string | number, name: string, clicks: number }>>} */
export async function fetchTeamScores() {
    const { data: groups, error: groupError } = await supabase
        .from('group')
        .select('id, name');

    if (groupError || !groups) return [];

    /** @type {Record<string, { id: string | number, name: string, clicks: number }>} */
    const scores = Object.fromEntries(
        groups.map(/** @param {{ id: string | number, name: string }} group */ (group) => [
            group.id,
            { ...group, clicks: 0 }
        ])
    );

    const { data: clicks, error: clickError } = await supabase
        .from(CLICKER_TABLE)
        .select('id, player!inner(groupId)');

    if (!clickError && clicks) {
        clicks.forEach(/** @param {{ player: { groupId: string | number }[] | { groupId: string | number } | null }} click */ ({ player }) => {
            const relatedPlayer = Array.isArray(player) ? player[0] : player;
            const groupScore = relatedPlayer ? scores[relatedPlayer.groupId] : undefined;
            if (groupScore) groupScore.clicks += 1;
        });
    }

    return Object.values(scores).sort((a, b) => b.clicks - a.clicks);
}

/**
 * @returns {Promise<{
 *   scores: Array<{ id: string | number, name: string, groupName: string, clicks: number }>,
 *   error: import('@supabase/supabase-js').PostgrestError | null
 * }>}
 */
export async function fetchPlayerScores() {
    const { data: players, error: playerError } = await supabase
        .from('player')
        .select('id, name, group(name)');

    if (playerError || !players) return { scores: [], error: playerError };

    /** @type {Record<string, { id: string | number, name: string, groupName: string, clicks: number }>} */
    const scores = Object.fromEntries(
        players.map(/** @param {{ id: string | number, name: string | null, group: { name: string }[] | { name: string } | null }} player */ (player) => {
            const group = Array.isArray(player.group) ? player.group[0] : player.group;
            return [
                player.id,
                {
                    id: player.id,
                    name: player.name || 'Guerrier Anonyme',
                    groupName: group?.name || 'Sans Équipe',
                    clicks: 0
                }
            ];
        })
    );

    const { data: clicks, error: clickError } = await supabase
        .from(CLICKER_TABLE)
        .select('author_id');

    if (!clickError && clicks) {
        clicks.forEach(/** @param {{ author_id: string | number | null }} click */ ({ author_id: authorId }) => {
            if (authorId && scores[authorId]) scores[authorId].clicks += 1;
        });
    }

    return {
        scores: Object.values(scores).sort((a, b) => b.clicks - a.clicks),
        error: clickError
    };
}

/**
 * @param {string} channelName
 * @param {() => void | Promise<void>} onInsert
 * @returns {import('@supabase/supabase-js').RealtimeChannel}
 */
export function subscribeToClickerScores(channelName, onInsert) {
    return supabase
        .channel(channelName)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: CLICKER_TABLE
        }, onInsert)
        .subscribe();
}

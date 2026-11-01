<svelte:head>
    <title>Scores des Maisons - Tournoi des Maisons</title>
</svelte:head>

<script>
    import { onMount } from 'svelte';
    import { supabase } from '#lib/supabaseClient';
    import { fetchPlayerScores, fetchTeamScores } from '#lib/games/clicker';
    import Navigation from '#lib/components/Navigation.svelte';

    /** @type {Array<{ id: string | number, name: string, clicks: number }>} */
    let teamScores = $state([]);
    /** @type {Array<{ id: string | number, name: string, groupName: string, clicks: number }>} */
    let playerScores = $state([]);
    /** @type {{ id: string | number, name: string, clicks: number } | null} */
    let selectedHouse = $state(null);
    let isLoading = $state(true);
    /** @type {string | number | null} */
    let recentlyUpdatedHouseId = $state(null);
    let lastTotalClicks = -1;
    let isRefreshing = false;
    /** @type {Map<string | number, string | number>} */
    let playerToHouseMap = new Map();
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let highlightTimer;

    let highestScore = $derived(
        teamScores.length > 0 ? Math.max(...teamScores.map((group) => group.clicks)) : 0
    );

    let topScorers = $derived(
        selectedHouse
            ? playerScores
                  .filter((player) => player.groupName.toLowerCase() === selectedHouse?.name.toLowerCase())
                  .slice(0, 5)
            : []
    );

    /** @param {string | number} houseId */
    function triggerHouseHighlight(houseId) {
        recentlyUpdatedHouseId = houseId;
        if (highlightTimer) clearTimeout(highlightTimer);
        highlightTimer = setTimeout(() => {
            recentlyUpdatedHouseId = null;
        }, 1200);
    }

    /**
     * @param {{ new?: { author_id?: string | number } }} payload
     */
    function handleLiveInsert(payload) {
        const authorId = payload?.new?.author_id;
        if (authorId !== undefined && authorId !== null) {
            const houseId = playerToHouseMap.get(authorId);
            if (houseId !== undefined) {
                const team = teamScores.find((t) => String(t.id) === String(houseId));
                if (team) {
                    team.clicks += 1;
                    triggerHouseHighlight(team.id);
                }
            }
            const player = playerScores.find((p) => String(p.id) === String(authorId));
            if (player) {
                player.clicks += 1;
            }
            teamScores = [...teamScores].sort((a, b) => b.clicks - a.clicks);
            playerScores = [...playerScores].sort((a, b) => b.clicks - a.clicks);
        } else {
            safeRefresh();
        }
    }

    async function initPlayerHouseMapping() {
        try {
            const { data: players } = await supabase
                .from('player')
                .select('id, groupId');
            if (players) {
                playerToHouseMap = new Map(players.map((p) => [p.id, p.groupId]));
            }
        } catch (err) {
            console.error('Erreur mapping joueurs/maisons :', err);
        }
    }

    /** @param {boolean} [force] */
    async function refreshScores(force = false) {
        try {
            if (!force) {
                const { count, error: countErr } = await supabase
                    .from('ClickerCompetition')
                    .select('id', { count: 'exact', head: true });

                if (!countErr && count !== null) {
                    if (count === lastTotalClicks && teamScores.length > 0) {
                        return;
                    }
                    lastTotalClicks = count;
                }
            }

            const [updatedTeamScores, { scores: updatedPlayerScores }] = await Promise.all([
                fetchTeamScores(),
                fetchPlayerScores()
            ]);
            teamScores = updatedTeamScores;
            playerScores = updatedPlayerScores;
        } catch (err) {
            console.error('Erreur rafraîchissement scores :', err);
        } finally {
            isLoading = false;
        }
    }

    async function safeRefresh() {
        if (isRefreshing) return;
        isRefreshing = true;
        try {
            await refreshScores();
        } finally {
            isRefreshing = false;
        }
    }

    onMount(() => {
        initPlayerHouseMapping();
        refreshScores(true);

        const channel = supabase
            .channel('maisons-live-scores')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'ClickerCompetition' },
                handleLiveInsert
            )
            .subscribe();

        const pollInterval = setInterval(safeRefresh, 2000);

        return () => {
            clearInterval(pollInterval);
            supabase.removeChannel(channel);
            if (highlightTimer) clearTimeout(highlightTimer);
        };
    });

    /** @param {string} groupName */
    function getHouseColor(groupName) {
        const name = groupName.toLowerCase();
        if (name.includes('ath')) return '#3b82f6';
        if (name.includes('prom')) return '#10b981';
        if (name.includes('hep') || name.includes('hép')) return '#ef4444';
        return '#f59e0b';
    }
</script>

<main class="min-h-screen bg-slate-950 text-slate-100 max-w-md mx-auto p-4 pb-24 font-sans">
    <header class="text-center my-4 space-y-1">
        <div class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 text-[10px] font-semibold mb-1">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Direct
        </div>
        <h1 class="text-xl font-extrabold text-amber-400 tracking-wider uppercase">
            🏆 Scores des Maisons
        </h1>
        <p class="text-xs text-slate-400">Total des points en temps réel</p>
    </header>

    <section class="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
        {#if isLoading}
            <p class="text-xs text-center text-slate-500 py-6">Chargement des scores...</p>
        {:else if teamScores.length === 0}
            <p class="text-xs text-center text-slate-500 py-6">Aucune maison enregistrée.</p>
        {:else}
            <div class="h-64 flex items-end justify-around gap-2 border-b border-l border-slate-700 px-2 pt-6">
                {#each teamScores as group (group.id)}
                    {@const barHeight = highestScore === 0 ? 0 : Math.max(4, (group.clicks / highestScore) * 100)}
                    {@const isHighlighted = recentlyUpdatedHouseId === group.id}
                    <button
                        type="button"
                        onclick={() => selectedHouse = group}
                        aria-pressed={selectedHouse?.id === group.id}
                        aria-label={`Afficher les meilleurs joueurs de ${group.name}`}
                        class="h-full flex-1 flex flex-col items-center justify-end gap-2 min-w-0 rounded-t-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 relative transition-transform {selectedHouse?.id === group.id ? 'bg-slate-800/60' : ''} {isHighlighted ? 'scale-105' : ''}"
                    >
                        {#if isHighlighted}
                            <span class="absolute -top-3 text-[10px] font-black text-amber-300 animate-bounce">
                                +1
                            </span>
                        {/if}
                        <span class="font-mono font-bold text-xs transition-colors {isHighlighted ? 'text-white scale-110' : 'text-amber-400'}">
                            {group.clicks}
                        </span>
                        <div
                            class="w-8 max-w-full rounded-t-lg transition-all duration-500 shadow-lg"
                            style:height="{barHeight}%"
                            style:background-color={getHouseColor(group.name)}
                        ></div>
                        <span class="w-full text-center text-[10px] text-slate-300 truncate font-semibold" title={group.name}>
                            {group.name}
                        </span>
                    </button>
                {/each}
            </div>

            {#if selectedHouse}
                <section class="mt-6 border-t border-slate-800 pt-4" aria-live="polite">
                    <h2 class="text-sm font-bold text-slate-100 mb-3">
                        Top 5 — <span style:color={getHouseColor(selectedHouse.name)}>
                            {selectedHouse.name}
                        </span>
                    </h2>
                    {#if topScorers.length === 0}
                        <p class="text-xs text-center text-slate-500 py-3">Aucun joueur dans cette maison.</p>
                    {:else}
                        <ol class="space-y-2">
                            {#each topScorers as player, index (player.id)}
                                <li class="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                                    <div class="flex items-center gap-3">
                                        <span class="font-bold text-amber-500/80 text-xs w-6 text-center">
                                            #{index + 1}
                                        </span>
                                        <span class="font-bold text-sm text-slate-200">{player.name}</span>
                                    </div>
                                    <span class="font-mono font-bold text-amber-400 text-sm">
                                        {player.clicks} <span class="text-[10px] text-slate-500 font-normal">pts</span>
                                    </span>
                                </li>
                            {/each}
                        </ol>
                    {/if}
                </section>
            {/if}
        {/if}
    </section>

    <Navigation />
</main>

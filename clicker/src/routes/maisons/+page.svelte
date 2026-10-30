<svelte:head>
    <title>Scores des Maisons - Tournoi des Maisons</title>
    <script src="https://cdn.tailwindcss.com"></script>
</svelte:head>

<script>
    import { onDestroy, onMount } from 'svelte';
    import { supabase } from '../../lib/supabaseClient';
    import { fetchPlayerScores, fetchTeamScores, subscribeToClickerScores } from '../../lib/games/clicker';

    /** @type {Array<{ id: string | number, name: string, clicks: number }>} */
    let teamScores = $state([]);
    /** @type {Array<{ id: string | number, name: string, groupName: string, clicks: number }>} */
    let playerScores = $state([]);
    /** @type {{ id: string | number, name: string, clicks: number } | null} */
    let selectedHouse = $state(null);
    let isLoading = $state(true);
    /** @type {import('@supabase/supabase-js').RealtimeChannel | undefined} */
    let clickSubscription;

    onMount(async () => {
        clickSubscription = subscribeToClickerScores(
            'public:ClickerCompetitionHouses',
            refreshScores
        );
        await refreshScores();
    });

    onDestroy(() => {
        if (clickSubscription) supabase.removeChannel(clickSubscription);
    });

    async function refreshScores() {
        const [updatedTeamScores, { scores: updatedPlayerScores }] = await Promise.all([
            fetchTeamScores(),
            fetchPlayerScores()
        ]);
        teamScores = updatedTeamScores;
        playerScores = updatedPlayerScores;
        isLoading = false;
    }

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
            {@const highestScore = Math.max(...teamScores.map((group) => group.clicks))}
            <div class="h-64 flex items-end justify-around gap-2 border-b border-l border-slate-700 px-2">
                {#each teamScores as group}
                    {@const barHeight = highestScore === 0 ? 0 : Math.max(4, (group.clicks / highestScore) * 100)}
                    <button
                        type="button"
                        onclick={() => selectedHouse = group}
                        aria-pressed={selectedHouse?.id === group.id}
                        aria-label={`Afficher les meilleurs joueurs de ${group.name}`}
                        class={`h-full flex-1 flex flex-col items-center justify-end gap-2 min-w-0 rounded-t-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 ${selectedHouse?.id === group.id ? 'bg-slate-800/60' : ''}`}
                    >
                        <span class="font-mono font-bold text-amber-400 text-xs">{group.clicks}</span>
                        <div
                            class="w-8 max-w-full rounded-t-lg transition-all duration-500"
                            style={`height: ${barHeight}%; background-color: ${getHouseColor(group.name)};`}
                        ></div>
                        <span class="w-full text-center text-[10px] text-slate-300 truncate" title={group.name}>
                            {group.name}
                        </span>
                    </button>
                {/each}
            </div>

            {#if selectedHouse}
                {@const topScorers = playerScores
                    .filter((player) => player.groupName.toLowerCase() === selectedHouse?.name.toLowerCase())
                    .slice(0, 5)}
                <section class="mt-6 border-t border-slate-800 pt-4" aria-live="polite">
                    <h2 class="text-sm font-bold text-slate-100 mb-3">
                        Top 5 — <span style={`color: ${getHouseColor(selectedHouse.name)}`}>
                            {selectedHouse.name}
                        </span>
                    </h2>
                    {#if topScorers.length === 0}
                        <p class="text-xs text-center text-slate-500 py-3">Aucun joueur dans cette maison.</p>
                    {:else}
                        <ol class="space-y-2">
                            {#each topScorers as player, index}
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

    <nav class="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-900/95 backdrop-blur border-t border-slate-800 px-4 py-2.5 flex justify-around items-center z-50">
        <a href="/" class="flex flex-col items-center text-slate-400 hover:text-amber-400 font-medium text-[11px] transition">
            <span class="text-xl">⚡</span>
            <span>Jeu</span>
        </a>
        <a href="/scores" class="flex flex-col items-center text-slate-400 hover:text-amber-400 font-medium text-[11px] transition">
            <span class="text-xl">👤</span>
            <span>Joueurs</span>
        </a>
        <a href="/maisons" class="flex flex-col items-center text-amber-400 font-bold text-[11px]">
            <span class="text-xl">🏆</span>
            <span>Maisons</span>
        </a>
    </nav>
</main>

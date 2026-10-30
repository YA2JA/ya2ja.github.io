<svelte:head>
    <title>Scores Individuels - Tournoi des Maisons</title>
    <script src="https://cdn.tailwindcss.com"></script>
</svelte:head>

<script>
    import { onDestroy, onMount } from 'svelte';
    import { supabase } from '../../lib/supabaseClient';
    import { fetchPlayerScores, subscribeToClickerScores } from '../../lib/games/clicker';

    /** @type {Array<{ id: string | number, name: string, groupName: string, clicks: number }>} */
    let playerScores = $state([]);
    let isLoading = $state(true);
    /** @type {import('@supabase/supabase-js').RealtimeChannel | undefined} */
    let clickSubscription;

    onMount(async () => {
        clickSubscription = subscribeToClickerScores(
            'public:ClickerCompetitionScores',
            fetchIndividualScores
        );
        await fetchIndividualScores();
    });

    onDestroy(() => {
        if (clickSubscription) supabase.removeChannel(clickSubscription);
    });

    async function fetchIndividualScores() {
        const { scores } = await fetchPlayerScores();
        playerScores = scores;
        isLoading = false;
    }
</script>

<main class="min-h-screen bg-slate-950 text-slate-100 max-w-md mx-auto p-4 pb-20 font-sans">

    <header class="text-center my-4 space-y-1">
        <h1 class="text-xl font-extrabold text-amber-400 tracking-wider uppercase flex items-center justify-center gap-2">
            👤 Classement Individuel
        </h1>
        <p class="text-xs text-slate-400">Score de chaque joueur en temps réel</p>
    </header>

    <section class="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
        {#if isLoading}
            <p class="text-xs text-center text-slate-500 py-6">Chargement des scores...</p>
        {:else if playerScores.length === 0}
            <p class="text-xs text-center text-slate-500 py-6">Aucun joueur enregistré.</p>
        {:else}
            <div class="space-y-2">
                {#each playerScores as player, index}
                    <div class="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                        <div class="flex items-center space-x-3">
                            <span class="font-bold text-amber-500/80 text-xs w-6 text-center">
                                #{index + 1}
                            </span>
                            <div>
                                <p class="font-bold text-sm text-slate-200">{player.name}</p>
                                <p class="text-[10px] text-slate-400">{player.groupName}</p>
                            </div>
                        </div>
                        <div class="font-mono font-bold text-amber-400 text-sm">
                            {player.clicks} <span class="text-[10px] text-slate-500 font-normal">clics</span>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </section>

    <!-- BARRE DE NAVIGATION (BAS) -->
    <nav class="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-900/95 backdrop-blur border-t border-slate-800 px-6 py-2.5 flex justify-around items-center z-50">
        <a href="/" class="flex flex-col items-center text-slate-400 hover:text-amber-400 font-medium text-[11px] transition">
            <span class="text-xl">⚡</span>
            <span>Jeu</span>
        </a>
        <a href="/scores" class="flex flex-col items-center text-amber-400 font-bold text-[11px]">
            <span class="text-xl">👤</span>
            <span>Joueurs</span>
        </a>
        <a href="/maisons" class="flex flex-col items-center text-slate-400 hover:text-amber-400 font-medium text-[11px] transition">
            <span class="text-xl">🏆</span>
            <span>Maisons</span>
        </a>
    </nav>

</main>
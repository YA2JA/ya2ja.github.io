<svelte:head>
    <title>Scores Individuels - Tournoi des Maisons</title>
</svelte:head>

<script>
    import { onMount } from 'svelte';
    import { supabase } from '#lib/supabaseClient';
    import { fetchPlayerScores } from '#lib/games/clicker';
    import Navigation from '#lib/components/Navigation.svelte';

    /** @type {Array<{ id: string | number, name: string, groupName: string, clicks: number }>} */
    let playerScores = $state([]);
    let isLoading = $state(true);
    let lastTotalClicks = -1;
    let isRefreshing = false;

    /** @param {{ new?: { author_id?: string | number } }} payload */
    function handleLiveInsert(payload) {
        const authorId = payload?.new?.author_id;
        if (authorId !== undefined && authorId !== null) {
            const player = playerScores.find((p) => String(p.id) === String(authorId));
            if (player) {
                player.clicks += 1;
                playerScores = [...playerScores].sort((a, b) => b.clicks - a.clicks);
            }
        } else {
            safeRefresh();
        }
    }

    /** @param {boolean} [force] */
    async function fetchIndividualScores(force = false) {
        try {
            if (!force) {
                const { count, error } = await supabase
                    .from('ClickerCompetition')
                    .select('id', { count: 'exact', head: true });
                if (!error && count !== null) {
                    if (count === lastTotalClicks && playerScores.length > 0) return;
                    lastTotalClicks = count;
                }
            }
            const { scores } = await fetchPlayerScores();
            playerScores = scores;
        } catch (err) {
            console.error('Erreur rafraîchissement scores individuels :', err);
        } finally {
            isLoading = false;
        }
    }

    async function safeRefresh() {
        if (isRefreshing) return;
        isRefreshing = true;
        try {
            await fetchIndividualScores();
        } finally {
            isRefreshing = false;
        }
    }

    onMount(() => {
        fetchIndividualScores(true);

        const channel = supabase
            .channel('scores-live-players')
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
        };
    });
</script>

<main class="min-h-screen bg-slate-950 text-slate-100 max-w-md mx-auto p-4 pb-20 font-sans">
    <header class="text-center my-4 space-y-1">
        <div class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 text-[10px] font-semibold mb-1">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Direct
        </div>
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
                {#each playerScores as player, index (player.id)}
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

    <Navigation />
</main>

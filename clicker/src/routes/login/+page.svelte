<svelte:head>
    <title>Connexion - Tournoi des Maisons</title>
    <script src="https://cdn.tailwindcss.com"></script>
</svelte:head>

<script>
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { clearPlayerEmail, findPlayerByEmail, getSavedPlayerEmail, savePlayerEmail } from '../../lib/playerSession';

    let emailInput = $state('');
    let errorMessage = $state('');
    let isSubmitting = $state(false);
    let isCheckingSession = $state(true);

    onMount(async () => {
        const savedEmail = getSavedPlayerEmail();
        if (savedEmail) {
            const { player } = await findPlayerByEmail(savedEmail);
            if (player) {
                await goto('/', { replaceState: true });
                return;
            }
            clearPlayerEmail();
        }

        isCheckingSession = false;
    });

    async function loginUser() {
        errorMessage = '';
        isSubmitting = true;

        const { player, error } = await findPlayerByEmail(emailInput);
        if (error || !player) {
            errorMessage = error
                ? "Impossible de vérifier cet e-mail. Réessayez."
                : "Aucun joueur trouvé avec cet e-mail.";
            isSubmitting = false;
            return;
        }

        savePlayerEmail(player.email);
        await goto('/', { replaceState: true });
    }
</script>

<main class="min-h-screen bg-slate-950 text-slate-100 max-w-md mx-auto p-4 flex flex-col justify-center font-sans">
    {#if isCheckingSession}
        <p class="text-center text-slate-400 font-medium">Vérification de la session...</p>
    {:else}
        <section class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
            <header class="text-center space-y-2">
                <div class="text-5xl">🛡️</div>
                <h1 class="text-2xl font-extrabold text-amber-400 tracking-wider uppercase">
                    Tournoi des Maisons
                </h1>
                <p class="text-xs text-slate-400">Entrez votre adresse e-mail pour accéder au jeu</p>
            </header>

            <form onsubmit={(event) => { event.preventDefault(); loginUser(); }} class="space-y-4">
                <div>
                    <label for="email" class="block text-xs font-semibold text-slate-300 uppercase mb-1">
                        Adresse E-mail
                    </label>
                    <input
                        type="email"
                        id="email"
                        bind:value={emailInput}
                        placeholder="votre.email@domaine.com"
                        required
                        disabled={isSubmitting}
                        class="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition"
                    />
                </div>

                <button
                    type="submit"
                    disabled={isSubmitting}
                    class="w-full py-3.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold uppercase rounded-xl shadow-lg transition active:scale-95 disabled:opacity-60"
                >
                    {isSubmitting ? 'Vérification...' : "Rejoindre l'Arène"}
                </button>
            </form>

            {#if errorMessage}
                <p role="alert" class="p-3 bg-red-950/80 border border-red-500/50 rounded-xl text-red-300 text-xs text-center">
                    {errorMessage}
                </p>
            {/if}
        </section>
    {/if}
</main>

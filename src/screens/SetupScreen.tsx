/** Affiché quand le build n'a pas trouvé les variables Supabase. Aide à diagnostiquer. */
export function SetupScreen() {
  const b = __BUILD_INFO__
  const at = b.at
    ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(b.at))
    : '?'
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 px-6 py-10">
      <h1 className="text-[32px] font-medium">Presque prêt</h1>
      <p className="text-[16px] leading-relaxed text-muted">
        Cette version de l'application a été construite sans les clés de sa base de données Supabase.
      </p>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-[16px] leading-relaxed">
        <li>Dans Vercel, vérifie que la base Supabase est connectée au projet (onglet Storage).</li>
        <li>
          Puis <strong>Deployments → ⋯ → Redeploy</strong> sur le déploiement le plus récent.
        </li>
        <li>Une fois le déploiement terminé, recharge cette page deux fois.</li>
      </ol>
      <dl className="rounded-2xl border border-line bg-surface p-4 text-[14px] leading-relaxed text-muted">
        <dt className="font-semibold text-ink">Version</dt>
        <dd className="mb-2 tabular">
          {b.sha || 'locale'} · construite le {at}
        </dd>
        <dt className="font-semibold text-ink">Variables Supabase vues pendant la construction</dt>
        <dd className="break-words">{b.vars.length ? b.vars.join(', ') : 'aucune'}</dd>
        <dd className="mt-1">
          Adresse : {b.url ? 'trouvée' : 'manquante'} · Clé publique : {b.key ? 'trouvée' : 'manquante'}
        </dd>
      </dl>
    </main>
  )
}

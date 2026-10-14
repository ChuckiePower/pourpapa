export function SetupScreen() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-6">
      <h1 className="text-[32px] font-medium">Presque prêt</h1>
      <p className="text-[16px] leading-relaxed text-muted">
        L'application n'est pas encore reliée à sa base de données. Ajoute les variables d'environnement Supabase
        (adresse du projet et clé publique) dans Vercel, puis redéploie. Tout est expliqué dans le README.
      </p>
    </main>
  )
}

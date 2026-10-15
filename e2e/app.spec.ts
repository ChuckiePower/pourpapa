import { execSync } from 'node:child_process'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { API, E2E_ENV } from '../playwright.config'

/** « Maintenant » : mardi 20 octobre 2026, 15h40 à Paris. */
const NOW = new Date('2026-10-20T13:40:00Z')
const MANU_KEY = 'devkey-manu-0123456789abcdefghijklmnopqrstuv'
const SHOTS = 'docs/ecrans'

function reseed() {
  execSync('node scripts/seed-dev.mjs', { env: { ...process.env, ...E2E_ENV }, stdio: 'ignore' })
}

async function open(page: Page, path: string, opts: { as?: 'manu' | 'new' } = {}) {
  await page.clock.install({ time: NOW })
  if (opts.as !== 'new') {
    await page.addInitScript((key) => {
      if (!localStorage.getItem('visites.keys')) {
        localStorage.setItem('visites.keys', JSON.stringify([key]))
        localStorage.setItem('visites.name', JSON.stringify('Manu'))
      }
    }, MANU_KEY)
  }
  await page.goto(path)
  await expect(page.getByRole('link', { name: /Visites/ }).first()).toBeVisible()
}

async function noA11yViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const summary = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)
  expect(summary).toEqual([])
}

/** Toutes les cibles tactiles visibles font au moins 48 px de haut. */
async function touchTargetsOk(page: Page) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a[href], select, input:not([tabindex="-1"]), summary')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"]')
      })
      .filter((el) => el.getBoundingClientRect().height < 47.5)
      .map((el) => `${el.tagName} « ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)} » ${Math.round(el.getBoundingClientRect().height)}px`),
  )
  expect(small).toEqual([])
}

test.beforeEach(() => reseed())

/** Une fausse photo (dégradé chaud), en JPEG. */
async function fakePhoto(page: Page, hue: number): Promise<Buffer> {
  const p = await page.context().newPage()
  await p.setViewportSize({ width: 800, height: 600 })
  await p.setContent(
    `<meta name="viewport" content="width=800"><body style="margin:0"><div style="width:800px;height:600px;background:linear-gradient(135deg,hsl(${hue} 50% 72%),hsl(${hue + 35} 35% 38%))"></div></body>`,
  )
  const buf = await p.screenshot({ type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: 800, height: 600 } })
  await p.close()
  return buf
}

test('planning : 2 personnes par jour, places restantes, jours complets', async ({ page }) => {
  await open(page, '/')
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible()
  await expect(page.getByText('1 personne prévue')).toBeVisible()
  await expect(page.getByText('encore 1 place')).toBeVisible()
  await expect(page.getByText('2 personnes par jour')).toBeVisible()
  await expect(page.getByRole('button', { name: /Une place libre avec Manu, 15h30–16h/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Libre, 1 place, 16h–20h/ })).toBeVisible()
  await touchTargetsOk(page)
  await noA11yViolations(page)
  await page.screenshot({ path: `${SHOTS}/1-planning.png`, animations: 'disabled' })

  // Mercredi : Sophie et Marc, journée complète, plus aucune place proposée
  await page.getByRole('tab', { name: /mercredi 21 octobre, complet/ }).click()
  await expect(page.getByText('2 personnes prévues')).toBeVisible()
  await expect(page.locator('p', { hasText: '2 personnes prévues · complet' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Libre|Rejoindre/ })).toHaveCount(0)

  await page.getByRole('tab', { name: /jeudi 22 octobre/ }).click()
  await expect(page.getByText("Personne n'est prévu jeudi")).toBeVisible()
  await expect(page.getByRole('button', { name: /Libre, 2 places, 14h–20h/ })).toBeVisible()

  await page.getByRole('tab', { name: /vendredi 23 octobre/ }).click()
  await expect(page.getByText('Pas de visite').first()).toBeVisible()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(400) // fin des transitions de couleur
  await noA11yViolations(page)
  await page.screenshot({ path: `${SHOTS}/2-planning-sombre.png`, animations: 'disabled' })
})

test('réserver la dernière place du jour : venir à deux impossible, confirmation, partage', async ({ page }) => {
  await open(page, '/', { as: 'new' })
  // On touche le haut du bloc libre : l'arrivée est pré-remplie à 16h.
  await page.getByRole('button', { name: /Libre, 1 place, 16h–20h/ }).click({ position: { x: 24, y: 12 } })
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Je viens voir papa' })).toBeVisible()
  await expect(sheet.getByLabel('Jour')).toHaveValue('2026-10-20')
  await expect(sheet.getByLabel('Arrivée')).toHaveValue('960')
  await expect(sheet.getByRole('radio', { name: 'On vient à deux' })).toBeDisabled()
  await expect(sheet.getByText("Il ne reste qu'une place ce jour-là")).toBeVisible()
  // Les jours complets sont signalés dans la liste
  await expect(sheet.getByRole('option', { name: /Mercredi 21 octobre · complet/ })).toBeDisabled()
  await touchTargetsOk(page)
  await noA11yViolations(page)
  await page.screenshot({ path: `${SHOTS}/3-reserver.png`, animations: 'disabled' })

  await expect(sheet.getByRole('button', { name: 'Je viens' })).toBeDisabled() // prénom manquant
  await sheet.getByLabel('Ton prénom').fill('Camille')
  await sheet.getByLabel('Un petit mot pour papa').fill('On t’apporte des clémentines 🍊')
  await sheet.getByRole('button', { name: 'Je viens' }).click()

  await expect(sheet.getByText("C'est noté")).toBeVisible()
  await expect(sheet.getByText('Mardi 20 octobre · 16h–17h')).toBeVisible()
  // La journée est pleine : plus de proposition de venir à deux
  await expect(sheet.getByRole('link', { name: "Proposer à quelqu'un de venir avec moi" })).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/4-confirmation.png`, animations: 'disabled' })
  await sheet.getByRole('button', { name: 'Terminé' }).click()

  await expect(page.getByRole('button', { name: /Ma visite, 16h–17h/ })).toBeVisible()
  await expect(page.getByText('2 personnes prévues')).toBeVisible()
  await expect(page.getByRole('button', { name: /Libre|Rejoindre/ })).toHaveCount(0)
  await page.getByRole('link', { name: 'Mots' }).click()
  await expect(page.getByText('On t’apporte des clémentines 🍊')).toBeVisible()
})

test('rejoindre : horaires pré-remplis, message WhatsApp, « avec Léa »', async ({ page }) => {
  await open(page, '/?jour=2026-10-26', { as: 'new' })
  await page.getByRole('button', { name: /Une place libre avec Léa/ }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Venir avec Léa' })).toBeVisible()
  await expect(sheet.getByText('Léa vient de 16h à 18h')).toBeVisible()
  await expect(sheet.getByLabel('Arrivée')).toHaveValue('960')
  await expect(sheet.getByText('Départ à 18h')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/5-rejoindre.png`, animations: 'disabled' })
  await sheet.getByLabel('Ton prénom').fill('Zoé')
  await sheet.getByRole('button', { name: 'Je viens' }).click()
  await expect(sheet.getByText("C'est noté")).toBeVisible()
  await sheet.getByRole('button', { name: 'Terminé' }).click()

  await page.getByRole('link', { name: 'Mes visites' }).click()
  await expect(page.getByText('Avec Léa de 16h à 18h')).toBeVisible()
  await noA11yViolations(page)
})

test('mes visites : « te rejoint », proposition WhatsApp', async ({ page }) => {
  await open(page, '/mes-visites')
  const card = page.getByRole('listitem').filter({ hasText: 'Dimanche 25 octobre' })
  const invite = card.getByRole('link', { name: "Proposer à quelqu'un de venir avec moi" })
  const href = decodeURIComponent((await invite.getAttribute('href')) ?? '')
  expect(href).toContain('https://wa.me/?text=')
  expect(href).toContain('Je vais voir papa dimanche de 15h à 17h, il reste une place si tu veux venir avec moi 🤍')
  expect(href).toContain('/r/2026-10-25/15h-17h?avec=Manu')
  await page.screenshot({ path: `${SHOTS}/6-mes-visites.png`, fullPage: true, animations: 'disabled' })
})

test('lien WhatsApp : la réservation s’ouvre pré-remplie', async ({ page }) => {
  await open(page, '/r/2026-10-26/16h-17h?avec=Léa', { as: 'new' })
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Venir avec Léa' })).toBeVisible()
  await expect(sheet.getByLabel('Jour')).toHaveValue('2026-10-26')
  await expect(sheet.getByLabel('Arrivée')).toHaveValue('960')
  await expect(sheet.getByText('Départ à 17h')).toBeVisible()
})

test('journée remplie entre-temps : refus clair et autres jours proposés', async ({ page, request }) => {
  await open(page, '/', { as: 'new' })
  // On touche le haut du bloc libre : l'arrivée est pré-remplie à 16h.
  await page.getByRole('button', { name: /Libre, 1 place, 16h–20h/ }).click({ position: { x: 24, y: 12 } })
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Ton prénom').fill('Camille')
  // Quelqu'un d'autre prend la dernière place du jour juste avant.
  const r = await request.post(`${API}/rest/v1/rpc/book_visit`, {
    data: {
      p_day: '2026-10-20', p_start: 1080, p_end: 1140, p_people: 1, p_name: 'Rapide', p_companion: null,
      p_note: null, p_owner_key: 'z'.repeat(43), p_hp: null,
    },
  })
  expect((await r.json()).ok).toBe(true)
  await sheet.getByRole('button', { name: 'Je viens' }).click()
  await expect(sheet.getByRole('alert')).toContainText('Ce jour-là est complet')
  await sheet.getByRole('button', { name: 'Jeudi' }).click()
  await expect(sheet.getByLabel('Jour')).toHaveValue('2026-10-22')
  await sheet.getByRole('button', { name: 'Je viens' }).click()
  await expect(sheet.getByText('Jeudi 22 octobre · 16h–17h')).toBeVisible()
})

test('modifier et annuler ma visite', async ({ page }) => {
  await open(page, '/mes-visites')
  const card = page.getByRole('listitem').filter({ hasText: 'Dimanche 25 octobre' })
  await card.getByRole('button', { name: 'Modifier' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: '1h', exact: true }).click()
  await sheet.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(sheet.getByText("C'est modifié")).toBeVisible()
  await sheet.getByRole('button', { name: 'Terminé' }).click()
  await expect(card.getByText('15h–16h')).toBeVisible()

  await card.getByRole('button', { name: 'Annuler' }).click()
  await card.getByRole('button', { name: 'Oui, annuler' }).click()
  await expect(page.getByText('Dimanche 25 octobre')).toHaveCount(0)
})

test('aujourd’hui : lisible en une seconde', async ({ page }) => {
  await open(page, '/aujourdhui')
  await expect(page.getByText("Manu jusqu'à 16h")).toBeVisible()
  await expect(page.getByText("Personne d'autre de prévu.")).toBeVisible()
  await expect(page.getByRole('link', { name: /15h30–20h.*1 place/ })).toBeVisible()
  await noA11yViolations(page)
  await page.screenshot({ path: `${SHOTS}/7-aujourdhui.png`, animations: 'disabled' })
})

test('photos : ajout, fil jour par jour, défilement, suppression', async ({ page }) => {
  await open(page, '/photos')
  await expect(page.getByText('Pas encore de photo.')).toBeVisible()
  await noA11yViolations(page)

  const add = async (hue: number, caption: string, day?: string) => {
    await page.getByLabel('Choisir une photo').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: await fakePhoto(page, hue) })
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'Nouvelle photo' })).toBeVisible()
    await sheet.getByLabel('Légende').fill(caption)
    if (day) await sheet.getByLabel('Jour').selectOption({ label: day })
    await sheet.getByRole('button', { name: 'Ajouter la photo' }).click()
    await expect(page.getByText('Photo ajoutée')).toBeVisible()
    await expect(sheet).toHaveCount(0)
  }
  await add(18, 'Premier jour, il a souri', 'Hier')
  await add(32, 'Partie de cartes')

  await expect(page.getByText('Jour 1', { exact: true })).toBeVisible()
  await expect(page.getByText('Jour 2', { exact: true })).toBeVisible()
  await expect(page.getByText('Partie de cartes')).toBeVisible()
  const img = page.getByRole('button', { name: /Agrandir la photo de Manu : Partie de cartes/ }).locator('img')
  await expect(img).toHaveJSProperty('complete', true)
  // Réduite à 1600 px maximum avant l'envoi
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
  expect(await img.evaluate((el: HTMLImageElement) => Math.max(el.naturalWidth, el.naturalHeight))).toBeLessThanOrEqual(1600)
  await noA11yViolations(page)
  await page.screenshot({ path: `${SHOTS}/8-photos.png`, animations: 'disabled' })

  // Défilement depuis le premier jour
  await page.getByRole('button', { name: 'Tout faire défiler depuis le jour 1' }).click()
  const viewer = page.getByRole('dialog', { name: 'Photos' })
  await expect(viewer.getByText('1 / 2')).toBeVisible()
  await expect(viewer.getByText('Premier jour, il a souri')).toBeVisible()
  await viewer.getByRole('button', { name: 'Photo suivante' }).click()
  await expect(viewer.getByText('2 / 2')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/9-photos-defilement.png`, animations: 'disabled' })

  await viewer.getByRole('button', { name: 'Supprimer' }).click()
  await viewer.getByRole('button', { name: 'Supprimer' }).click()
  await expect(page.getByText('Photo supprimée')).toBeVisible()
  await expect(viewer.getByText('1 / 1')).toBeVisible()
  await viewer.getByRole('button', { name: 'Fermer' }).click()
  await expect(page.getByText('Partie de cartes')).toHaveCount(0)
})

test('mots pour papa : un par un, en grand', async ({ page }) => {
  await open(page, '/mots')
  await expect(page.getByText('Courage papa, on pense fort à toi tous les jours ❤️')).toBeVisible()
  await expect(page.getByText('1 / 3')).toBeVisible()
  await page.getByRole('button', { name: 'Mot suivant' }).click()
  await expect(page.getByText('2 / 3')).toBeVisible()
  await expect(page.getByText('— Sophie')).toBeVisible()
  await noA11yViolations(page)
})

test('admin : annonce, 2 personnes par jour, blocage avec visites à prévenir', async ({ page }) => {
  await open(page, '/admin')
  await page.getByLabel('Code PIN').fill('000000')
  await page.getByRole('button', { name: 'Entrer' }).click()
  await expect(page.getByText('Code incorrect.')).toBeVisible()
  await page.getByLabel('Code PIN').fill('123456')
  await page.getByRole('button', { name: 'Entrer' }).click()

  await page.getByLabel("Texte de l'annonce").fill('Papa dort beaucoup aujourd’hui, venez plutôt demain.')
  await page.getByRole('button', { name: 'Publier' }).click()
  await expect(page.getByText('Annonce publiée')).toBeVisible()

  await expect(page.getByLabel('Par jour')).toHaveValue('2')
  await expect(page.getByLabel("Jours visibles à l'avance")).toHaveValue('14')

  await page.getByRole('button', { name: 'Examens' }).click()
  await page.getByRole('button', { name: 'Bloquer 14h–20h' }).click()
  const warn = page.getByRole('alert').filter({ hasText: 'À prévenir' })
  await expect(warn).toContainText('Manu · 14h–16h')
  await noA11yViolations(page)
  await expect(page.getByText('Période bloquée')).toBeHidden({ timeout: 5000 })
  await page.screenshot({ path: `${SHOTS}/10-admin.png`, animations: 'disabled' })

  await page.getByRole('link', { name: 'Planning' }).click()
  await expect(page.getByText('Papa dort beaucoup aujourd’hui, venez plutôt demain.')).toBeVisible()
  await expect(page.getByText('Pas de visite').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Libre/ })).toHaveCount(0)
})

test('hors ligne : dernier planning affiché, réservations bloquées', async ({ page, context }) => {
  await open(page, '/?jour=2026-10-22')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.getByText("Personne n'est prévu jeudi")).toBeVisible()

  await context.setOffline(true)
  await expect(page.getByText('Hors ligne.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Je viens' })).toBeDisabled()

  // Rechargement sans réseau : l'app et le planning viennent du téléphone.
  await page.reload()
  await expect(page.getByText('Hors ligne.')).toBeVisible()
  await expect(page.getByText("Personne n'est prévu jeudi")).toBeVisible()
  await expect(page.getByRole('button', { name: /Libre, 2 places, 14h–20h/ })).toBeDisabled()
  await page.screenshot({ path: `${SHOTS}/11-hors-ligne.png`, animations: 'disabled' })
  await context.setOffline(false)
})

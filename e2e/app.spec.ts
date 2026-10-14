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

test('planning du jour : timeline, places libres, jours vides', async ({ page }) => {
  await open(page, '/')
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible()
  await expect(page.getByRole('button', { name: /Une place libre avec Léa, 16h–17h/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Libre, 2 places, 17h–18h/ })).toBeVisible()
  await expect(page.getByText('Paul et Jo')).toBeVisible()
  // Les heures passées ne proposent pas de place
  await expect(page.getByRole('button', { name: /14h–15h. Rejoindre/ })).toHaveCount(0)
  await touchTargetsOk(page)
  await noA11yViolations(page)
  await page.screenshot({ path: `${SHOTS}/1-planning.png` })

  await page.getByRole('tab', { name: /jeudi 22 octobre/ }).click()
  await expect(page.getByText("Personne n'est prévu jeudi")).toBeVisible()

  await page.getByRole('tab', { name: /vendredi 23 octobre/ }).click()
  await expect(page.getByText('Pas de visite').first()).toBeVisible()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(400) // fin des transitions de couleur
  await noA11yViolations(page)
  await page.screenshot({ path: `${SHOTS}/2-planning-sombre.png` })
})

test('réserver : durées impossibles désactivées, confirmation, partage', async ({ page }) => {
  await open(page, '/', { as: 'new' })
  await page.getByRole('button', { name: /Libre, 2 places, 17h–18h/ }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Je viens voir papa' })).toBeVisible()
  await expect(sheet.getByLabel('Arrivée')).toHaveValue('1020')
  // Paul et Jo arrivent à deux à 18h : impossible de rester plus d'une heure
  await expect(sheet.getByRole('button', { name: '1h', exact: true })).toBeEnabled()
  await expect(sheet.getByRole('button', { name: /1h30, impossible/ })).toBeDisabled()
  await expect(sheet.getByRole('button', { name: /2h, impossible/ })).toBeDisabled()
  await touchTargetsOk(page)
  await noA11yViolations(page)
  await page.screenshot({ path: `${SHOTS}/3-reserver.png` })

  await expect(sheet.getByRole('button', { name: 'Je viens' })).toBeDisabled() // prénom manquant
  await sheet.getByLabel('Ton prénom').fill('Camille')
  await sheet.getByLabel('Un petit mot pour papa').fill('On t’apporte des clémentines 🍊')
  await sheet.getByRole('button', { name: 'Je viens' }).click()

  await expect(sheet.getByText("C'est noté")).toBeVisible()
  await expect(sheet.getByText('Mardi 20 octobre · 17h–18h')).toBeVisible()
  const invite = sheet.getByRole('link', { name: "Proposer à quelqu'un de venir avec moi" })
  const href = decodeURIComponent((await invite.getAttribute('href')) ?? '')
  expect(href).toContain('https://wa.me/?text=')
  expect(href).toContain("Je vais voir papa aujourd'hui de 17h à 18h, il reste une place si tu veux venir avec moi 🤍")
  expect(href).toContain('/r/2026-10-20/17h-18h?avec=Camille')
  await page.screenshot({ path: `${SHOTS}/4-confirmation.png` })
  await sheet.getByRole('button', { name: 'Terminé' }).click()

  await expect(page.getByRole('button', { name: /Ma visite, 17h–18h/ })).toBeVisible()
  await page.getByRole('link', { name: 'Mes visites' }).click()
  await expect(page.getByText('17h–18h')).toBeVisible()
  await expect(page.getByText('Camille, seul·e')).toBeVisible()
  await page.getByRole('link', { name: 'Mots' }).click()
  await expect(page.getByText('On t’apporte des clémentines 🍊')).toBeVisible()
})

test('rejoindre : horaires pré-remplis, venir à deux impossible, « te rejoint »', async ({ page }) => {
  await open(page, '/')
  await page.getByRole('button', { name: /Une place libre avec Léa/ }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Venir avec Léa' })).toBeVisible()
  await expect(sheet.getByLabel('Arrivée')).toHaveValue('960')
  await expect(sheet.getByText('Départ à 17h')).toBeVisible()
  await expect(sheet.getByRole('radio', { name: 'On vient à deux' })).toBeDisabled()
  await page.screenshot({ path: `${SHOTS}/5-rejoindre.png` })
  await sheet.getByRole('button', { name: 'Je viens' }).click()
  await expect(sheet.getByText("C'est noté")).toBeVisible()
  await sheet.getByRole('button', { name: 'Terminé' }).click()

  await page.getByRole('link', { name: 'Mes visites' }).click()
  await expect(page.getByText('Léa te rejoint de 15h à 16h')).toBeVisible()
  await expect(page.getByText('Tu rejoins Léa de 16h à 17h')).toBeVisible()
  await noA11yViolations(page)
  await page.screenshot({ path: `${SHOTS}/6-mes-visites.png`, fullPage: true })
})

test('lien WhatsApp : la réservation s’ouvre pré-remplie', async ({ page }) => {
  await open(page, '/r/2026-10-21/16h30-17h?avec=Sophie', { as: 'new' })
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Venir avec Sophie' })).toBeVisible()
  await expect(sheet.getByText('Mercredi 21 octobre', { exact: true })).toBeVisible()
  await expect(sheet.getByLabel('Arrivée')).toHaveValue('990')
  await expect(sheet.getByText('Départ à 17h')).toBeVisible()
})

test('place prise entre-temps : refus clair et alternatives', async ({ page, request }) => {
  await open(page, '/', { as: 'new' })
  await page.getByRole('button', { name: /Libre, 2 places, 17h–18h/ }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Ton prénom').fill('Camille')
  // Quelqu'un d'autre réserve la même heure, à deux, juste avant.
  const r = await request.post(`${API}/rest/v1/rpc/book_visit`, {
    data: {
      p_day: '2026-10-20', p_start: 1020, p_end: 1080, p_people: 2, p_name: 'Rapide', p_companion: 'Éclair',
      p_note: null, p_owner_key: 'z'.repeat(43), p_hp: null,
    },
  })
  expect((await r.json()).ok).toBe(true)
  await sheet.getByRole('button', { name: 'Je viens' }).click()
  await expect(sheet.getByRole('alert')).toContainText('quelqu’un vient de prendre cette place')
  await sheet.getByRole('button', { name: '19h–20h' }).click()
  await expect(sheet.getByLabel('Arrivée')).toHaveValue('1140')
  await sheet.getByRole('button', { name: 'Je viens' }).click()
  await expect(sheet.getByText('Mardi 20 octobre · 19h–20h')).toBeVisible()
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
  await expect(page.getByText('Manu et Léa')).toBeVisible()
  await expect(page.getByText("Manu jusqu'à 16h · Léa jusqu'à 17h")).toBeVisible()
  await expect(page.getByText('Paul et Jo')).toBeVisible()
  await expect(page.getByRole('link', { name: /17h–18h.*2 places/ })).toBeVisible()
  await noA11yViolations(page)
  await page.screenshot({ path: `${SHOTS}/7-aujourdhui.png` })
})

test('mots pour papa : un par un, en grand', async ({ page }) => {
  await open(page, '/mots')
  await expect(page.getByText('Courage papa, on pense fort à toi tous les jours ❤️')).toBeVisible()
  await expect(page.getByText('1 / 3')).toBeVisible()
  await page.getByRole('button', { name: 'Mot suivant' }).click()
  await expect(page.getByText('2 / 3')).toBeVisible()
  await expect(page.getByText('— Sophie')).toBeVisible()
  await noA11yViolations(page)
  await page.getByRole('button', { name: 'Mot précédent' }).click()
  await page.screenshot({ path: `${SHOTS}/8-mots.png` })
})

test('admin : annonce, blocage avec visites à prévenir', async ({ page }) => {
  await open(page, '/admin')
  await page.getByLabel('Code PIN').fill('000000')
  await page.getByRole('button', { name: 'Entrer' }).click()
  await expect(page.getByText('Code incorrect.')).toBeVisible()
  await page.getByLabel('Code PIN').fill('123456')
  await page.getByRole('button', { name: 'Entrer' }).click()

  await page.getByLabel("Texte de l'annonce").fill('Papa dort beaucoup aujourd’hui, venez plutôt demain.')
  await page.getByRole('button', { name: 'Publier' }).click()
  await expect(page.getByText('Annonce publiée')).toBeVisible()

  await page.getByRole('button', { name: 'Examens' }).click()
  await page.getByRole('button', { name: 'Bloquer 14h–20h' }).click()
  const warn = page.getByRole('alert').filter({ hasText: 'À prévenir' })
  await expect(warn).toContainText('Manu · 14h–16h')
  await expect(warn).toContainText('Paul et Jo · 18h–19h')
  await noA11yViolations(page)
  await expect(page.getByText('Période bloquée')).toBeHidden({ timeout: 5000 })
  await page.screenshot({ path: `${SHOTS}/9-admin.png` })

  await page.getByRole('link', { name: 'Planning' }).click()
  await expect(page.getByText('Papa dort beaucoup aujourd’hui, venez plutôt demain.')).toBeVisible()
  await expect(page.getByText('Pas de visite').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Libre, 2 places/ })).toHaveCount(0)
})

test('hors ligne : dernier planning affiché, réservations bloquées', async ({ page, context }) => {
  await open(page, '/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.getByText('Paul et Jo')).toBeVisible()

  await context.setOffline(true)
  await expect(page.getByText('Hors ligne.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Je viens' })).toBeDisabled()

  // Rechargement sans réseau : l'app et le planning viennent du téléphone.
  await page.reload()
  await expect(page.getByText('Hors ligne.')).toBeVisible()
  await expect(page.getByText('Paul et Jo')).toBeVisible()
  await expect(page.getByRole('button', { name: /Libre, 2 places, 17h–18h/ })).toBeDisabled()
  await page.screenshot({ path: `${SHOTS}/10-hors-ligne.png` })
  await context.setOffline(false)
})

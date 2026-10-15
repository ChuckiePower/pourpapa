-- ============================================================================
--  Visites — schéma complet de la base (Supabase / Postgres 15+)
--
--  À coller tel quel dans l'éditeur SQL de Supabase, puis « Run ».
--  Le script est idempotent : on peut le relancer après une mise à jour.
--
--  Principes :
--   - Les horaires sont stockés en date locale + minutes depuis minuit
--     (fuseau Europe/Paris), jamais en timestamps UTC.
--   - Les clients ne peuvent que LIRE les tables publiques. Toute écriture
--     passe par les fonctions ci-dessous (security definer), qui prennent un
--     verrou par jour et vérifient la capacité tranche de 30 min par tranche.
--   - Un trigger revérifie la capacité à chaque écriture : même une requête
--     SQL manuelle ne peut pas dépasser la capacité.
-- ============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- ----------------------------------------------------------------------------
--  Tables publiques (lecture seule pour les visiteurs)
-- ----------------------------------------------------------------------------

create table if not exists public.settings (
  id boolean primary key default true check (id),
  app_name text not null default 'Visites'
    check (char_length(app_name) between 1 and 40),
  patient_label text not null default 'papa'
    check (char_length(patient_label) between 1 and 30),
  open_min smallint not null default 840
    check (open_min between 0 and 1410 and open_min % 30 = 0),
  close_min smallint not null default 1200
    check (close_min between 30 and 1440 and close_min % 30 = 0),
  capacity smallint not null default 2
    check (capacity between 1 and 6),
  max_duration_min smallint
    check (max_duration_min is null or (max_duration_min between 30 and 1440 and max_duration_min % 30 = 0)),
  days_ahead smallint not null default 14
    check (days_ahead between 1 and 60),
  announcement text not null default ''
    check (char_length(announcement) <= 280),
  guidelines text not null default E'Passer par l''accueil du service avant d''entrer.\nSe laver les mains en entrant et en sortant.\nMasque et blouse obligatoires dans la chambre.'
    check (char_length(guidelines) <= 1000),
  updated_at timestamptz not null default now(),
  constraint settings_hours check (open_min < close_min)
);
insert into public.settings (id) values (true) on conflict (id) do nothing;

-- Nombre maximum de personnes sur toute la journée (null = pas de limite).
alter table public.settings add column if not exists per_day smallint default 2;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_per_day') then
    alter table public.settings add constraint settings_per_day check (per_day is null or per_day between 1 and 20);
  end if;
end;
$$;

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  start_min smallint not null,
  end_min smallint not null,
  people smallint not null default 1 check (people in (1, 2)),
  name text not null check (char_length(name) between 1 and 30),
  companion_name text check (companion_name is null or char_length(companion_name) between 1 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visits_slots check (
    start_min >= 0 and end_min <= 1440 and start_min < end_min
    and start_min % 30 = 0 and end_min % 30 = 0
  ),
  constraint visits_companion check (
    (people = 1 and companion_name is null) or (people = 2 and companion_name is not null)
  )
);
create index if not exists visits_day_idx on public.visits (day, start_min);

create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  start_min smallint not null,
  end_min smallint not null,
  reason text not null default '' check (char_length(reason) <= 80),
  created_at timestamptz not null default now(),
  constraint blocks_slots check (
    start_min >= 0 and end_min <= 1440 and start_min < end_min
    and start_min % 30 = 0 and end_min % 30 = 0
  )
);
create index if not exists blocks_day_idx on public.blocks (day);

-- Les petits mots survivent à l'annulation de la visite (visit_id -> null).
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references public.visits (id) on delete set null,
  author text not null check (char_length(author) between 1 and 30),
  body text not null check (char_length(body) between 1 and 140),
  created_at timestamptz not null default now()
);
create index if not exists notes_created_idx on public.notes (created_at desc);

-- Photos prises pendant les visites. Le fichier est dans le stockage Supabase
-- (bucket « photos »), la base garde le nom du fichier et sa légende.
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  path text not null unique
    check (path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'),
  day date not null,
  author text not null check (char_length(author) between 1 and 30),
  caption text check (caption is null or char_length(caption) between 1 and 140),
  width smallint not null check (width between 1 and 4000),
  height smallint not null check (height between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists photos_day_idx on public.photos (day desc, created_at desc);

-- ----------------------------------------------------------------------------
--  Tables privées (jamais exposées)
-- ----------------------------------------------------------------------------

-- Empreinte (sha256) du jeton secret de l'appareil qui a créé la visite.
create table if not exists private.visit_owners (
  visit_id uuid primary key references public.visits (id) on delete cascade,
  owner_hash bytea not null
);
create index if not exists visit_owners_hash_idx on private.visit_owners (owner_hash);

create table if not exists private.note_owners (
  note_id uuid primary key references public.notes (id) on delete cascade,
  owner_hash bytea not null
);
create index if not exists note_owners_hash_idx on private.note_owners (owner_hash);

create table if not exists private.photo_owners (
  photo_id uuid primary key references public.photos (id) on delete cascade,
  owner_hash bytea not null
);
create index if not exists photo_owners_hash_idx on private.photo_owners (owner_hash);

create table if not exists private.admin (
  id boolean primary key default true check (id),
  pin_hash text
);
insert into private.admin (id) values (true) on conflict (id) do nothing;

create table if not exists private.admin_sessions (
  token_hash bytea primary key,
  expires_at timestamptz not null
);

create table if not exists private.rate_events (
  id bigint generated always as identity primary key,
  action text not null,
  key text not null,
  at timestamptz not null default now()
);
create index if not exists rate_events_idx on private.rate_events (action, key, at);

-- ----------------------------------------------------------------------------
--  Utilitaires
-- ----------------------------------------------------------------------------

-- Note : `set jit = off` sur les fonctions de calcul. Ces petites requêtes
-- n'en ont pas besoin et la compilation JIT les rendrait 50x plus lentes.

-- Heure locale de Paris. Le réglage `visites.now` ne sert qu'aux tests
-- automatisés (il n'est pas modifiable via l'API).
create or replace function private.now_local()
returns timestamp
language sql stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('visites.now', true), '')::timestamp,
    (now() at time zone 'Europe/Paris')
  )
$$;

create or replace function private.today()
returns date
language sql stable
set search_path = ''
as $$ select private.now_local()::date $$;

create or replace function private.now_min()
returns int
language sql stable
set search_path = ''
as $$
  select (extract(hour from private.now_local()) * 60 + extract(minute from private.now_local()))::int
$$;

create or replace function private.hash_key(p_key text)
returns bytea
language sql immutable
set search_path = ''
as $$ select sha256(convert_to(p_key, 'UTF8')) $$;

create or replace function private.err(p_reason text, p_message text)
returns jsonb
language sql immutable
set search_path = ''
as $$ select jsonb_build_object('ok', false, 'reason', p_reason, 'message', p_message) $$;

-- Nettoie un prénom : espaces superflus, caractères de contrôle. Null si vide.
create or replace function private.clean_name(p_text text, p_max int)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p_text is null then
    return null;
  end if;
  v := regexp_replace(p_text, '[[:cntrl:]]', '', 'g');
  v := btrim(regexp_replace(v, '\s+', ' ', 'g'));
  if v = '' then
    return null;
  end if;
  return left(v, p_max);
end;
$$;

-- Nettoie un petit mot : garde les retours à la ligne (3 max d'affilée).
create or replace function private.clean_note(p_text text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p_text is null then
    return null;
  end if;
  v := replace(p_text, E'\r', '');
  v := regexp_replace(v, '[\x01-\x09\x0b-\x1f\x7f]', '', 'g');
  v := regexp_replace(v, E'\n{3,}', E'\n\n', 'g');
  v := btrim(v, E' \n\t');
  if v = '' then
    return null;
  end if;
  return v;
end;
$$;

-- Identifiant anonyme du client pour la limite de débit (empreinte de l'IP).
create or replace function private.client_key()
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  h json;
  ip text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    h := null;
  end;
  ip := coalesce(
    h ->> 'cf-connecting-ip',
    btrim(split_part(h ->> 'x-forwarded-for', ',', 1)),
    h ->> 'x-real-ip',
    'local'
  );
  return encode(sha256(convert_to('visites:' || ip, 'UTF8')), 'hex');
end;
$$;

-- Enregistre une action et indique si la limite est respectée.
create or replace function private.rate_ok(p_action text, p_key text, p_max int, p_window interval)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  n int;
begin
  select count(*) into n
  from private.rate_events
  where action = p_action and key = p_key and at > now() - p_window;
  if n >= p_max then
    return false;
  end if;
  insert into private.rate_events (action, key) values (p_action, p_key);
  return true;
end;
$$;

create or replace function private.lock_day(p_day date)
returns void
language sql
set search_path = ''
as $$ select pg_advisory_xact_lock(1347, (p_day - date '2000-01-01')) $$;

create or replace function private.visit_json(p_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', v.id, 'day', v.day, 'start_min', v.start_min, 'end_min', v.end_min,
    'people', v.people, 'name', v.name, 'companion_name', v.companion_name
  )
  from public.visits v where v.id = p_id
$$;

-- ----------------------------------------------------------------------------
--  Capacité
-- ----------------------------------------------------------------------------

-- État de chaque tranche de 30 min d'une journée (plage d'ouverture).
create or replace function private.day_slots(p_day date, p_exclude uuid default null)
returns table (slot int, load int, blocked boolean, past boolean)
language sql stable
set search_path = ''
set jit = off
as $$
  with s as (select * from public.settings where id),
  g as (
    select gs::int as slot
    from s, generate_series(s.open_min::int, s.close_min::int - 30, 30) as gs
  )
  select
    g.slot,
    coalesce((
      select sum(v.people)::int from public.visits v
      where v.day = p_day and v.start_min <= g.slot and v.end_min > g.slot
        and (p_exclude is null or v.id <> p_exclude)
    ), 0) as load,
    exists (
      select 1 from public.blocks b
      where b.day = p_day and b.start_min <= g.slot and b.end_min > g.slot
    ) as blocked,
    (p_day < private.today() or (p_day = private.today() and g.slot + 30 <= private.now_min())) as past
  from g
  order by g.slot
$$;

-- Nombre de personnes déjà prévues sur une journée.
create or replace function private.day_people(p_day date, p_exclude uuid default null)
returns int
language sql stable
set search_path = ''
as $$
  select coalesce(sum(v.people), 0)::int from public.visits v
  where v.day = p_day and (p_exclude is null or v.id <> p_exclude)
$$;

-- Jours (proches de p_day) où il reste de la place pour p_people personnes.
create or replace function private.days_with_room(p_day date, p_people int, p_exclude uuid default null)
returns jsonb
language sql stable
set search_path = ''
set jit = off
as $$
  with s as (select * from public.settings where id),
  d as (
    select g::date as day
    from s, generate_series(private.today(), private.today() + (s.days_ahead - 1), interval '1 day') g
  )
  select coalesce(jsonb_agg(day order by day), '[]'::jsonb)
  from (
    select d.day from d, s
    where d.day <> p_day
      and (s.per_day is null or private.day_people(d.day, p_exclude) + p_people <= s.per_day)
      and not (d.day = private.today() and private.now_min() >= s.close_min - 30)
      and not exists (
        select 1 from public.blocks b
        where b.day = d.day and b.start_min <= s.open_min and b.end_min >= s.close_min
      )
    order by abs(d.day - p_day), d.day
    limit 4
  ) t
$$;

-- Plages libres d'une journée pour `p_people` personnes (pour proposer une
-- alternative en cas de refus). Tranches passées et bloquées exclues.
create or replace function private.free_ranges(p_day date, p_people int, p_exclude uuid default null)
returns jsonb
language sql stable
set search_path = ''
set jit = off
as $$
  with s as (
    select capacity, coalesce(per_day - private.day_people(p_day, p_exclude), 99) as day_left
    from public.settings where id
  ),
  d as (
    select ds.slot,
      (not ds.blocked and not ds.past and (s.capacity - ds.load) >= p_people and s.day_left >= p_people) as ok
    from private.day_slots(p_day, p_exclude) ds, s
  ),
  g as (
    select slot, ok, slot - 30 * row_number() over (partition by ok order by slot) as grp
    from d
  ),
  r as (
    select min(slot) as start_min, max(slot) + 30 as end_min
    from g where ok group by grp
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('start_min', start_min, 'end_min', end_min) order by start_min),
    '[]'::jsonb
  )
  from r
$$;

-- Vérifie qu'une visite peut avoir lieu. Renvoie null si tout va bien, sinon
-- un objet d'erreur { ok:false, reason, message }.
-- p_admin : l'admin ignore les règles de calendrier (passé, horizon, blocages,
-- durée max) mais jamais la capacité.
-- p_keep_start : lors d'une modification d'une visite déjà commencée,
-- l'heure d'arrivée d'origine reste acceptée.
create or replace function private.validate_slot(
  p_day date, p_start int, p_end int, p_people int,
  p_exclude uuid, p_admin boolean, p_keep_start int default null
)
returns jsonb
language plpgsql
set search_path = ''
set jit = off
as $$
declare
  s public.settings;
  v_today date := private.today();
  v_now int := private.now_min();
  v_reason text;
  v_bad int;
  v_day int;
begin
  select * into s from public.settings where id;

  if p_day is null or p_start is null or p_end is null or p_people is null then
    return private.err('invalid', 'Il manque le jour ou les horaires.');
  end if;
  if p_people not in (1, 2) then
    return private.err('invalid', 'Une visite compte une ou deux personnes.');
  end if;
  if p_start % 30 <> 0 or p_end % 30 <> 0 or p_start >= p_end then
    return private.err('invalid', 'Les horaires vont par demi-heure.');
  end if;
  if p_start < s.open_min or p_end > s.close_min then
    return private.err('outside_hours', format('Les visites ont lieu de %s à %s.',
      private.fmt_min(s.open_min), private.fmt_min(s.close_min)));
  end if;

  if not p_admin then
    if p_day < v_today or (p_day = v_today and p_end <= v_now)
       or (p_day = v_today and p_start + 30 <= v_now and p_start is distinct from p_keep_start) then
      return private.err('past', 'Cet horaire est déjà passé.');
    end if;
    if p_day > v_today + (s.days_ahead - 1) then
      return private.err('too_far', 'Ce jour n''est pas encore ouvert aux visites.');
    end if;
    if s.max_duration_min is not null and p_end - p_start > s.max_duration_min then
      return private.err('too_long', format('Une visite dure au maximum %s.',
        private.fmt_duration(s.max_duration_min)));
    end if;
    select b.reason into v_reason
    from public.blocks b
    where b.day = p_day and b.start_min < p_end and b.end_min > p_start
    order by b.start_min limit 1;
    if found then
      return private.err('blocked', coalesce(nullif(v_reason, ''), 'Pas de visite possible à ce moment-là.'));
    end if;
  end if;

  -- Pas plus de `per_day` personnes sur la journée. Une visite déjà prévue
  -- qu'on modifie sans ajouter personne reste acceptée.
  if s.per_day is not null then
    v_day := private.day_people(p_day, p_exclude);
    if v_day + p_people > s.per_day and not exists (
      select 1 from public.visits o where o.id = p_exclude and o.day = p_day and o.people >= p_people
    ) then
      return private.err('day_full', case
          when s.per_day - v_day = 1 then 'Il ne reste qu''une place ce jour-là : impossible de venir à deux.'
          when s.per_day - v_day > 1 then format('Il ne reste que %s places ce jour-là.', s.per_day - v_day)
          else format('Ce jour-là est complet : %s personnes sont déjà prévues.', v_day)
        end)
        || jsonb_build_object('next_days', private.days_with_room(p_day, p_people, p_exclude));
    end if;
  end if;

  -- La règle centrale : à aucun moment plus de `capacity` personnes.
  select min(ds.slot) into v_bad
  from private.day_slots(p_day, p_exclude) ds
  where ds.slot >= p_start and ds.slot < p_end and ds.load + p_people > s.capacity;
  if v_bad is not null then
    return private.err('full', format('Il n''y a plus assez de place à %s.', private.fmt_min(v_bad)))
      || jsonb_build_object('slot', v_bad);
  end if;

  return null;
end;
$$;

create or replace function private.fmt_min(p_min int)
returns text
language sql immutable
set search_path = ''
as $$
  select (p_min / 60)::text || 'h' || case when p_min % 60 = 0 then '' else lpad((p_min % 60)::text, 2, '0') end
$$;

create or replace function private.fmt_duration(p_min int)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_min < 60 then p_min::text || ' min'
    when p_min % 60 = 0 then (p_min / 60)::text || 'h'
    else (p_min / 60)::text || 'h' || lpad((p_min % 60)::text, 2, '0')
  end
$$;

-- Filet de sécurité : toute écriture dans `visits`, quelle qu'en soit
-- l'origine, est refusée si elle fait dépasser la capacité.
create or replace function private.visits_capacity_guard()
returns trigger
language plpgsql
set search_path = ''
set jit = off
as $$
declare
  v_cap int;
  v_per_day int;
  v_bad int;
begin
  perform private.lock_day(new.day);
  select capacity, per_day into v_cap, v_per_day from public.settings where id;
  if v_per_day is not null
     and (tg_op = 'INSERT' or new.day <> old.day or new.people > old.people)
     and private.day_people(new.day) > v_per_day then
    raise exception 'plus de % personnes le %', v_per_day, new.day using errcode = 'check_violation';
  end if;
  select min(g.slot) into v_bad
  from generate_series(new.start_min::int, new.end_min::int - 30, 30) as g(slot)
  where (
    select coalesce(sum(v.people), 0) from public.visits v
    where v.day = new.day and v.start_min <= g.slot and v.end_min > g.slot
  ) > v_cap;
  if v_bad is not null then
    raise exception 'capacité dépassée le % à %', new.day, private.fmt_min(v_bad)
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists visits_capacity_guard on public.visits;
create trigger visits_capacity_guard
  after insert or update of day, start_min, end_min, people on public.visits
  for each row execute function private.visits_capacity_guard();

-- Purge : visites passées depuis plus de 30 jours, traces techniques.
create or replace function private.purge_old()
returns void
language sql
set search_path = ''
as $$
  delete from public.visits where day < private.today() - 30;
  delete from public.blocks where day < private.today() - 30;
  delete from private.rate_events where at < now() - interval '1 day';
  delete from private.admin_sessions where expires_at < now();
$$;

-- ----------------------------------------------------------------------------
--  Lecture
-- ----------------------------------------------------------------------------

-- Tout ce dont l'app a besoin, en un seul appel.
create or replace function public.get_planning(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_from date := coalesce(p_from, private.today());
  v_to date;
begin
  v_to := least(coalesce(p_to, v_from + 60), v_from + 90);
  return jsonb_build_object(
    'now', jsonb_build_object(
      'day', private.today(),
      'min', private.now_min(),
      'epoch_ms', floor(extract(epoch from case
        when coalesce(current_setting('visites.now', true), '') = '' then now()
        else private.now_local() at time zone 'Europe/Paris' end) * 1000)
    ),
    'settings', (
      select jsonb_build_object(
        'app_name', s.app_name, 'patient_label', s.patient_label,
        'open_min', s.open_min, 'close_min', s.close_min, 'capacity', s.capacity, 'per_day', s.per_day,
        'max_duration_min', s.max_duration_min, 'days_ahead', s.days_ahead,
        'announcement', s.announcement, 'guidelines', s.guidelines
      ) from public.settings s where s.id
    ),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'day', v.day, 'start_min', v.start_min, 'end_min', v.end_min,
        'people', v.people, 'name', v.name, 'companion_name', v.companion_name
      ) order by v.day, v.start_min, v.created_at)
      from public.visits v where v.day between v_from and v_to
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'day', b.day, 'start_min', b.start_min, 'end_min', b.end_min, 'reason', b.reason
      ) order by b.day, b.start_min)
      from public.blocks b where b.day between v_from and v_to
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'author', n.author, 'body', n.body, 'created_at', n.created_at
      ) order by n.created_at desc)
      from (select * from public.notes order by created_at desc limit 300) n
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ph.id, 'path', ph.path, 'day', ph.day, 'author', ph.author, 'caption', ph.caption,
        'width', ph.width, 'height', ph.height, 'created_at', ph.created_at
      ) order by ph.day desc, ph.created_at desc)
      from (select * from public.photos order by day desc, created_at desc limit 2000) ph
    ), '[]'::jsonb)
  );
end;
$$;

-- Ce qui appartient à cet appareil (d'après ses jetons secrets).
create or replace function public.my_items(p_keys text[])
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  with k as (
    select key, ord::int - 1 as idx, private.hash_key(key) as h
    from unnest(p_keys[1:10]) with ordinality as t(key, ord)
    where char_length(key) between 32 and 128
  )
  select jsonb_build_object(
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.visit_id, 'key', k.idx))
      from private.visit_owners o join k on k.h = o.owner_hash
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.note_id, 'key', k.idx))
      from private.note_owners o join k on k.h = o.owner_hash
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.photo_id, 'key', k.idx))
      from private.photo_owners o join k on k.h = o.owner_hash
    ), '[]'::jsonb)
  )
$$;

-- ----------------------------------------------------------------------------
--  Réserver, modifier, annuler
-- ----------------------------------------------------------------------------

create or replace function public.book_visit(
  p_day date,
  p_start int,
  p_end int,
  p_people int,
  p_name text,
  p_companion text,
  p_note text,
  p_owner_key text,
  p_hp text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.clean_name(p_name, 30);
  v_comp text;
  v_note text := private.clean_note(p_note);
  v_hash bytea;
  v_err jsonb;
  v_id uuid;
  v_note_id uuid;
begin
  -- Pot de miel : un robot a rempli le champ caché. On fait semblant.
  if coalesce(p_hp, '') <> '' then
    return jsonb_build_object('ok', true, 'visit', jsonb_build_object(
      'id', gen_random_uuid(), 'day', p_day, 'start_min', p_start, 'end_min', p_end,
      'people', p_people, 'name', v_name, 'companion_name', null));
  end if;

  if p_owner_key is null or char_length(p_owner_key) not between 32 and 128 then
    return private.err('invalid', 'Jeton d''appareil invalide. Recharge la page.');
  end if;
  if not private.rate_ok('book', private.client_key(), 60, interval '1 hour') then
    return private.err('rate_limited', 'Beaucoup de réservations d''un coup. Réessaie dans un moment.');
  end if;
  if v_name is null then
    return private.err('invalid', 'Indique ton prénom.');
  end if;
  if p_people = 2 then
    v_comp := private.clean_name(p_companion, 30);
    if v_comp is null then
      return private.err('invalid', 'Indique le prénom de la personne qui t''accompagne.');
    end if;
  end if;
  if v_note is not null and char_length(v_note) > 140 then
    return private.err('invalid', 'Le petit mot fait plus de 140 caractères.');
  end if;
  if p_day is null then
    return private.err('invalid', 'Il manque le jour.');
  end if;

  perform private.lock_day(p_day);

  v_err := private.validate_slot(p_day, p_start, p_end, p_people, null, false);
  if v_err is not null then
    return v_err || jsonb_build_object('alternatives', private.free_ranges(p_day, p_people));
  end if;

  v_hash := private.hash_key(p_owner_key);
  insert into public.visits (day, start_min, end_min, people, name, companion_name)
  values (p_day, p_start, p_end, p_people, v_name, v_comp)
  returning id into v_id;
  insert into private.visit_owners (visit_id, owner_hash) values (v_id, v_hash);

  if v_note is not null then
    insert into public.notes (visit_id, author, body) values (v_id, v_name, v_note)
    returning id into v_note_id;
    insert into private.note_owners (note_id, owner_hash) values (v_note_id, v_hash);
  end if;

  perform private.purge_old();

  return jsonb_build_object('ok', true, 'visit', private.visit_json(v_id), 'note_id', v_note_id);
end;
$$;

create or replace function public.update_visit(
  p_id uuid,
  p_owner_key text,
  p_day date,
  p_start int,
  p_end int,
  p_people int,
  p_name text,
  p_companion text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.visits;
  v_name text := private.clean_name(p_name, 30);
  v_comp text;
  v_err jsonb;
begin
  if p_owner_key is null or char_length(p_owner_key) not between 32 and 128 then
    return private.err('forbidden', 'Cette visite n''a pas été réservée depuis cet appareil.');
  end if;
  if not private.rate_ok('edit', private.client_key(), 60, interval '1 hour') then
    return private.err('rate_limited', 'Beaucoup de modifications d''un coup. Réessaie dans un moment.');
  end if;
  if v_name is null then
    return private.err('invalid', 'Indique ton prénom.');
  end if;
  if p_people = 2 then
    v_comp := private.clean_name(p_companion, 30);
    if v_comp is null then
      return private.err('invalid', 'Indique le prénom de la personne qui t''accompagne.');
    end if;
  end if;

  select v.* into v_old from public.visits v where v.id = p_id;
  if not found then
    return private.err('not_found', 'Cette visite n''existe plus.');
  end if;
  if p_day is null then
    return private.err('invalid', 'Il manque le jour.');
  end if;

  -- Verrouille les jours concernés, toujours dans le même ordre.
  perform private.lock_day(least(v_old.day, p_day));
  if p_day <> v_old.day then
    perform private.lock_day(greatest(v_old.day, p_day));
  end if;

  select v.* into v_old from public.visits v
  join private.visit_owners o on o.visit_id = v.id
  where v.id = p_id and o.owner_hash = private.hash_key(p_owner_key)
  for update of v;
  if not found then
    return private.err('forbidden', 'Cette visite n''a pas été réservée depuis cet appareil.');
  end if;
  if v_old.day < private.today() or (v_old.day = private.today() and v_old.end_min <= private.now_min()) then
    return private.err('past', 'Cette visite est déjà passée.');
  end if;

  v_err := private.validate_slot(p_day, p_start, p_end, p_people, p_id, false,
    case when p_day = v_old.day then v_old.start_min::int end);
  if v_err is not null then
    return v_err || jsonb_build_object('alternatives', private.free_ranges(p_day, p_people, p_id));
  end if;

  update public.visits
  set day = p_day, start_min = p_start, end_min = p_end, people = p_people,
      name = v_name, companion_name = v_comp, updated_at = now()
  where id = p_id;

  return jsonb_build_object('ok', true, 'visit', private.visit_json(p_id));
end;
$$;

create or replace function public.cancel_visit(p_id uuid, p_owner_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date;
begin
  if p_owner_key is null or char_length(p_owner_key) not between 32 and 128 then
    return private.err('forbidden', 'Cette visite n''a pas été réservée depuis cet appareil.');
  end if;
  if not private.rate_ok('edit', private.client_key(), 60, interval '1 hour') then
    return private.err('rate_limited', 'Beaucoup de modifications d''un coup. Réessaie dans un moment.');
  end if;
  select v.day into v_day from public.visits v where v.id = p_id;
  if not found then
    return jsonb_build_object('ok', true);
  end if;
  perform private.lock_day(v_day);
  delete from public.visits v
  using private.visit_owners o
  where v.id = p_id and o.visit_id = v.id and o.owner_hash = private.hash_key(p_owner_key);
  if not found then
    return private.err('forbidden', 'Cette visite n''a pas été réservée depuis cet appareil.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_note(p_id uuid, p_owner_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_owner_key is null or char_length(p_owner_key) not between 32 and 128 then
    return private.err('forbidden', 'Ce mot n''a pas été écrit depuis cet appareil.');
  end if;
  delete from public.notes n
  using private.note_owners o
  where n.id = p_id and o.note_id = n.id and o.owner_hash = private.hash_key(p_owner_key);
  if not found then
    return private.err('forbidden', 'Ce mot n''a pas été écrit depuis cet appareil.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ----------------------------------------------------------------------------
--  Photos
-- ----------------------------------------------------------------------------

-- Enregistre une photo déjà envoyée dans le stockage (bucket « photos »).
create or replace function public.add_photo(
  p_path text,
  p_day date,
  p_author text,
  p_caption text,
  p_width int,
  p_height int,
  p_owner_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author text := private.clean_name(p_author, 30);
  v_caption text := private.clean_note(p_caption);
  v_day date := coalesce(p_day, private.today());
  v_exists boolean := true;
  v_id uuid;
begin
  if p_owner_key is null or char_length(p_owner_key) not between 32 and 128 then
    return private.err('invalid', 'Jeton d''appareil invalide. Recharge la page.');
  end if;
  if not private.rate_ok('photo', private.client_key(), 60, interval '1 hour') then
    return private.err('rate_limited', 'Beaucoup de photos d''un coup. Réessaie dans un moment.');
  end if;
  if v_author is null then
    return private.err('invalid', 'Indique ton prénom.');
  end if;
  if v_caption is not null and char_length(v_caption) > 140 then
    return private.err('invalid', 'La légende fait plus de 140 caractères.');
  end if;
  if p_path is null or p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$' then
    return private.err('invalid', 'Nom de fichier invalide.');
  end if;
  if v_day > private.today() or v_day < private.today() - 30 then
    return private.err('invalid', 'Date de photo invalide.');
  end if;
  if p_width not between 1 and 4000 or p_height not between 1 and 4000 then
    return private.err('invalid', 'Dimensions de photo invalides.');
  end if;
  -- Le fichier doit vraiment être arrivé dans le stockage.
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)'
      into v_exists using 'photos', p_path;
  end if;
  if not v_exists then
    return private.err('invalid', 'La photo n''a pas été reçue. Réessaie.');
  end if;

  insert into public.photos (path, day, author, caption, width, height)
  values (p_path, v_day, v_author, v_caption, p_width, p_height)
  on conflict (path) do nothing
  returning id into v_id;
  if v_id is null then
    return private.err('invalid', 'Cette photo est déjà enregistrée.');
  end if;
  insert into private.photo_owners (photo_id, owner_hash) values (v_id, private.hash_key(p_owner_key));

  return jsonb_build_object('ok', true, 'photo', (
    select jsonb_build_object(
      'id', ph.id, 'path', ph.path, 'day', ph.day, 'author', ph.author, 'caption', ph.caption,
      'width', ph.width, 'height', ph.height, 'created_at', ph.created_at
    ) from public.photos ph where ph.id = v_id
  ));
end;
$$;

create or replace function public.delete_photo(p_id uuid, p_owner_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  if p_owner_key is null or char_length(p_owner_key) not between 32 and 128 then
    return private.err('forbidden', 'Cette photo n''a pas été ajoutée depuis cet appareil.');
  end if;
  delete from public.photos ph
  using private.photo_owners o
  where ph.id = p_id and o.photo_id = ph.id and o.owner_hash = private.hash_key(p_owner_key)
  returning ph.path into v_path;
  if v_path is null then
    return private.err('forbidden', 'Cette photo n''a pas été ajoutée depuis cet appareil.');
  end if;
  return jsonb_build_object('ok', true, 'path', v_path);
end;
$$;

-- ----------------------------------------------------------------------------
--  Admin (code PIN)
-- ----------------------------------------------------------------------------

-- À lancer une fois dans l'éditeur SQL :  select private.set_admin_pin('123456');
create or replace function private.set_admin_pin(p_pin text)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if p_pin is null or char_length(p_pin) < 4 or char_length(p_pin) > 32 then
    raise exception 'Le code doit faire entre 4 et 32 caractères.';
  end if;
  update private.admin set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)) where id;
  delete from private.admin_sessions;
  return 'Code admin enregistré.';
end;
$$;

create or replace function private.admin_ok(p_token text)
returns boolean
language sql stable
set search_path = ''
as $$
  select p_token is not null and exists (
    select 1 from private.admin_sessions
    where token_hash = private.hash_key(p_token) and expires_at > now()
  )
$$;

create or replace function public.admin_login(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_token text;
  v_fails int;
begin
  select count(*) into v_fails from private.rate_events
  where action = 'admin_fail' and key = private.client_key() and at > now() - interval '15 minutes';
  if v_fails >= 5 then
    return private.err('rate_limited', 'Trop d''essais. Réessaie dans 15 minutes.');
  end if;
  select count(*) into v_fails from private.rate_events
  where action = 'admin_fail' and at > now() - interval '1 hour';
  if v_fails >= 30 then
    return private.err('rate_limited', 'Trop d''essais. Réessaie dans une heure.');
  end if;

  select pin_hash into v_hash from private.admin where id;
  if v_hash is null then
    return private.err('no_pin', 'Aucun code admin n''est défini. Voir le README.');
  end if;
  if p_pin is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    insert into private.rate_events (action, key) values ('admin_fail', private.client_key());
    return private.err('wrong_pin', 'Code incorrect.');
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.admin_sessions (token_hash, expires_at)
  values (private.hash_key(v_token), now() + interval '30 days');
  return jsonb_build_object('ok', true, 'token', v_token);
end;
$$;

create or replace function public.admin_check(p_token text)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$ select jsonb_build_object('ok', private.admin_ok(p_token)) $$;

create or replace function public.admin_logout(p_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  delete from private.admin_sessions where token_hash = private.hash_key(p_token);
  select jsonb_build_object('ok', true);
$$;

create or replace function public.admin_set_pin(p_token text, p_new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not private.admin_ok(p_token) then
    return private.err('unauthorized', 'Session admin expirée.');
  end if;
  if p_new_pin is null or char_length(p_new_pin) < 4 or char_length(p_new_pin) > 32 then
    return private.err('invalid', 'Le code doit faire entre 4 et 32 caractères.');
  end if;
  perform private.set_admin_pin(p_new_pin);
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.admin_sessions (token_hash, expires_at)
  values (private.hash_key(v_token), now() + interval '30 days');
  return jsonb_build_object('ok', true, 'token', v_token);
end;
$$;

-- Bloque une période. Renvoie les visites déjà prévues dessus, pour prévenir.
create or replace function public.admin_block(
  p_token text, p_day date, p_start int, p_end int, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.admin_ok(p_token) then
    return private.err('unauthorized', 'Session admin expirée.');
  end if;
  if p_day is null or p_start is null or p_end is null
     or p_start % 30 <> 0 or p_end % 30 <> 0 or p_start >= p_end or p_start < 0 or p_end > 1440 then
    return private.err('invalid', 'Période invalide.');
  end if;
  perform private.lock_day(p_day);
  insert into public.blocks (day, start_min, end_min, reason)
  values (p_day, p_start, p_end, coalesce(left(private.clean_name(p_reason, 80), 80), ''))
  returning id into v_id;
  return jsonb_build_object(
    'ok', true,
    'block_id', v_id,
    'affected', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'day', v.day, 'start_min', v.start_min, 'end_min', v.end_min,
        'people', v.people, 'name', v.name, 'companion_name', v.companion_name
      ) order by v.start_min)
      from public.visits v
      where v.day = p_day and v.start_min < p_end and v.end_min > p_start
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_unblock(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.admin_ok(p_token) then
    return private.err('unauthorized', 'Session admin expirée.');
  end if;
  delete from public.blocks where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Crée (p_id null) ou modifie n'importe quelle visite. La capacité reste
-- vérifiée ; les règles de calendrier (passé, horizon, blocages) non.
create or replace function public.admin_save_visit(
  p_token text,
  p_id uuid,
  p_day date,
  p_start int,
  p_end int,
  p_people int,
  p_name text,
  p_companion text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.visits;
  v_name text := private.clean_name(p_name, 30);
  v_comp text;
  v_err jsonb;
  v_id uuid := p_id;
begin
  if not private.admin_ok(p_token) then
    return private.err('unauthorized', 'Session admin expirée.');
  end if;
  if v_name is null then
    return private.err('invalid', 'Indique un prénom.');
  end if;
  if p_people = 2 then
    v_comp := private.clean_name(p_companion, 30);
    if v_comp is null then
      return private.err('invalid', 'Indique le prénom de l''accompagnant.');
    end if;
  end if;
  if p_day is null then
    return private.err('invalid', 'Il manque le jour.');
  end if;

  if p_id is not null then
    select v.* into v_old from public.visits v where v.id = p_id;
    if not found then
      return private.err('not_found', 'Cette visite n''existe plus.');
    end if;
    perform private.lock_day(least(v_old.day, p_day));
    if p_day <> v_old.day then
      perform private.lock_day(greatest(v_old.day, p_day));
    end if;
  else
    perform private.lock_day(p_day);
  end if;

  v_err := private.validate_slot(p_day, p_start, p_end, p_people, p_id, true);
  if v_err is not null then
    return v_err || jsonb_build_object('alternatives', private.free_ranges(p_day, p_people, p_id));
  end if;

  if p_id is null then
    insert into public.visits (day, start_min, end_min, people, name, companion_name)
    values (p_day, p_start, p_end, p_people, v_name, v_comp)
    returning id into v_id;
  else
    update public.visits
    set day = p_day, start_min = p_start, end_min = p_end, people = p_people,
        name = v_name, companion_name = v_comp, updated_at = now()
    where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'visit', private.visit_json(v_id));
end;
$$;

create or replace function public.admin_delete_visit(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.admin_ok(p_token) then
    return private.err('unauthorized', 'Session admin expirée.');
  end if;
  delete from public.visits where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_delete_photo(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  if not private.admin_ok(p_token) then
    return private.err('unauthorized', 'Session admin expirée.');
  end if;
  delete from public.photos where id = p_id returning path into v_path;
  return jsonb_build_object('ok', true, 'path', v_path);
end;
$$;

create or replace function public.admin_delete_note(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.admin_ok(p_token) then
    return private.err('unauthorized', 'Session admin expirée.');
  end if;
  delete from public.notes where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Met à jour les réglages présents dans p_patch (les autres restent tels quels).
create or replace function public.admin_update_settings(p_token text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.admin_ok(p_token) then
    return private.err('unauthorized', 'Session admin expirée.');
  end if;
  begin
    update public.settings s set
      app_name = coalesce(private.clean_name(p_patch ->> 'app_name', 40), s.app_name),
      patient_label = coalesce(private.clean_name(p_patch ->> 'patient_label', 30), s.patient_label),
      open_min = coalesce((p_patch ->> 'open_min')::smallint, s.open_min),
      close_min = coalesce((p_patch ->> 'close_min')::smallint, s.close_min),
      capacity = coalesce((p_patch ->> 'capacity')::smallint, s.capacity),
      per_day = case
        when p_patch ? 'per_day' then nullif(p_patch ->> 'per_day', '')::smallint
        else s.per_day end,
      max_duration_min = case
        when p_patch ? 'max_duration_min' then nullif(p_patch ->> 'max_duration_min', '')::smallint
        else s.max_duration_min end,
      days_ahead = coalesce((p_patch ->> 'days_ahead')::smallint, s.days_ahead),
      announcement = case
        when p_patch ? 'announcement' then coalesce(btrim(p_patch ->> 'announcement'), '')
        else s.announcement end,
      guidelines = case
        when p_patch ? 'guidelines' then coalesce(btrim(p_patch ->> 'guidelines'), '')
        else s.guidelines end,
      updated_at = now()
    where s.id;
  exception
    when check_violation or invalid_text_representation or numeric_value_out_of_range then
      return private.err('invalid', 'Réglage invalide.');
  end;
  return jsonb_build_object('ok', true);
end;
$$;

-- ----------------------------------------------------------------------------
--  Droits d'accès
-- ----------------------------------------------------------------------------

alter table public.settings enable row level security;
alter table public.visits enable row level security;
alter table public.blocks enable row level security;
alter table public.notes enable row level security;
alter table public.photos enable row level security;

drop policy if exists "lecture publique" on public.settings;
drop policy if exists "lecture publique" on public.visits;
drop policy if exists "lecture publique" on public.blocks;
drop policy if exists "lecture publique" on public.notes;
drop policy if exists "lecture publique" on public.photos;
create policy "lecture publique" on public.settings for select to anon, authenticated using (true);
create policy "lecture publique" on public.visits for select to anon, authenticated using (true);
create policy "lecture publique" on public.blocks for select to anon, authenticated using (true);
create policy "lecture publique" on public.notes for select to anon, authenticated using (true);
create policy "lecture publique" on public.photos for select to anon, authenticated using (true);

-- Lecture seule, rien d'autre.
revoke all on public.settings, public.visits, public.blocks, public.notes, public.photos from anon, authenticated;
grant select on public.settings, public.visits, public.blocks, public.notes, public.photos to anon, authenticated;

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.get_planning(date, date)',
    'public.my_items(text[])',
    'public.book_visit(date, int, int, int, text, text, text, text, text)',
    'public.update_visit(uuid, text, date, int, int, int, text, text)',
    'public.cancel_visit(uuid, text)',
    'public.delete_note(uuid, text)',
    'public.add_photo(text, date, text, text, int, int, text)',
    'public.delete_photo(uuid, text)',
    'public.admin_delete_photo(text, uuid)',
    'public.admin_login(text)',
    'public.admin_check(text)',
    'public.admin_logout(text)',
    'public.admin_set_pin(text, text)',
    'public.admin_block(text, date, int, int, text)',
    'public.admin_unblock(text, uuid)',
    'public.admin_save_visit(text, uuid, date, int, int, int, text, text)',
    'public.admin_delete_visit(text, uuid)',
    'public.admin_delete_note(text, uuid)',
    'public.admin_update_settings(text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
--  Temps réel (Supabase Realtime) et purge quotidienne (pg_cron, si dispo)
-- ----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['visits', 'blocks', 'notes', 'settings', 'photos'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- Stockage des photos : bucket public (adresses impossibles à deviner),
-- 6 Mo max, JPEG seulement. Ajout autorisé, ni modification ni suppression
-- depuis l'app (la suppression passe par la fonction Vercel /api/photo-cleanup).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('photos', 'photos', true, 6291456, array['image/jpeg'])
    on conflict (id) do update
      set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists "visites : ajout de photos" on storage.objects';
    execute $policy$
      create policy "visites : ajout de photos" on storage.objects
      for insert to anon, authenticated
      with check (
        bucket_id = 'photos'
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
      )
    $policy$;
  end if;
end;
$$;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron indisponible : la purge se fera à chaque réservation.';
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$ select cron.schedule('visites-purge', '17 3 * * *', 'select private.purge_old()') $cron$;
  end if;
exception when others then
  raise notice 'Planification de la purge impossible : elle se fera à chaque réservation.';
end;
$$;

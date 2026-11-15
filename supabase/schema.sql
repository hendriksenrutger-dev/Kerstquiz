-- =====================================================================
-- Kerstquiz – database-opzet (PR 1: Basis)
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Het script mag opnieuw worden uitgevoerd; bestaande data blijft staan.
--
-- Beveiliging in het kort:
--   * Spelers zijn niet ingelogd (rol "anon"). Ze mogen alleen
--     `questions` en `games` lezen. Aanmelden en antwoorden gaat via
--     databasefuncties (RPC) die zelf controleren of dat mag.
--   * De beheerder is ingelogd (rol "authenticated", geen anoniem
--     account). Zelf aanmelden staat uit, dus dat is alleen Rutger.
--   * `question_answers` (de juiste antwoorden) is alleen voor de beheerder.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Hulpfunctie: is de huidige gebruiker de beheerder?
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

-- ---------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------

-- Alles wat spelers mogen zien.
create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  position    integer not null default 0,
  category    text    not null default '',                 -- rubriek
  kind        text    not null default 'meerkeuze'
              check (kind in ('meerkeuze', 'open', 'schatting')),
  text        text    not null,
  photo_path  text,                                         -- pad in bucket "fotos"
  options     jsonb,                                        -- meerkeuze: ["A-tekst","B-tekst","C-tekst","D-tekst"]
  unit        text,                                         -- schatting: "jaar", "kg", …
  time_limit  integer not null default 20 check (time_limit between 5 and 600),
  rate_tree   boolean not null default false,               -- "spelers geven deze boom een cijfer"
  created_at  timestamptz not null default now(),
  constraint options_meerkeuze check (
    kind <> 'meerkeuze'
    or (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4)
  )
);
create index if not exists questions_position_idx on public.questions (position, created_at);

-- De juiste antwoorden. Alleen leesbaar voor de beheerder.
create table if not exists public.question_answers (
  question_id    uuid primary key references public.questions (id) on delete cascade,
  correct_option smallint check (correct_option between 0 and 3),  -- 0=A … 3=D
  correct_texts  text[],                                            -- open vraag
  correct_value  numeric                                            -- schatting
);

-- Een spel (één avond = één kamercode).
create table if not exists public.games (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{4}$'),
  status              text not null default 'lobby'
                      check (status in ('lobby', 'question', 'answers', 'final', 'tree')),
  current_question_id uuid references public.questions (id) on delete set null,
  question_started_at timestamptz,
  photo_url           text,           -- tijdelijke (signed) link van de huidige foto
  min_votes           integer not null default 10 check (min_votes >= 1),
  created_at          timestamptz not null default now()
);

create table if not exists public.players (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 14),
  created_at timestamptz not null default now()
);
create unique index if not exists players_game_name_uidx
  on public.players (game_id, lower(name));

-- Eén rij per speler per vraag; bij wijzigen wordt de rij bijgewerkt.
create table if not exists public.answers (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games (id) on delete cascade,
  player_id     uuid not null references public.players (id) on delete cascade,
  question_id   uuid not null references public.questions (id) on delete cascade,
  choice        smallint check (choice between 0 and 3),
  text_answer   text check (char_length(text_answer) <= 200),
  number_answer numeric,
  rating        smallint check (rating between 1 and 10),
  answered_at   timestamptz not null default now(),
  unique (player_id, question_id)
);
create index if not exists answers_game_question_idx on public.answers (game_id, question_id);

-- Handmatige goed/fout-omzettingen bij open vragen.
create table if not exists public.overrides (
  game_id     uuid not null references public.games (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  normalized  text not null,
  correct     boolean not null,
  primary key (game_id, question_id, normalized)
);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.questions        enable row level security;
alter table public.question_answers enable row level security;
alter table public.games            enable row level security;
alter table public.players          enable row level security;
alter table public.answers          enable row level security;
alter table public.overrides        enable row level security;

-- questions: iedereen mag lezen, beheerder mag alles.
drop policy if exists "questions lezen" on public.questions;
create policy "questions lezen" on public.questions
  for select to anon, authenticated using (true);
drop policy if exists "questions beheer" on public.questions;
create policy "questions beheer" on public.questions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- question_answers: alleen de beheerder.
drop policy if exists "question_answers beheer" on public.question_answers;
create policy "question_answers beheer" on public.question_answers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- games: iedereen mag lezen, beheerder mag alles.
drop policy if exists "games lezen" on public.games;
create policy "games lezen" on public.games
  for select to anon, authenticated using (true);
drop policy if exists "games beheer" on public.games;
create policy "games beheer" on public.games
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- players, answers, overrides: alleen de beheerder direct.
-- Spelers gebruiken de functies join_game / submit_answer hieronder.
drop policy if exists "players beheer" on public.players;
create policy "players beheer" on public.players
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "answers beheer" on public.answers;
create policy "answers beheer" on public.answers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "overrides beheer" on public.overrides;
create policy "overrides beheer" on public.overrides
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Extra slot op de deur: anon krijgt geen directe tabelrechten op
-- de juiste antwoorden en op de gegevens van andere spelers.
revoke all on public.question_answers from anon;
revoke all on public.players          from anon;
revoke all on public.answers          from anon;
revoke all on public.overrides        from anon;
revoke insert, update, delete on public.questions from anon;
revoke insert, update, delete on public.games     from anon;

-- ---------------------------------------------------------------------
-- Functies (RPC) voor spelers
-- ---------------------------------------------------------------------

-- Servertijd, zodat tv en telefoon dezelfde klok gebruiken voor de timer.
create or replace function public.server_time()
returns timestamptz
language sql
stable
as $$ select now(); $$;

-- Aanmelden met naam + kamercode. Geeft het nieuwe speler-id terug.
-- Fouten: 'kamercode_onbekend', 'naam_ongeldig', 'naam_bezet'.
create or replace function public.join_game(p_code text, p_name text)
returns table (player_id uuid, game_id uuid, name text, code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game  public.games%rowtype;
  v_name  text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_id    uuid;
begin
  select * into v_game from public.games g where g.code = upper(btrim(coalesce(p_code, '')));
  if not found then
    raise exception 'kamercode_onbekend' using errcode = 'P0001';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 14 then
    raise exception 'naam_ongeldig' using errcode = 'P0001';
  end if;

  begin
    insert into public.players (game_id, name) values (v_game.id, v_name)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'naam_bezet' using errcode = 'P0001';
  end;

  return query select v_id, v_game.id, v_name, v_game.code;
end;
$$;

-- Verder spelen na herladen: bestaat dit speler-id nog?
create or replace function public.get_player(p_player_id uuid)
returns table (player_id uuid, game_id uuid, name text, code text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.game_id, p.name, g.code
  from public.players p
  join public.games g on g.id = p.game_id
  where p.id = p_player_id;
$$;

-- Antwoord insturen of wijzigen. Alleen zolang de vraag open staat
-- (huidige vraag van het spel en de tijd is nog niet om; 2 s marge voor
-- vertraging onderweg). Velden die null zijn blijven ongewijzigd.
-- Fouten: 'speler_onbekend', 'vraag_gesloten', 'keuze_ongeldig'.
create or replace function public.submit_answer(
  p_player_id   uuid,
  p_question_id uuid,
  p_choice      smallint default null,
  p_text        text     default null,
  p_number      numeric  default null,
  p_rating      smallint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
  v_game   public.games%rowtype;
  v_q      public.questions%rowtype;
begin
  select * into v_player from public.players where id = p_player_id;
  if not found then
    raise exception 'speler_onbekend' using errcode = 'P0001';
  end if;

  select * into v_game from public.games where id = v_player.game_id;
  select * into v_q    from public.questions where id = p_question_id;

  if v_game.status <> 'question'
     or v_game.current_question_id is distinct from p_question_id
     or v_q.id is null
     or v_game.question_started_at is null
     or now() > v_game.question_started_at + make_interval(secs => v_q.time_limit + 2)
  then
    raise exception 'vraag_gesloten' using errcode = 'P0001';
  end if;

  if p_choice is not null and (v_q.kind <> 'meerkeuze' or p_choice not between 0 and 3) then
    raise exception 'keuze_ongeldig' using errcode = 'P0001';
  end if;
  if p_rating is not null and (not v_q.rate_tree or p_rating not between 1 and 10) then
    raise exception 'keuze_ongeldig' using errcode = 'P0001';
  end if;

  insert into public.answers as a
    (game_id, player_id, question_id, choice, text_answer, number_answer, rating, answered_at)
  values
    (v_game.id, p_player_id, p_question_id, p_choice, left(p_text, 200), p_number, p_rating, now())
  on conflict (player_id, question_id) do update set
    choice        = coalesce(excluded.choice,        a.choice),
    text_answer   = coalesce(excluded.text_answer,   a.text_answer),
    number_answer = coalesce(excluded.number_answer, a.number_answer),
    rating        = coalesce(excluded.rating,        a.rating),
    answered_at   = now();
end;
$$;

-- Eigen antwoord terughalen (na herladen van de telefoon).
create or replace function public.get_my_answer(p_player_id uuid, p_question_id uuid)
returns table (choice smallint, text_answer text, number_answer numeric, rating smallint)
language sql
stable
security definer
set search_path = public
as $$
  select a.choice, a.text_answer, a.number_answer, a.rating
  from public.answers a
  where a.player_id = p_player_id and a.question_id = p_question_id;
$$;

-- ---------------------------------------------------------------------
-- Functies (RPC) voor de beheerder / het tv-scherm
-- ---------------------------------------------------------------------

-- Nieuw spel met een unieke kamercode van 4 tekens (zonder O/0/I/1/L).
create or replace function public.create_game()
returns public.games
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  v_game public.games%rowtype;
  i int;
begin
  if not public.is_admin() then
    raise exception 'geen_toegang' using errcode = '42501';
  end if;

  loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into public.games (code) values (v_code) returning * into v_game;
      return v_game;
    exception when unique_violation then
      -- code bestond al, probeer opnieuw
    end;
  end loop;
end;
$$;

-- Spelstatus zetten. Bij status 'question' wordt de starttijd van de
-- vraag op de servertijd gezet (zodat de timer overal gelijk loopt).
create or replace function public.set_game_state(
  p_game_id     uuid,
  p_status      text,
  p_question_id uuid default null,
  p_photo_url   text default null
)
returns public.games
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
begin
  if not public.is_admin() then
    raise exception 'geen_toegang' using errcode = '42501';
  end if;

  update public.games set
    status              = p_status,
    current_question_id = p_question_id,
    question_started_at = case when p_status = 'question' then now() else null end,
    photo_url           = p_photo_url
  where id = p_game_id
  returning * into v_game;

  if not found then
    raise exception 'spel_onbekend' using errcode = 'P0001';
  end if;
  return v_game;
end;
$$;

-- Rechten op functies: standaard mag iedereen uitvoeren; beperk de
-- beheerfuncties tot ingelogde gebruikers (ze controleren ook zelf).
revoke execute on function public.create_game()                         from public, anon;
revoke execute on function public.set_game_state(uuid, text, uuid, text) from public, anon;
grant  execute on function public.create_game()                         to authenticated;
grant  execute on function public.set_game_state(uuid, text, uuid, text) to authenticated;

grant execute on function public.server_time()                                     to anon, authenticated;
grant execute on function public.join_game(text, text)                             to anon, authenticated;
grant execute on function public.get_player(uuid)                                  to anon, authenticated;
grant execute on function public.submit_answer(uuid, uuid, smallint, text, numeric, smallint) to anon, authenticated;
grant execute on function public.get_my_answer(uuid, uuid)                         to anon, authenticated;

-- ---------------------------------------------------------------------
-- Realtime: tv en telefoons volgen deze tabellen.
-- (RLS geldt ook voor realtime: spelers ontvangen alleen `games`.)
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['games', 'players', 'answers'] loop
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

-- ---------------------------------------------------------------------
-- Opslag: privé bucket "fotos" (alleen de beheerder).
-- Spelers krijgen de foto via een tijdelijke link (signed URL) in games.photo_url.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false;

drop policy if exists "fotos beheer lezen"    on storage.objects;
drop policy if exists "fotos beheer toevoegen" on storage.objects;
drop policy if exists "fotos beheer wijzigen" on storage.objects;
drop policy if exists "fotos beheer verwijderen" on storage.objects;

create policy "fotos beheer lezen" on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos' and public.is_admin());
create policy "fotos beheer toevoegen" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos' and public.is_admin());
create policy "fotos beheer wijzigen" on storage.objects
  for update to authenticated
  using (bucket_id = 'fotos' and public.is_admin())
  with check (bucket_id = 'fotos' and public.is_admin());
create policy "fotos beheer verwijderen" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos' and public.is_admin());

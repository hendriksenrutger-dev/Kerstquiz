-- =====================================================================
-- Kerstquiz – 004: tussenstand, schiftingsvraag en winnaars (SPEC 12)
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Pas uitvoeren NA schema.sql, 002_beheer.sql en 003_muziek.sql.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw:
--   * questions.tiebreak  – schiftingsvraag (alleen bij gelijke stand in de top 3)
--   * games.status        – ook 'tussenstand' en 'schifting'
--   * games.tiebreak_names – namen van de spelers die meedoen aan de schifting
--   * games.tiebreak_done  – gestelde schiftingsvragen, in volgorde
--   * games.winners        – top 3 bij de definitieve eindstand: [{"name": "...", "place": 1}, ...]
--   Bewust namen en geen speler-id's: games is leesbaar voor iedereen.
--   * submit_answer        – ook antwoorden op de schiftingsvraag (alleen deelnemers)
--   * set_game_state       – starttijd ook bij de schiftingsvraag
-- =====================================================================

alter table public.questions
  add column if not exists tiebreak boolean not null default false;

alter table public.games
  add column if not exists tiebreak_names text[],
  add column if not exists tiebreak_done  uuid[] not null default '{}',
  add column if not exists winners        jsonb;

alter table public.games drop constraint if exists games_status_check;
alter table public.games add constraint games_status_check
  check (status in ('lobby', 'question', 'tussenstand', 'answers', 'final', 'schifting', 'tree'));

-- Antwoord insturen of wijzigen. Zoals in schema.sql, plus de schiftingsvraag:
-- bij status 'schifting' mogen alleen de spelers in tiebreak_names antwoorden.
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

  if v_game.status not in ('question', 'schifting')
     or v_game.current_question_id is distinct from p_question_id
     or v_q.id is null
     or v_game.question_started_at is null
     or now() > v_game.question_started_at + make_interval(secs => v_q.time_limit + 2)
  then
    raise exception 'vraag_gesloten' using errcode = 'P0001';
  end if;

  if v_game.status = 'schifting' and not exists (
    select 1 from unnest(coalesce(v_game.tiebreak_names, '{}')) n where lower(n) = lower(v_player.name)
  ) then
    raise exception 'geen_schifting' using errcode = 'P0001';
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

grant execute on function public.submit_answer(uuid, uuid, smallint, text, numeric, smallint) to anon, authenticated;

-- Spelstatus zetten: de starttijd geldt nu ook voor de schiftingsvraag.
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
    question_started_at = case when p_status in ('question', 'schifting') then now() else null end,
    photo_url           = p_photo_url
  where id = p_game_id
  returning * into v_game;

  if not found then
    raise exception 'spel_onbekend' using errcode = 'P0001';
  end if;
  return v_game;
end;
$$;

revoke execute on function public.set_game_state(uuid, text, uuid, text) from public, anon;
grant  execute on function public.set_game_state(uuid, text, uuid, text) to authenticated;

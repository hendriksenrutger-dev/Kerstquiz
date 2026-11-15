-- =====================================================================
-- Kerstquiz – 002: beheer (PR 2)
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Pas uitvoeren NA schema.sql. Mag opnieuw worden uitgevoerd.
--
-- Nieuw:
--   * tabel `settings` met spelinstellingen (minimum aantal stemmen
--     voor de mooiste kerstboom), alleen voor de beheerder;
--   * create_game() neemt dat minimum over in het nieuwe spel.
-- =====================================================================

create table if not exists public.settings (
  id        integer primary key default 1 check (id = 1),   -- precies één rij
  min_votes integer not null default 10 check (min_votes >= 1)
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

alter table public.settings enable row level security;

drop policy if exists "settings beheer" on public.settings;
create policy "settings beheer" on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.settings from anon;

-- Nieuw spel: kamercode zoals voorheen, minimum aantal stemmen uit settings.
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
  v_min  integer := coalesce((select s.min_votes from public.settings s where s.id = 1), 10);
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
      insert into public.games (code, min_votes) values (v_code, v_min) returning * into v_game;
      return v_game;
    exception when unique_violation then
      -- code bestond al, probeer opnieuw
    end;
  end loop;
end;
$$;

revoke execute on function public.create_game() from public, anon;
grant  execute on function public.create_game() to authenticated;

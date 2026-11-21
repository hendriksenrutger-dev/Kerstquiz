-- =====================================================================
-- Kerstquiz – 020: afstandsbediening (telefoon van de quizmaster)
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw: tabel remote_commands. De pagina #afstand (ingelogd als beheerder)
-- zet hier "volgende" of "vorige" in; de tv ziet dat direct (realtime) en
-- tikt dan zelf op de knop. Alleen de beheerder mag erin schrijven en lezen.
-- =====================================================================

create table if not exists public.remote_commands (
  id         bigint generated always as identity primary key,
  game_id    uuid not null references public.games (id) on delete cascade,
  action     text not null check (action in ('next', 'prev')),
  created_at timestamptz not null default now()
);
create index if not exists remote_commands_game_idx on public.remote_commands (game_id, created_at);

alter table public.remote_commands enable row level security;
drop policy if exists "remote beheer" on public.remote_commands;
create policy "remote beheer" on public.remote_commands
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.remote_commands from anon;
grant select, insert, delete on public.remote_commands to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'remote_commands') then
    alter publication supabase_realtime add table public.remote_commands;
  end if;
end;
$$;
